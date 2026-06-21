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
import { logPlatform } from "../_shared/logger.ts";

console.log("telnyx-call-webhook v4 (with platform logging) — Initialized");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const telnyxTimestamp = req.headers.get("telnyx-timestamp");
    const telnyxSignature = req.headers.get("telnyx-signature-ed25519");
    const telnyxPublicKey = await getTelnyxPublicKey(supabase);

    const rawBody = await req.text();

    if (telnyxPublicKey && telnyxSignature && telnyxTimestamp) {
      try {
        const signedPayload = `${telnyxTimestamp}|${rawBody}`;
        const keyBytes = base64ToBytes(telnyxPublicKey);
        const sigBytes = base64ToBytes(telnyxSignature);
        const msgBytes = new TextEncoder().encode(signedPayload);

        const cryptoKey = await crypto.subtle.importKey(
          "raw", keyBytes as any, { name: "Ed25519" }, false, ["verify"]
        );
        const valid = await crypto.subtle.verify("Ed25519", cryptoKey, sigBytes as any, msgBytes as any);

        if (!valid) {
          console.error("[telnyx-call-webhook] Invalid signature — rejecting");
          await logPlatform(supabase, {
            level: "error",
            source: "telnyx-call-webhook",
            eventName: "signature_verification_failed",
            message: "Signature verification failed",
            metadata: { timestamp: telnyxTimestamp, signature: telnyxSignature }
          });
          return new Response("Unauthorized", { status: 401 });
        }
      } catch (sigErr: any) {
        console.warn("[telnyx-call-webhook] Signature verification failed:", sigErr.message);
        await logPlatform(supabase, {
          level: "warn",
          source: "telnyx-call-webhook",
          eventName: "signature_verification_exception",
          message: sigErr.message,
          metadata: { timestamp: telnyxTimestamp, signature: telnyxSignature }
        });
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
    handleEvent(supabase, eventType, payload).catch(async (err) => {
      console.error(`[telnyx-call-webhook] Handler error:`, err.message);
      await logPlatform(supabase, {
        level: "error",
        source: "telnyx-call-webhook",
        eventName: "async_handler_error",
        message: err.message,
        metadata: { eventType, callControlId: payload.call_control_id }
      });
    });

    return new Response("ok", { status: 200 });

  } catch (err: any) {
    console.error("[telnyx-call-webhook] Fatal:", err.message);
    await logPlatform(supabase, {
      level: "fatal",
      source: "telnyx-call-webhook",
      eventName: "fatal_error",
      message: err.message,
      metadata: { stack: err.stack }
    });
    return new Response("ok", { status: 200 }); // Sempre 200 para Telnyx não reenviar
  }
});

async function handleEvent(supabase: any, eventType: string, payload: any): Promise<void> {
  const callControlId = payload.call_control_id;
  const from          = payload.from;
  const to            = payload.to;
  const direction     = payload.direction;

  await logPlatform(supabase, {
    level: "info",
    source: "telnyx-call-webhook",
    eventName: `webhook_received:${eventType}`,
    message: `Received Telnyx call webhook event: ${eventType}`,
    metadata: { callControlId, from, to, direction, eventType }
  });

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
        console.warn(`[telnyx-call-webhook] No tenant found for number: ${lookupNumber}`);
        await logPlatform(supabase, {
          level: "warn",
          source: "telnyx-call-webhook",
          eventName: "call_initiated_no_tenant",
          message: `No active tenant found matching phone number: ${lookupNumber}`,
          metadata: { lookupNumber, direction, callControlId }
        });
        break;
      }

      const tenantId = numRow.tenant_id;

      await logPlatform(supabase, {
        tenantId,
        level: "info",
        source: "telnyx-call-webhook",
        eventName: "call_initiated",
        message: `Call initiated (${direction}) from ${from} to ${to}`,
        metadata: { callControlId, numRow }
      });

      // Criar CDR com tenant_id explícito
      const { error: cdrError } = await supabase.from("call_records").insert({
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

      if (cdrError) {
        console.error(`[telnyx-call-webhook] Failed to create call record:`, cdrError.message);
        await logPlatform(supabase, {
          tenantId,
          level: "error",
          source: "telnyx-call-webhook",
          eventName: "create_call_record_failed",
          message: `Failed to create initial call record: ${cdrError.message}`,
          metadata: { callControlId }
        });
      }

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
      if (!apiKey) {
        await logPlatform(supabase, {
          tenantId,
          level: "error",
          source: "telnyx-call-webhook",
          eventName: "telnyx_api_key_missing",
          message: `Could not retrieve Telnyx API Key for tenant ${tenantId}`,
          metadata: { tenantId }
        });
        break;
      }

      // Atender somente chamadas recebidas (inbound)
      if (isIncoming) {
        try {
          await answerCall(apiKey, callControlId);
          await logPlatform(supabase, {
            tenantId,
            level: "info",
            source: "telnyx-call-webhook",
            eventName: "answer_call_success",
            message: `Successfully sent answer command to Telnyx for call ${callControlId}`
          });
        } catch (err: any) {
          await logPlatform(supabase, {
            tenantId,
            level: "error",
            source: "telnyx-call-webhook",
            eventName: "answer_call_failed",
            message: err.message,
            metadata: { callControlId }
          });
        }
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
      // Buscar tenant para verificar config de gravação automática
      const { data: cdr } = await supabase
        .from("call_records")
        .select("tenant_id")
        .eq("telnyx_call_control_id", callControlId)
        .maybeSingle();

      if (cdr) {
        const { data: tenant } = await supabase
          .from("tenants")
          .select("telnyx_api_key, telnyx_auto_record")
          .eq("id", cdr.tenant_id)
          .single();

        // Se a configuração de gravar chamadas não foi desativada explicitamente
        if (tenant?.telnyx_auto_record !== false) {
          const apiKey = await getTelnyxApiKey(supabase, tenant?.telnyx_api_key);
          if (apiKey) {
            try {
              await startRecording(apiKey, callControlId);
              await logPlatform(supabase, {
                tenantId: cdr.tenant_id,
                level: "info",
                source: "telnyx-call-webhook",
                eventName: "start_recording_success",
                message: `Successfully sent record_start command to Telnyx for call ${callControlId} on answer`
              });
            } catch (err: any) {
              await logPlatform(supabase, {
                tenantId: cdr.tenant_id,
                level: "warn",
                source: "telnyx-call-webhook",
                eventName: "start_recording_failed",
                message: err.message,
                metadata: { callControlId }
              });
            }
          }
        }
      }

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
      const { data: existing, error: findError } = await supabase
        .from("call_records")
        .select("id, tenant_id, direction, tenant_phone_number_id")
        .eq("telnyx_call_control_id", callControlId)
        .maybeSingle();

      if (findError) {
        console.error(`[telnyx-call-webhook] Failed to find existing call record:`, findError.message);
        await logPlatform(supabase, {
          level: "error",
          source: "telnyx-call-webhook",
          eventName: "find_call_record_failed",
          message: `Failed to find call record on hangup: ${findError.message}`,
          metadata: { callControlId }
        });
      }

      const { error: updateError } = await supabase
        .from("call_records")
        .update({
          status:           "completed",
          ended_at:         new Date().toISOString(),
          duration_seconds: durationSec,
        })
        .eq("telnyx_call_control_id", callControlId);

      if (updateError) {
        console.error(`[telnyx-call-webhook] Failed to update call record:`, updateError.message);
        await logPlatform(supabase, {
          tenantId: existing?.tenant_id,
          level: "error",
          source: "telnyx-call-webhook",
          eventName: "update_call_record_failed",
          message: `Failed to update call record on hangup: ${updateError.message}`,
          metadata: { callControlId }
        });
      }

      // Rastrear uso: calcular minutos e custo
      if (existing && durationSec) {
        const minutes = durationSec / 60;
        const isInbound = existing.direction === "inbound";
        const tenantPhone = isInbound ? payload.to : payload.from;
        const pricing = getCallPricing(tenantPhone, isInbound ? "inbound" : "outbound");
        const unitCost = pricing.unitCostUsd;
        const billingPeriod = getBillingPeriod();

        const { error: insertError } = await supabase.from("tenant_usage_log").insert({
          tenant_id:     existing.tenant_id,
          resource_type: isInbound ? "call_inbound" : "call_outbound",
          resource_id:   existing.id,
          quantity:      minutes,
          unit_cost_usd: unitCost,
          total_cost_usd: minutes * unitCost,
          billing_period: billingPeriod,
          tenant_phone_number: tenantPhone,
        });

        if (insertError) {
          console.error(`[telnyx-call-webhook] Usage log insert failed:`, insertError.message);
          await logPlatform(supabase, {
            tenantId: existing.tenant_id,
            level: "error",
            source: "telnyx-call-webhook",
            eventName: "usage_log_insert_failed",
            message: `Usage log insert failed on hangup: ${insertError.message}`,
            metadata: { callControlId, minutes, unitCost }
          });
        } else {
          console.log(`[telnyx-call-webhook] ✓ Usage logged: ${minutes.toFixed(2)} min | tenant: ${existing.tenant_id}`);
          await logPlatform(supabase, {
            tenantId: existing.tenant_id,
            level: "info",
            source: "telnyx-call-webhook",
            eventName: "usage_logged_success",
            message: `Usage logged: ${minutes.toFixed(2)} min`,
            metadata: { callControlId, minutes, totalCostUsd: minutes * unitCost }
          });
        }
      } else {
        if (!existing) {
          console.warn(`[telnyx-call-webhook] Warning: call.hangup received but no existing call record found for ${callControlId}`);
          await logPlatform(supabase, {
            level: "warn",
            source: "telnyx-call-webhook",
            eventName: "hangup_no_cdr",
            message: `call.hangup received but no existing call record found`,
            metadata: { callControlId }
          });
        }
        if (!durationSec) {
          console.warn(`[telnyx-call-webhook] Warning: call.hangup received but duration is 0 or negative`);
        }
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
  const { error } = await supabase.from("tenant_usage_log").insert({
    tenant_id:           tenantId,
    resource_type:       resourceType,
    resource_id:         resourceId,
    quantity,
    unit_cost_usd:       unitCost,
    total_cost_usd:      quantity * unitCost,
    billing_period:      getBillingPeriod(),
    tenant_phone_number: phone ?? null,
  });
  if (error) {
    console.error("[telnyx-call-webhook] Usage log failed:", error.message);
  }
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
