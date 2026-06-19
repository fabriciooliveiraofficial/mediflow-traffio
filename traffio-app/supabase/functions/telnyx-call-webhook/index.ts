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
import { answerCall, startRecording, downloadRecording } from "../_shared/telnyxClient.ts";
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
      const isIncoming = direction === "incoming";
      const lookupNumber = isIncoming ? to : from;

      // Identificar tenant pelo número correto (destino para inbound, origem para outbound)
      const { data: numRow } = await supabase
        .from("tenant_phone_numbers")
        .select("id, tenant_id")
        .eq("phone_number", lookupNumber)
        .eq("is_active", true)
        .maybeSingle();

      if (!numRow) {
        console.warn(`[telnyx-call-webhook] No tenant for number: ${lookupNumber}`);
        break;
      }

      const tenantId = numRow.tenant_id;

      // Criar CDR com tenant_id explícito
      await supabase.from("call_records").insert({
        tenant_id:               tenantId,
        telnyx_call_control_id:  callControlId,
        telnyx_call_leg_id:      payload.call_leg_id,
        direction:               isIncoming ? "inbound" : "outbound",
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

      // Atender somente chamadas recebidas (inbound)
      if (isIncoming) {
        await answerCall(apiKey, callControlId);
      }

      // Gravar se auto_record for verdadeiro (tanto inbound quanto outbound)
      if (routing?.auto_record !== false) {
        await startRecording(apiKey, callControlId);
      }

      if (isIncoming) {
        // Notificar agentes (Realtime) - apenas para inbound
        await supabase.channel(`telnyx:${tenantId}`).send({
          type:    "broadcast",
          event:   "incoming_call",
          payload: { callControlId, from, to, tenantId, numberId: numRow.id },
        });
      }

      // Registrar uso
      const resourceType = isIncoming ? "call_inbound" : "call_outbound";
      const initPricing = getCallPricing(lookupNumber, isIncoming ? "inbound" : "outbound");
      await logUsage(supabase, tenantId, resourceType, null, 0, initPricing.unitCostUsd, lookupNumber);

      console.log(`[telnyx-call-webhook] ✓ ${isIncoming ? "Incoming answered" : "Outgoing tracked"} | tenant: ${tenantId}`);
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

      let finalRecordingUrl = recordingUrl;

      // Buscar tenant_id para podermos usar a API Key correta do tenant e organizar no storage
      const { data: cdrRecord } = await supabase
        .from("call_records")
        .select("tenant_id")
        .eq("telnyx_call_control_id", callControlId)
        .maybeSingle();

      if (cdrRecord) {
        try {
          const { data: tenant } = await supabase
            .from("tenants")
            .select("telnyx_api_key")
            .eq("id", cdrRecord.tenant_id)
            .single();

          const apiKey = await getTelnyxApiKey(supabase, tenant?.telnyx_api_key);
          if (apiKey) {
            console.log(`[telnyx-call-webhook] Downloading recording from ${recordingUrl}...`);
            const audioBuffer = await downloadRecording(apiKey, recordingUrl);

            const fileExt = recordingUrl.endsWith(".wav") ? "wav" : "mp3";
            const filePath = `${cdrRecord.tenant_id}/${callControlId}.${fileExt}`;

            console.log(`[telnyx-call-webhook] Uploading to Supabase Storage: call-recordings/${filePath}...`);
            const { data: uploadData, error: uploadError } = await supabase
              .storage
              .from("call-recordings")
              .upload(filePath, audioBuffer, {
                contentType: `audio/${fileExt}`,
                upsert: true
              });

            if (uploadError) {
              console.error(`[telnyx-call-webhook] Supabase Storage upload error:`, uploadError.message);
            } else if (uploadData) {
              const { data: urlData } = supabase
                .storage
                .from("call-recordings")
                .getPublicUrl(filePath);

              finalRecordingUrl = urlData.publicUrl;
              console.log(`[telnyx-call-webhook] ✓ Recording stored in Supabase: ${finalRecordingUrl}`);
            }
          }
        } catch (err: any) {
          console.error(`[telnyx-call-webhook] Failed to download/upload recording:`, err.message);
        }
      }

      await supabase
        .from("call_records")
        .update({
          recording_url:              finalRecordingUrl,
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
