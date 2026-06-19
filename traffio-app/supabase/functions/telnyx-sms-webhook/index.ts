/**
 * telnyx-sms-webhook — Edge Function
 *
 * Recebe SMS inbound via Telnyx.
 * Configurar no portal Telnyx: Messaging → Messaging Profiles
 *   → Inbound Webhook URL: {SUPABASE_URL}/functions/v1/telnyx-sms-webhook
 *
 * Segue o mesmo Inbox Pattern do whatsapp-bot:
 *   Telnyx → webhook → message_inbox → process-inbox → SessionManager
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { upsertChannelPreference } from "../_shared/upsertChannelPreference.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsPricing } from "../_shared/pricing.ts";
import { downloadRecording } from "../_shared/telnyxClient.ts";
import { getTelnyxApiKey } from "../_shared/masterConfig.ts";
import { logPlatform } from "../_shared/logger.ts";

console.log("telnyx-sms-webhook v2 (with platform logging) — Initialized");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Responder 200 imediatamente — Telnyx exige resposta rápida
  const response200 = new Response("ok", { status: 200 });

  try {
    const body      = await req.json();
    const eventType = body.data?.event_type;

    await logPlatform(supabase, {
      level: "info",
      source: "telnyx-sms-webhook",
      eventName: `webhook_received:${eventType || "unknown"}`,
      message: `Received SMS webhook event`,
      metadata: { body }
    });

    if (eventType !== "message.received") {
      return response200;
    }

    const msg  = body.data?.payload;
    const from = msg?.from?.phone_number;
    const to   = msg?.to?.[0]?.phone_number;
    const msgId = msg?.id;

    if (!from || !to || !msgId) return response200;

    const text = msg?.text ?? "";
    console.log(`[telnyx-sms-webhook] SMS/MMS from ${from} to ${to}: "${text.substring(0, 50)}"`);

    // Processar assincronamente
    processInboundSms(supabase, from, to, msg, msgId).catch(async (err) => {
      console.error("[telnyx-sms-webhook] Error:", err.message);
      await logPlatform(supabase, {
        level: "error",
        source: "telnyx-sms-webhook",
        eventName: "async_process_error",
        message: err.message,
        metadata: { from, to, msgId }
      });
    });

    return response200;

  } catch (err: any) {
    console.error("[telnyx-sms-webhook] Fatal:", err.message);
    await logPlatform(supabase, {
      level: "fatal",
      source: "telnyx-sms-webhook",
      eventName: "fatal_error",
      message: err.message,
      metadata: { stack: err.stack }
    });
    return response200;
  }
});

async function processInboundSms(
  supabase: any,
  from: string,
  to: string,
  msg: any,
  msgId: string
): Promise<void> {
  const text = msg?.text ?? "";
  const mediaList = msg?.media ?? [];

  // Identificar tenant pelo número destino
  const { data: numRow } = await supabase
    .from("tenant_phone_numbers")
    .select("tenant_id, country_code")
    .eq("phone_number", to)
    .eq("is_active", true)
    .maybeSingle();

  if (!numRow) {
    console.warn(`[telnyx-sms-webhook] No tenant for number ${to}`);
    await logPlatform(supabase, {
      level: "warn",
      source: "telnyx-sms-webhook",
      eventName: "no_tenant_found",
      message: `No active tenant found matching SMS destination phone number: ${to}`,
      metadata: { from, to, msgId }
    });
    return;
  }

  const tenantId = numRow.tenant_id;

  await logPlatform(supabase, {
    tenantId,
    level: "info",
    source: "telnyx-sms-webhook",
    eventName: "message_processing",
    message: `Processing inbound SMS/MMS from ${from} to ${to}`,
    metadata: { msgId, text, mediaCount: mediaList.length }
  });

  // Idempotência
  const { data: already } = await supabase
    .from("message_inbox")
    .select("id")
    .eq("message_id", msgId)
    .maybeSingle();

  if (already) return;

  // Salvar preferência de canal SMS
  await upsertChannelPreference(supabase, tenantId, from, {
    preferred_channel: "sms",
    sms_phone:         from,
  });

  // Garantir conversation_session
  const { data: session } = await supabase
    .from("conversation_sessions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("patient_phone", from)
    .maybeSingle();

  if (!session) {
    await supabase.from("conversation_sessions").insert({
      tenant_id:          tenantId,
      patient_phone:      from,
      channel:            "sms",
      current_state:      "INIT",
      omnichannel_status: "bot_active",
      context:            {},
    });
  }

  let mediaUrl: string | null = null;
  let messageType = "text";
  let content = text;

  // Se houver mídia (MMS)
  if (mediaList.length > 0) {
    try {
      const firstMedia = mediaList[0];
      const telnyxMediaUrl = firstMedia.url;
      const contentType = firstMedia.content_type ?? "application/octet-stream";

      // Mapear tipo
      if (contentType.startsWith("image/")) {
        messageType = "image";
      } else if (contentType.startsWith("audio/")) {
        messageType = "audio";
      } else if (contentType.startsWith("video/")) {
        messageType = "video";
      } else {
        messageType = "document";
      }

      // Buscar API Key
      const { data: tenant } = await supabase
        .from("tenants")
        .select("telnyx_api_key")
        .eq("id", tenantId)
        .single();
      const apiKey = await getTelnyxApiKey(supabase, tenant?.telnyx_api_key);

      if (apiKey && telnyxMediaUrl) {
        console.log(`[telnyx-sms-webhook] Downloading MMS media from ${telnyxMediaUrl}...`);
        const mediaBuffer = await downloadRecording(apiKey, telnyxMediaUrl);

        // Obter extensão
        let ext = "bin";
        if (contentType.includes("/")) {
          ext = contentType.split("/")[1].split(";")[0];
        }
        const filePath = `${tenantId}/messages/${msgId}.${ext}`;

        console.log(`[telnyx-sms-webhook] Uploading MMS media to Supabase Storage: chat-media/${filePath}...`);
        const { data: uploadData, error: uploadError } = await supabase
          .storage
          .from("chat-media")
          .upload(filePath, mediaBuffer, {
            contentType,
            upsert: true
          });

        if (uploadError) {
          console.error(`[telnyx-sms-webhook] Storage upload error:`, uploadError.message);
        } else if (uploadData) {
          const { data: urlData } = supabase
            .storage
            .from("chat-media")
            .getPublicUrl(filePath);

          mediaUrl = urlData.publicUrl;
          console.log(`[telnyx-sms-webhook] ✓ MMS media public URL: ${mediaUrl}`);
        }
      }

      // Definir conteúdo padrão caso o texto seja vazio
      if (!content) {
        const labels: Record<string, string> = {
          image: "[imagem]",
          audio: "[áudio]",
          video: "[vídeo]",
          document: "[documento]"
        };
        content = labels[messageType] ?? "[mídia]";
      }

    } catch (mediaErr: any) {
      console.error(`[telnyx-sms-webhook] Failed to process MMS media:`, mediaErr.message);
      await logPlatform(supabase, {
        tenantId,
        level: "error",
        source: "telnyx-sms-webhook",
        eventName: "media_process_error",
        message: mediaErr.message,
        metadata: { msgId, mediaList }
      });
    }
  }

  // Inserir na message_inbox (inbox pattern)
  await supabase.from("message_inbox").insert({
    tenant_id:    tenantId,
    phone:        from,
    content:      content,
    message_id:   msgId,
    status:       "pending",
    media_url:    mediaUrl,
    message_type: messageType,
    received_at:  new Date().toISOString(),
  });

  // Rastrear uso: SMS inbound
  const pricing = getSmsPricing(numRow?.country_code ?? "US", "sms");
  const billingPeriod = new Date();
  const periodStr = `${billingPeriod.getFullYear()}-${String(billingPeriod.getMonth() + 1).padStart(2, "0")}-01`;
  await supabase.from("tenant_usage_log").insert({
    tenant_id:           tenantId,
    resource_type:       "sms_inbound",
    quantity:            1,
    unit_cost_usd:       pricing.unitCostUsd,
    total_cost_usd:      pricing.unitCostUsd,
    billing_period:      periodStr,
    tenant_phone_number: to,
  }).catch(() => {}); // não bloquear por falha de tracking

  console.log(`[telnyx-sms-webhook] ✓ Message queued from ${from} | tenant ${tenantId}`);
}
