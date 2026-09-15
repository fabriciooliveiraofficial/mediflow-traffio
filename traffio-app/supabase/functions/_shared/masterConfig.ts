/**
 * masterConfig — Helper para leitura de credenciais da master_config
 *
 * Prioridade de resolução para cada chave:
 *   1. Valor específico do tenant (ex: tenant.telnyx_api_key)
 *   2. Supabase Secret (Deno.env.get) — mais seguro, sem latência de DB
 *   3. master_config table — gerenciado via /master/intelligence (UI)
 *
 * Cache em memória por 5 minutos para evitar hit no DB a cada requisição.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const cache: Record<string, { value: string; expiresAt: number }> = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Derruba o cache de uma chave imediatamente. Usado quando o consumidor
 * descobre que o valor cacheado está PODRE (ex.: Anthropic devolveu 401 —
 * chave revogada/trocada): sem isso, uma chave corrigida no painel Master
 * só passa a valer depois do TTL de 5min, prolongando o incidente à toa.
 */
export function invalidateMasterConfigCache(key: string): void {
  delete cache[key];
}

async function getMasterConfig(
  supabase: SupabaseClient,
  key: string,
  defaultValue = "",
  allowEnv = true,
): Promise<string> {
  // 1. Supabase Secret (env var) — preferido, sem latência.
  // trim(): chaves coladas manualmente costumam vir com espaço/quebra de linha,
  // o que gera 401 "invalid x-api-key" difícil de diagnosticar.
  if (allowEnv) {
    const envValue = Deno.env.get(key)?.trim();
    if (envValue) return envValue;
  }

  // 2. Cache em memória
  const cached = cache[key];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value || defaultValue;
  }

  // 3. master_config table (UI-managed via /master/intelligence)
  try {
    const { data } = await supabase
      .from("master_config")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    const value = (data?.value ?? "").trim();
    cache[key] = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value || defaultValue;
  } catch {
    return defaultValue;
  }
}

// ─── Telnyx ───────────────────────────────────────────────────────────────────

export async function getTelnyxApiKey(
  supabase: SupabaseClient,
  tenantApiKey?: string | null
): Promise<string> {
  if (tenantApiKey) return tenantApiKey;
  return getMasterConfig(supabase, "TELNYX_API_KEY");
}

export async function getTelnyxConnectionId(
  supabase: SupabaseClient,
  tenantConnectionId?: string | null
): Promise<string> {
  if (tenantConnectionId) return tenantConnectionId;
  return getMasterConfig(supabase, "TELNYX_CONNECTION_ID");
}

export async function getTelnyxMessagingProfileId(
  supabase: SupabaseClient,
  tenantMessagingProfileId?: string | null
): Promise<string> {
  if (tenantMessagingProfileId) return tenantMessagingProfileId;
  return getMasterConfig(supabase, "TELNYX_MESSAGING_PROFILE_ID");
}

export async function getTelnyxPublicKey(supabase: SupabaseClient): Promise<string> {
  return getMasterConfig(supabase, "TELNYX_PUBLIC_KEY");
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export async function getMetaVerifyToken(supabase: SupabaseClient): Promise<string> {
  return getMasterConfig(supabase, "META_VERIFY_TOKEN", "traffio_verify_token");
}

export async function getMetaClientId(supabase: SupabaseClient): Promise<string> {
  return getMasterConfig(supabase, "META_CLIENT_ID");
}

export async function getMetaClientSecret(supabase: SupabaseClient): Promise<string> {
  return getMasterConfig(supabase, "META_CLIENT_SECRET");
}

// ─── Anthropic Claude (docs/SPEC_AGENTE_IA_CLAUDE.md) ─────────────────────────

export async function getAnthropicApiKey(supabase: SupabaseClient): Promise<string> {
  return getMasterConfig(supabase, "ANTHROPIC_API_KEY");
}

/** Modelo do agente conversacional / copiloto (default: Sonnet 5). */
export async function getAiModelAgent(supabase: SupabaseClient): Promise<string> {
  return getMasterConfig(supabase, "AI_MODEL_AGENT", "claude-sonnet-5");
}

/** Modelo de triagem/extração — papéis estruturados (default: Haiku 4.5). */
export async function getAiModelRouter(supabase: SupabaseClient): Promise<string> {
  return getMasterConfig(supabase, "AI_MODEL_ROUTER", "claude-haiku-4-5-20251001");
}

// ─── Economia da IA (docs/PLANO_MONETIZACAO_IA_2026-09.md) ───────────────────
// Parâmetros editáveis no painel master (nunca em secret: o operador precisa
// mudar câmbio/limites sem redeploy). Valor ausente/inválido → default seguro.

function parsePositiveNumber(raw: string, fallback: number): number {
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Câmbio USD→BRL aplicado ao custo de cada chamada de LLM (já com IOF). */
export async function getAiUsdBrlRate(supabase: SupabaseClient): Promise<number> {
  return parsePositiveNumber(await getMasterConfig(supabase, "AI_USD_BRL_RATE", "5.69", false), 5.69);
}

/** Máximo de respostas do agente ao mesmo telefone em 1h; 0 desliga o limite. */
export async function getAiPhoneTurnsPerHour(supabase: SupabaseClient): Promise<number> {
  const n = Number.parseInt(await getMasterConfig(supabase, "AI_PHONE_TURNS_PER_HOUR", "40", false), 10);
  return Number.isFinite(n) && n >= 0 ? n : 40;
}

/**
 * Override opcional da tabela de preço por MTok (USD), como JSON:
 * {"claude-sonnet-5":{"input":2,"output":10}}. Permite acompanhar um reajuste
 * da Anthropic sem deploy; ausente/inválido → tabela do llmProvider.
 */
export async function getAiPricePerMtokOverride(
  supabase: SupabaseClient,
): Promise<Record<string, { input: number; output: number }> | null> {
  const raw = await getMasterConfig(supabase, "AI_PRICE_PER_MTOK_JSON", "", false);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const out: Record<string, { input: number; output: number }> = {};
    for (const [model, p] of Object.entries(parsed as Record<string, any>)) {
      if (Number.isFinite(p?.input) && Number.isFinite(p?.output)) out[model] = { input: p.input, output: p.output };
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

// ─── RAG / embeddings ────────────────────────────────────────────────────────

export async function getOpenAiApiKey(supabase: SupabaseClient): Promise<string> {
  return getMasterConfig(supabase, "OPENAI_API_KEY");
}

/** Flag global: ausente ou diferente de "true" mantém o RAG desligado. */
export async function getRagEnabled(supabase: SupabaseClient): Promise<boolean> {
  return (await getMasterConfig(supabase, "RAG_ENABLED", "false", false)).toLowerCase() === "true";
}

/** Limiar defensivo; valor ausente, inválido ou menor que 1 volta ao default. */
export async function getRagMinKbEntries(supabase: SupabaseClient): Promise<number> {
  const parsed = Number.parseInt(await getMasterConfig(supabase, "RAG_MIN_KB_ENTRIES", "20", false), 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 20;
}

// ─── Cache management ─────────────────────────────────────────────────────────

/** Invalida o cache de uma chave específica (útil após update via UI) */
export function invalidateCache(key: string): void {
  delete cache[key];
}

/** Invalida todo o cache */
export function clearAllCache(): void {
  Object.keys(cache).forEach((k) => delete cache[k]);
}
