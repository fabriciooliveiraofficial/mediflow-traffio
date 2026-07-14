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
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getAnthropicApiKey } from "./masterConfig.ts";

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
    usage: { inputTokens: number; outputTokens: number };
    /** Content blocks crus da resposta — necessários para devolver tool_result no loop agentic */
    rawContent: any[];
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
    maxTokens?: number;
    temperature?: number;
}

export async function claudeChat(supabase: SupabaseClient, req: LlmRequest): Promise<LlmResult> {
    const apiKey = await getAnthropicApiKey(supabase);
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada (painel master → Intelligence)");

    const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.system,
        messages: req.messages,
    };
    if (req.tools?.length) body.tools = req.tools;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const started = Date.now();
    let res: Response | null = null;
    let retried = false;

    for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(ANTHROPIC_URL, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": ANTHROPIC_VERSION,
            },
            body: JSON.stringify(body),
        });

        if (res.ok) break;

        const errText = await res.text();

        // Modelos mais novos rejeitam `temperature` (deprecated) — remover e repetir.
        // Compatibilidade por modelo muda com o tempo; nunca falhar por parâmetro opcional.
        if (res.status === 400 && errText.includes("temperature") && "temperature" in body) {
            console.warn(`[llmProvider] ${req.purpose}: modelo rejeitou 'temperature' — repetindo sem o parâmetro`);
            delete body.temperature;
            continue;
        }

        // Retry único em rate-limit/instabilidade; demais 4xx não se repetem
        if ((res.status === 429 || res.status >= 500) && !retried) {
            retried = true;
            const waitMs = 1500;
            console.warn(`[llmProvider] ${req.purpose}: HTTP ${res.status} — retry em ${waitMs}ms`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
        }
        throw new Error(`[llmProvider] ${req.purpose}: Anthropic HTTP ${res.status} — ${errText.substring(0, 300)}`);
    }

    if (!res || !res.ok) {
        throw new Error(`[llmProvider] ${req.purpose}: esgotou tentativas sem resposta OK`);
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
    };

    console.log(`[llmProvider] ${req.purpose}: ${req.model} — in=${usage.inputTokens} out=${usage.outputTokens} tools=${toolCalls.length} ${Date.now() - started}ms`);

    // Log de uso para o dashboard do painel master — best effort, nunca falha a chamada.
    // Colunas conforme o schema REAL de ai_usage_logs (tokens_input/tokens_output/
    // cost_api_cents/price_tenant_cents/model/context) — validado em produção 07/2026.
    try {
        const price = PRICE_PER_MTOK[req.model] ?? PRICE_PER_MTOK["claude-sonnet-5"];
        const costUsd = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
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
