import { supabase } from './supabase';

export interface ClientLogPayload {
  tenantId?: string | null;
  level: "info" | "warn" | "error" | "fatal" | "debug";
  source: string;
  eventName: string;
  message?: string | null;
  metadata?: Record<string, any>;
}

export async function logPlatformClient(payload: ClientLogPayload): Promise<void> {
  const logPrefix = `[${payload.source}] [${payload.level.toUpperCase()}] [${payload.eventName}]`;
  console.log(`${logPrefix} ${payload.message || ""}`, payload.metadata ? JSON.stringify(payload.metadata) : "");

  try {
    let tId = payload.tenantId;
    if (!tId) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        // Obter o tenant_id do membro correspondente ao usuário logado
        const { data: member } = await supabase
          .from("members")
          .select("tenant_id")
          .eq("user_id", session.user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        if (member) {
          tId = member.tenant_id;
        }
      }
    }

    const { error } = await supabase.from("platform_logs").insert({
      tenant_id: tId || null,
      level: payload.level,
      source: payload.source,
      event_name: payload.eventName,
      message: payload.message || null,
      metadata: payload.metadata || {},
    });

    if (error) {
      console.error(`[logger] Database insert failed:`, error.message);
    }
  } catch (err: any) {
    console.error(`[logger] Error writing platform log:`, err.message);
  }
}
