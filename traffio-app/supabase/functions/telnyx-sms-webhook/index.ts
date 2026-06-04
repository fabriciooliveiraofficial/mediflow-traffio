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

console.log("telnyx-sms-webhook v1 — Initialized");

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

    if (eventType !== "message.received") {
      return response200;
    }

    const msg  = body.data?.payload;
    const from = msg?.from?.phone_number;
    const to   = msg?.to?.[0]?.phone_number;
    const text = msg?.text ?? "";
    const msgId = msg?.id;

    if (!from || !to || !text || !msgId) return response200;

    console.log(`[telnyx-sms-webhook] SMS from ${from} to ${to}: "${text.substring(0, 50)}"`);

    // Processar assincronamente
    processInboundSms(supabase, from, to, text, msgId).catch((err) =>
      console.error("[telnyx-sms-webhook] Error:", err.message)
    );

    return response200;

  } catch (err: any) {
    console.error("[telnyx-sms-webhook] Fatal:", err.message);
    return response200;
  }
});

async function processInboundSms(
  supabase: any,
  from: string,
  to: string,
  text: string,
  msgId: string
): Promise<void> {
  // Identificar tenant pelo número destino
  const { data: numRow } = await supabase
    .from("tenant_phone_numbers")
    .select("tenant_id")
    .eq("phone_number", to)
    .eq("is_active", true)
    .maybeSingle();

  if (!numRow) {
    console.warn(`[telnyx-sms-webhook] No tenant for number ${to}`);
    return;
  }

  const tenantId = numRow.tenant_id;

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

  // Inserir na message_inbox (inbox pattern)
  await supabase.from("message_inbox").insert({
    tenant_id:   tenantId,
    phone:       from,
    content:     text,
    message_id:  msgId,
    status:      "pending",
    received_at: new Date().toISOString(),
  });

  // Rastrear uso: SMS inbound
  const billingPeriod = new Date();
  const periodStr = `${billingPeriod.getFullYear()}-${String(billingPeriod.getMonth() + 1).padStart(2, "0")}-01`;
  await supabase.from("tenant_usage_log").insert({
    tenant_id:           tenantId,
    resource_type:       "sms_inbound",
    quantity:            1,
    unit_cost_usd:       0.004,   // custo Telnyx por SMS recebido
    total_cost_usd:      0.004,
    billing_period:      periodStr,
    tenant_phone_number: to,
  }).catch(() => {}); // não bloquear por falha de tracking

  console.log(`[telnyx-sms-webhook] ✓ SMS queued from ${from} | tenant ${tenantId}`);
}
