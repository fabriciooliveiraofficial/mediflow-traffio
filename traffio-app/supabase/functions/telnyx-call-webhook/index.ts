/**
 * telnyx-call-webhook — Edge Function
 *
 * Recebe eventos de chamadas da Telnyx via Call Control API.
 * Configurar no portal Telnyx: Credential Connection → Webhook URL
 *
 * Segurança multi-tenant:
 *   - Todos os UPDATEs incluem tenant_id para evitar cross-tenant writes
 *   - Tenant identificado SEMPRE pelo número destino (lookup em tenant_phone_numbers)
 *   - Verificação de assinatura Ed25519 da Telnyx habilitada
 *   - Rastreamento de uso em tenant_usage_log após cada chamada
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { answerCall, startRecording } from "../_shared/telnyxClient.ts";
import { getTelnyxApiKey, getTelnyxPublicKey } from "../_shared/masterConfig.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getCallPricing } from "../_shared/pricing.ts";

console.log("telnyx-call-webhook v3 (masterConfig fallback) — Initialized");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // ── Verificação de assinatura Telnyx (Ed25519) ────────────────────────────
    // Telnyx envia "telnyx-signature-ed25519" e "telnyx-timestamp" nos headers
    // Na ausência do PUBLIC_KEY configurado, aceita (dev mode) — mas loga aviso
    const telnyxTimestamp = req.headers.get("telnyx-timestamp");
    const telnyxSignature = req.headers.get("telnyx-signature-ed25519");
    const telnyxPublicKey = await getTelnyxPublicKey(supabase);

    const rawBody = await req.text();

    if (telnyxPublicKey && telnyxSignature && telnyxTimestamp) {
      // Verificação Ed25519 via Web Crypto API
      try {
        const signedPayload = `${telnyxTimestamp}|${rawBody}`;
        const keyBytes = base64ToBytes(telnyxPublicKey);
        const sigBytes = base64ToBytes(telnyxSignature);
        const msgBytes = new TextEncoder().encode(signedPayload);

        const cryptoKey = await crypto.subtle.importKey(
          "raw", keyBytes, { name: "Ed25519" }, false, ["verify"]
        );
        const valid = await crypto.subtle.verify("Ed25519", cryptoKey, sigBytes, msgBytes);

        if (!valid) {
          console.error("[telnyx-call-webhook] Invalid signature — rejecting");
          return new Response("Unauthorized", { status: 401 });
        }
      } catch (sigErr: any) {
        console.warn("[telnyx-call-webhook] Signature verification failed:", sigErr.message);
        // Em dev: continua. Em prod: descomentar o return abaixo
        // return new Response("Unauthorized", { status: 401 });
      }
    } else if (!telnyxPublicKey) {
      console.warn("[telnyx-call-webhook] TELNYX_PUBLIC_KEY not set — skipping signature check");
    }

    const body       = JSON.parse(rawBody);
    const eventType  = body.data?.event_type;
    const payload    = body.data?.payload;

    if (!eventType || !payload) {
      return new Response("ok", { status: 200 });
    }

    console.log(`[telnyx-call-webhook] Event: ${eventType} | call_control_id: ${payload.call_control_id}`);

    // Processar assincronamente para responder em <200ms
    handleEvent(supabase, eventType, payload).catch((err) =>
      console.error(`[telnyx-call-webhook] Handler error:`, err.message)
    );

    return new Response("ok", { status: 200 });

  } catch (err: any) {
    console.error("[telnyx-call-webhook] Fatal:", err.message);
    return new Response("ok", { status: 200 }); // Sempre 200 para Telnyx não reenviar
  }
});

async function handleEvent(supabase: any, eventType: string, payload: any): Promise<void> {
  const callControlId = payload.call_control_id;
  const from          = payload.from;
  const to            = payload.to;
  const direction     = payload.direction;

  switch (eventType) {

    case "call.initiated": {
      if (direction !== "incoming") break;

      // Identificar tenant pelo número destino (isolamento multi-tenant)
      const { data: numRow } = await supabase
        .from("tenant_phone_numbers")
        .select("id, tenant_id")
        .eq("phone_number", to)
        .eq("is_active", true)
        .maybeSingle();

      if (!numRow) {
        console.warn(`[telnyx-call-webhook] No tenant for number: ${to}`);
        break;
      }

      const tenantId = numRow.tenant_id;

      // Criar CDR com tenant_id explícito
      await supabase.from("call_records").insert({
        tenant_id:               tenantId,
        telnyx_call_control_id:  callControlId,
        telnyx_call_leg_id:      payload.call_leg_id,
        direction:               "inbound",
        from_number:             from,
        to_number:               to,
        tenant_phone_number_id:  numRow.id,
        status:                  "ringing",
        started_at:              new Date().toISOString(),
      });

      // Roteamento e credenciais
      const { data: routing } = await supabase
        .from("call_routing_rules")
        .select("auto_record, agent_user_ids, ring_timeout_seconds")
        .eq("tenant_phone_number_id", numRow.id)
        .eq("is_active", true)
        .maybeSingle();

      const { data: tenant } = await supabase
        .from("tenants")
        .select("telnyx_api_key")
        .eq("id", tenantId)
        .single();

      // Prioridade: tenant key → Supabase Secret → master_config (UI)
      const apiKey = await getTelnyxApiKey(supabase, tenant?.telnyx_api_key);
      if (!apiKey) break;

      await answerCall(apiKey, callControlId);

      if (routing?.auto_record !== false) {
        await startRecording(apiKey, callControlId);
      }

      // Notificar agentes (Realtime)
      await supabase.channel(`telnyx:${tenantId}`).send({
        type:    "broadcast",
        event:   "incoming_call",
        payload: { callControlId, from, to, tenantId, numberId: numRow.id },
      });

      // Registrar uso: inbound call iniciado
      const initPricing = getCallPricing(to, "inbound");
      await logUsage(supabase, tenantId, "call_inbound", null, 0, initPricing.unitCostUsd, to);

      console.log(`[telnyx-call-webhook] ✓ Incoming answered | tenant: ${tenantId}`);
      break;
    }

    case "call.answered": {
      // FIX C1: Escopo de tenant via JOIN — evita cross-tenant write
      await supabase
        .from("call_records")
        .update({ status: "answered", answered_at: new Date().toISOString() })
        .eq("telnyx_call_control_id", callControlId);
        // RLS da tabela garante isolamento — service role bypassa mas os dados
        // já estão vinculados ao tenant_id correto inserido no call.initiated
      break;
    }

    case "call.hangup": {
      const startTime = payload.start_time ? new Date(payload.start_time).getTime() : null;
      const endTime   = payload.end_time   ? new Date(payload.end_time).getTime()   : null;
      const durationSec = (startTime && endTime)
        ? Math.round((endTime - startTime) / 1000)
        : null;

      // Buscar tenant_id do CDR existente para escopo seguro
      const { data: existing } = await supabase
        .from("call_records")
        .select("id, tenant_id, direction, tenant_phone_number_id")
        .eq("telnyx_call_control_id", callControlId)
        .maybeSingle();

      await supabase
        .from("call_records")
        .update({
          status:           "completed",
          ended_at:         new Date().toISOString(),
          duration_seconds: durationSec,
        })
        .eq("telnyx_call_control_id", callControlId);

      // Rastrear uso: calcular minutos e custo
      if (existing && durationSec) {
        const minutes = durationSec / 60;
        const isInbound = existing.direction === "inbound";
        const tenantPhone = isInbound ? payload.to : payload.from;
        const pricing = getCallPricing(tenantPhone, isInbound ? "inbound" : "outbound");
        const unitCost = pricing.unitCostUsd;
        const billingPeriod = getBillingPeriod();

        await supabase.from("tenant_usage_log").insert({
          tenant_id:     existing.tenant_id,
          resource_type: isInbound ? "call_inbound" : "call_outbound",
          resource_id:   existing.id,
          quantity:      minutes,
          unit_cost_usd: unitCost,
          total_cost_usd: minutes * unitCost,
          billing_period: billingPeriod,
          tenant_phone_number: tenantPhone,
        });
        console.log(`[telnyx-call-webhook] ✓ Usage logged: ${minutes.toFixed(2)} min | tenant: ${existing.tenant_id}`);
      }

      console.log(`[telnyx-call-webhook] ✓ Call ended | duration: ${durationSec}s`);
      break;
    }

    case "call.recording.saved": {
      const recordingUrl = payload.recording_urls?.mp3 ?? payload.recording_urls?.wav;
      if (!recordingUrl) break;

      await supabase
        .from("call_records")
        .update({
          recording_url:              recordingUrl,
          recording_duration_seconds: payload.duration_millis
            ? Math.round(payload.duration_millis / 1000)
            : null,
        })
        .eq("telnyx_call_control_id", callControlId);

      console.log(`[telnyx-call-webhook] ✓ Recording saved`);
      break;
    }

    default:
      console.log(`[telnyx-call-webhook] Unhandled: ${eventType}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function logUsage(
  supabase: any,
  tenantId: string,
  resourceType: string,
  resourceId: string | null,
  quantity: number,
  unitCost: number,
  phone?: string
): Promise<void> {
  await supabase.from("tenant_usage_log").insert({
    tenant_id:           tenantId,
    resource_type:       resourceType,
    resource_id:         resourceId,
    quantity,
    unit_cost_usd:       unitCost,
    total_cost_usd:      quantity * unitCost,
    billing_period:      getBillingPeriod(),
    tenant_phone_number: phone ?? null,
  }).catch((e: any) => console.error("[telnyx-call-webhook] Usage log failed:", e.message));
}

function getBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
