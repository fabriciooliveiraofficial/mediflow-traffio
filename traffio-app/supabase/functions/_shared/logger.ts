export interface LogPayload {
  tenantId?: string | null;
  level: "info" | "warn" | "error" | "fatal" | "debug";
  source: string;
  eventName: string;
  message?: string | null;
  metadata?: Record<string, any>;
}

export async function logPlatform(supabase: any, payload: LogPayload): Promise<void> {
  const logPrefix = `[${payload.source}] [${payload.level.toUpperCase()}] [${payload.eventName}]`;
  console.log(`${logPrefix} ${payload.message || ""}`, payload.metadata ? JSON.stringify(payload.metadata) : "");

  try {
    const { error } = await supabase.from("platform_logs").insert({
      tenant_id: payload.tenantId || null,
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
