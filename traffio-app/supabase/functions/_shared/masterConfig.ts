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

async function getMasterConfig(
  supabase: SupabaseClient,
  key: string,
  defaultValue = ""
): Promise<string> {
  // 1. Supabase Secret (env var) — preferido, sem latência
  const envValue = Deno.env.get(key);
  if (envValue) return envValue;

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

    const value = data?.value ?? "";
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

// ─── Cache management ─────────────────────────────────────────────────────────

/** Invalida o cache de uma chave específica (útil após update via UI) */
export function invalidateCache(key: string): void {
  delete cache[key];
}

/** Invalida todo o cache */
export function clearAllCache(): void {
  Object.keys(cache).forEach((k) => delete cache[k]);
}
