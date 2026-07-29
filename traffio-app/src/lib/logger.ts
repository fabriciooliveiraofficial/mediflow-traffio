import { supabase } from './supabase';

export interface ClientLogPayload {
  tenantId?: string | null;
  level: "info" | "warn" | "error" | "fatal" | "debug";
  source: string;
  eventName: string;
  message?: string | null;
  metadata?: Record<string, any>;
}

let cachedTenantId: { id: string | null; time: number } | null = null;

async function getTenantIdForLog(providedTenantId?: string | null): Promise<string | null> {
  if (providedTenantId) return providedTenantId;

  const now = Date.now();
  if (cachedTenantId && (now - cachedTenantId.time < 10000)) {
    return cachedTenantId.id;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: member } = await supabase
        .from("members")
        .select("tenant_id")
        .eq("user_id", session.user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const tId = member?.tenant_id || null;
      cachedTenantId = { id: tId, time: now };
      return tId;
    }
  } catch {
    // Ignore error during tenant resolution
  }

  cachedTenantId = { id: null, time: now };
  return null;
}

export async function logPlatformClient(payload: ClientLogPayload): Promise<void> {
  const logPrefix = `[${payload.source}] [${payload.level.toUpperCase()}] [${payload.eventName}]`;
  console.log(`${logPrefix} ${payload.message || ""}`, payload.metadata ? JSON.stringify(payload.metadata) : "");

  try {
    const tId = await getTenantIdForLog(payload.tenantId);

    const { error } = await supabase.from("platform_logs").insert({
      tenant_id: tId || null,
      level: payload.level,
      source: payload.source,
      event_name: payload.eventName,
      message: payload.message || null,
      metadata: payload.metadata || {},
    });

    if (error) {
      if (error.code !== '42501' && error.code !== 'PGRST301' && (error as any).status !== 401) {
        console.error(`[logger] Database insert failed:`, error.message);
      }
    }
  } catch (err: any) {
    console.error(`[logger] Error writing platform log:`, err.message);
  }
}
