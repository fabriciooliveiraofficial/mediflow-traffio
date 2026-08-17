/**
 * llmProvider — camada fina sobre a API da Anthropic (docs/SPEC_AGENTE_IA_CLAUDE.md, F1).
 *
 * Regras desta camada:
 *  - Toda chamada de LLM da plataforma passa por aqui (uma porta única).
 *  - Cada chamada é registrada em ai_usage_logs (tenant, tokens, custo estimado)
 *    para alimentar o dashboard do painel master. Falha de log NUNCA falha a chamada.
 *  - Erros são retornados como exceção tipada — o chamador decide o fallback
 *    (no copiloto: seguir sem rascunho; em nível autônomo: handoff humano).
 *  - Retry único em 429/5xx com backoff curto. Sem retry em 4xx de request.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠️  PROMPT CACHING (Anthropic) — DECISÃO DE ARQUITETURA TRAVADA, 2026-07-21
 * ══════════════════════════════════════════════════════════════════════════
 * NÃO REMOVA `cacheableSystemPrefix`/`cacheTools` de `LlmRequest`, nem a
 * lógica de `cache_control` em `buildCachedSystemField`/`applyCacheToTools`
 * abaixo. Medido em produção: ~77% de economia no custo de input tokens do
 * agente (299.978 tokens lidos do cache a 10% do preço vs. 36.831 tokens
 * fresh, numa única rodada da suíte de evals — ver memory/prompt_caching_feature.md
 * e docs/SPEC_AGENTE_IA_CLAUDE.md § Prompt caching).
 *
 * Se um "cleanup"/refactor futuro achar esses campos "não usados" ou
 * "redundantes com `system`/`tools`": NÃO SÃO. Eles existem especificamente
 * para o cache_control da Anthropic — removê-los reverte a otimização
 * silenciosamente (o código continua funcionando, só fica ~4-10x mais caro
 * por chamada, sem nenhum erro ou teste quebrando para avisar).
 * Doc oficial: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 * Guardado por teste: `unit_test.ts` → "buildCachedSystemField"/"applyCacheToTools".
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getAnthropicApiKey, invalidateMasterConfigCache } from "./masterConfig.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Preço por MTok (USD, input/output) — usado só para custo ESTIMADO no dashboard.
// Modelos fora da tabela caem no preço do Sonnet (estimativa conservadora).
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
    "claude-sonnet-5": { input: 3, output: 15 },
    "claude-opus-4-8": { input: 5, output: 25 },
    "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

export interface LlmMessage {
    role: "user" | "assistant";
    /** string simples OU array de content blocks (tool_use/tool_result no loop agentic) */
    content: string | any[];
}

export interface LlmTool {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
}

export interface LlmToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface LlmResult {
    text: string;
    toolCalls: LlmToolCall[];
    stopReason: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        /** Tokens NOVOS escritos no cache nesta chamada (prompt caching) */
        cacheCreationTokens: number;
        /** Tokens lidos do cache (10% do custo normal) — prova de que o cache funcionou */
        cacheReadTokens: number;
    };
    /** Content blocks crus da resposta — necessários para devolver tool_result no loop agentic */
    rawContent: any[];
}

/**
 * Erro tipado do provider — o `kind` distingue falha de INFRA (afeta TODAS as
 * conversas, não é culpa deste turno) de falha pontual do request.
 *
 * Bug de produção (2026-07-23, ver memory/incident_api_key_wrong_slot.md): uma
 * chave Anthropic errada no slot de config faz TODA chamada de TODAS as
 * conversas falhar ao mesmo tempo com HTTP 401. Sem este tipo, o chamador
 * (process-inbox) não tinha como diferenciar isso de uma falha isolada de
 * turno — e carimbava CADA lead simultâneo com "falha no sistema (hard)",
 * girando um incidente de config em dezenas de handoffs individuais e
 * confundindo o time (parecia o agente "quebrado", não a config).
 *
 *  - "config": chave ausente/não configurada — nunca vai se resolver sozinho.
 *  - "auth": chave presente mas rejeitada pela Anthropic (401/403) — chave
 *    errada ou revogada; mesmo padrão do incidente acima.
 *  - "upstream_unavailable": 429/5xx sustentado mesmo após todos os retries —
 *    a Anthropic está indisponível/limitando, não é erro nosso.
 *  - "network": fetch nunca completou (DNS, timeout, conexão recusada).
 *  - "request": 4xx que não é auth (payload/parâmetro inválido) — bug de
 *    request deste turno específico, não afeta as demais conversas.
 */
export type LlmErrorKind = "config" | "auth" | "upstream_unavailable" | "network" | "request";

export class LlmProviderError extends Error {
    readonly kind: LlmErrorKind;
    readonly status?: number;
    constructor(message: string, kind: LlmErrorKind, status?: number) {
        super(message);
        this.name = "LlmProviderError";
        this.kind = kind;
        this.status = status;
    }
}

/**
 * true para falhas de INFRA — afetam todas as conversas do tenant/plataforma,
 * não só este turno. O chamador usa isto para acionar o circuit breaker
 * (degradação graciosa + um único alerta) em vez de marcar cada conversa
 * simultânea como "falha no sistema (hard)".
 */
export function isLlmInfraFailure(err: unknown): boolean {
    return err instanceof LlmProviderError &&
        (err.kind === "config" || err.kind === "auth" || err.kind === "upstream_unavailable" || err.kind === "network");
}

export interface LlmRequest {
    /** Para o log de uso no painel master */
    tenantId: string;
    /** Rótulo curto do papel da chamada (ex.: 'copilot_draft', 'triage') — vai no log de erro */
    purpose: string;
    model: string;
    system: string;
    messages: LlmMessage[];
    tools?: LlmTool[];
    /** tool_choice da API (ex.: {type:"none"} para forçar resposta em texto) */
    toolChoice?: { type: "auto" | "any" | "none" } | { type: "tool"; name: string };
    maxTokens?: number;
    temperature?: number;
    /**
     * Prompt caching (Anthropic): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
     * Deve ser um PREFIXO EXATO de `system` (mesmo texto, começando do início).
     * Tudo até aqui vira um bloco `cache_control: ephemeral` (TTL padrão 5min);
     * o restante de `system` (contexto dinâmico por turno) fica de fora —
     * processado normal a cada chamada. Cache hit = ~10% do custo do input.
     */
    cacheableSystemPrefix?: string;
    /** Marca `tools` (lista 100% estática entre chamadas) como cacheável — a
     * API só respeita cache_control no ÚLTIMO item da lista. */
    cacheTools?: boolean;
}

/**
 * Monta o campo `system` do request Anthropic. Se `cacheableSystemPrefix` for
 * um prefixo válido de `system`, separa em dois blocos — o prefixo com
 * cache_control (reaproveitável entre chamadas idênticas) e o restante sem.
 * Pura e exportada para ser testável sem rede.
 */
export function buildCachedSystemField(
    system: string,
    cacheableSystemPrefix?: string,
): string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
    if (!cacheableSystemPrefix || cacheableSystemPrefix.length === 0 || !system.startsWith(cacheableSystemPrefix)) {
        return system;
    }
    const rest = system.slice(cacheableSystemPrefix.length);
    const blocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [
        { type: "text", text: cacheableSystemPrefix, cache_control: { type: "ephemeral" } },
    ];
    if (rest) blocks.push({ type: "text", text: rest });
    return blocks;
}

/**
 * Marca o último item de `tools` com cache_control (exigência da API: só o
 * breakpoint no ÚLTIMO elemento da lista é respeitado — os anteriores são
 * cacheados "de brinde" via lookback). Pura e exportada para ser testável.
 */
export function applyCacheToTools<T extends object>(tools: readonly T[]): T[] {
    if (!tools.length) return tools as T[];
    return tools.map((tool, i) =>
        i === tools.length - 1 ? { ...tool, cache_control: { type: "ephemeral" as const } } : tool,
    ) as T[];
}

// Item 3 do hardening de carga (docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md): o
// retry antigo era 1 tentativa fixa de 1,5s — sob 429 sustentado (burst de
// muitos tenants, agora mais provável com a concorrência do item 2), isso
// virava "handoff em massa" em vez de "espera curta e recupera".
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;
// Piso de espera entre tentativas. Bug de produção (2026-08-12): a Anthropic
// responde 529 (overloaded) COM o header `retry-after: 0`; o código honrava
// esse 0 ao pé da letra e disparava as 4 tentativas praticamente coladas
// ("retry 1/4 em 0ms" ... "retry 4/4 em 0ms"), martelando um servidor já
// sobrecarregado e desistindo em ~12s. Sem espera real, o retry não é retry.
// Um piso também protege do "full jitter" sortear um valor quase nulo.
const RETRY_MIN_MS = 750;

/**
 * Delay do próximo retry em 429/5xx. Honra `retry-after` do servidor apenas
 * quando ele pede uma espera REAL (> 0), limitado a RETRY_MAX_MS — um servidor
 * pedindo minutos não deve travar o turno inteiro, e um pedindo zero não deve
 * anular o backoff. Caso contrário usa "full jitter" (AWS): uniforme entre
 * RETRY_MIN_MS e min(RETRY_MAX_MS, RETRY_BASE_MS * 2^attempt) — espalha os
 * retries no tempo em vez de todos os workers baterem de novo no mesmo
 * instante (relevante com concorrência: várias conversas podem levar 429 ao
 * mesmo tempo). Pura e exportada para ser testável sem rede/timers reais.
 */
export function computeRetryDelayMs(
    attempt: number,
    opts: { retryAfterHeader?: string | null; baseMs?: number; maxMs?: number; minMs?: number; random?: () => number } = {},
): number {
    const maxMs = opts.maxMs ?? RETRY_MAX_MS;
    const minMs = Math.min(opts.minMs ?? RETRY_MIN_MS, maxMs);
    if (opts.retryAfterHeader) {
        const seconds = Number(opts.retryAfterHeader);
        // `>= 0` virava 0ms com `retry-after: 0`. Só um pedido de espera real
        // (> 0) substitui o backoff exponencial; 0/negativo/inválido cai nele.
        if (Number.isFinite(seconds) && seconds > 0) {
            return Math.min(Math.max(seconds * 1000, minMs), maxMs);
        }
    }
    const baseMs = opts.baseMs ?? RETRY_BASE_MS;
    const random = opts.random ?? Math.random;
    const cap = Math.min(maxMs, baseMs * Math.pow(2, attempt));
    return Math.round(Math.max(random() * cap, minMs));
}

export async function claudeChat(supabase: SupabaseClient, req: LlmRequest): Promise<LlmResult> {
    const apiKey = await getAnthropicApiKey(supabase);
    if (!apiKey) throw new LlmProviderError("ANTHROPIC_API_KEY não configurada (painel master → Intelligence)", "config");

    const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        system: buildCachedSystemField(req.system, req.cacheableSystemPrefix),
        messages: req.messages,
    };
    if (req.tools?.length) body.tools = req.cacheTools ? applyCacheToTools(req.tools) : req.tools;
    if (req.toolChoice) body.tool_choice = req.toolChoice;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const started = Date.now();
    let res: Response | null = null;
    let rateLimitRetries = 0;
    let temperatureStripped = false;
    // MAX_RATE_LIMIT_RETRIES retries em 429/5xx (backoff) + 1 troca única de
    // 'temperature' (compat) — teto de iterações do loop, nunca infinito.
    const MAX_RATE_LIMIT_RETRIES = 4;

    for (let iter = 0; iter < MAX_RATE_LIMIT_RETRIES + 2; iter++) {
        try {
            res = await fetch(ANTHROPIC_URL, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": ANTHROPIC_VERSION,
                },
                body: JSON.stringify(body),
            });
        } catch (networkErr: any) {
            // fetch nunca completou (DNS, timeout, conexão recusada) — infra, não turno.
            throw new LlmProviderError(
                `[llmProvider] ${req.purpose}: falha de rede ao chamar Anthropic — ${networkErr?.message}`,
                "network",
            );
        }

        if (res.ok) break;

        const errText = await res.text();

        // Modelos mais novos rejeitam `temperature` (deprecated) — remover e repetir.
        // Compatibilidade por modelo muda com o tempo; nunca falhar por parâmetro opcional.
        if (!temperatureStripped && res.status === 400 && errText.includes("temperature") && "temperature" in body) {
            temperatureStripped = true;
            console.warn(`[llmProvider] ${req.purpose}: modelo rejeitou 'temperature' — repetindo sem o parâmetro`);
            delete body.temperature;
            continue;
        }

        // Chave presente mas rejeitada — falha de INFRA (afeta toda chamada da
        // plataforma até a chave ser corrigida), nunca deste turno específico.
        // Derruba o cache da chave na hora: quando o operador corrigir no painel
        // Master, a próxima chamada relê o valor novo do banco imediatamente,
        // em vez de repetir 401 com a chave podre por até 5min de TTL.
        if (res.status === 401 || res.status === 403) {
            invalidateMasterConfigCache("ANTHROPIC_API_KEY");
            throw new LlmProviderError(
                `[llmProvider] ${req.purpose}: Anthropic HTTP ${res.status} (auth) — ${errText.substring(0, 300)}`,
                "auth",
                res.status,
            );
        }

        // Backoff exponencial + jitter em rate-limit/instabilidade, honrando
        // retry-after quando o servidor manda. Demais 4xx não se repetem.
        if ((res.status === 429 || res.status >= 500) && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            const waitMs = computeRetryDelayMs(rateLimitRetries, { retryAfterHeader: res.headers.get("retry-after") });
            rateLimitRetries++;
            console.warn(`[llmProvider] ${req.purpose}: HTTP ${res.status} — retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES} em ${waitMs}ms`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
        }

        // 429/5xx que esgotou os retries: upstream indisponível, não é bug de request.
        if (res.status === 429 || res.status >= 500) {
            throw new LlmProviderError(
                `[llmProvider] ${req.purpose}: Anthropic HTTP ${res.status} após esgotar retries — ${errText.substring(0, 300)}`,
                "upstream_unavailable",
                res.status,
            );
        }
        throw new LlmProviderError(
            `[llmProvider] ${req.purpose}: Anthropic HTTP ${res.status} — ${errText.substring(0, 300)}`,
            "request",
            res.status,
        );
    }

    if (!res || !res.ok) {
        throw new LlmProviderError(`[llmProvider] ${req.purpose}: esgotou tentativas sem resposta OK`, "upstream_unavailable");
    }

    const data = await res!.json();

    const text = (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
    const toolCalls: LlmToolCall[] = (data.content || [])
        .filter((b: any) => b.type === "tool_use")
        .map((b: any) => ({ id: b.id, name: b.name, input: b.input || {} }));

    const usage = {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        cacheCreationTokens: data.usage?.cache_creation_input_tokens ?? 0,
        cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
    };

    const durationMs = Date.now() - started;
    const cacheNote = (usage.cacheReadTokens || usage.cacheCreationTokens)
        ? ` cacheRead=${usage.cacheReadTokens} cacheWrite=${usage.cacheCreationTokens}`
        : "";
    console.log(`[llmProvider] ${req.purpose}: ${req.model} — in=${usage.inputTokens} out=${usage.outputTokens}${cacheNote} tools=${toolCalls.length} retries=${rateLimitRetries} ${durationMs}ms`);

    // Log de uso para o dashboard do painel master — best effort, nunca falha a chamada.
    // Colunas conforme o schema REAL de ai_usage_logs (tokens_input/tokens_output/
    // cost_api_cents/price_tenant_cents/model/context) — validado em produção 07/2026.
    try {
        const price = PRICE_PER_MTOK[req.model] ?? PRICE_PER_MTOK["claude-sonnet-5"];
        // Cache (TTL padrão 5min, único usado aqui): escrita = 1.25x o input
        // normal, leitura = 0.1x — sem isso o custo estimado subestimaria o
        // gasto real da Anthropic sempre que o cache escrever ou ler.
        const costUsd = (
            usage.inputTokens * price.input +
            usage.cacheCreationTokens * price.input * 1.25 +
            usage.cacheReadTokens * price.input * 0.1 +
            usage.outputTokens * price.output
        ) / 1_000_000;
        const costCents = costUsd * 100;
        const { error: logError } = await supabase.from("ai_usage_logs").insert({
            tenant_id: req.tenantId,
            model: req.model,
            tokens_input: usage.inputTokens,
            tokens_output: usage.outputTokens,
            cost_api_cents: costCents,
            // Convenção de markup da plataforma (ver _shared/pricing.ts): preço ao tenant = 2× o custo
            price_tenant_cents: costCents * 2,
            context: req.purpose,
            // Observabilidade de latência/cache/retry por chamada — usado no
            // diagnóstico de carga (docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md) para
            // separar "Anthropic lento sob rajada" de contenção nossa, e útil em
            // produção para ver latência real e taxa de 429 por chamada.
            metadata: {
                duration_ms: durationMs,
                cache_read: usage.cacheReadTokens,
                cache_creation: usage.cacheCreationTokens,
                retries: rateLimitRetries,
            },
        });
        if (logError) console.warn(`[llmProvider] usage log failed (non-fatal): ${logError.message}`);
    } catch (logErr: any) {
        console.warn(`[llmProvider] usage log failed (non-fatal): ${logErr?.message}`);
    }

    return { text, toolCalls, stopReason: data.stop_reason ?? "end_turn", usage, rawContent: data.content || [] };
}

/**
 * Chamada estruturada (triagem/extração com o modelo router): pede JSON puro
 * e faz o parse defensivo. Retorna null em qualquer falha — o chamador segue sem.
 */
export async function claudeJson<T>(supabase: SupabaseClient, req: LlmRequest): Promise<T | null> {
    try {
        // Sem `temperature` por padrão — modelos novos rejeitam o parâmetro
        // (há auto-retry sem ele, mas não vale pagar a viagem extra)
        const result = await claudeChat(supabase, req);
        // Aceita JSON puro ou cercado de texto/markdown
        const match = result.text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        return JSON.parse(match[0]) as T;
    } catch (e: any) {
        console.warn(`[llmProvider] ${req.purpose}: claudeJson falhou (non-fatal): ${e?.message}`);
        return null;
    }
}
