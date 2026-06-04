/**
 * process-outbound — Edge Function (Supabase Cron, every 1 minute)
 *
 * Outbound Worker: Scheduled Messages Processor — Multi-Canal
 *
 * Flow:
 *   1. Fetch pending messages from outbound_message_queue where scheduled_at <= now
 *   2. Use advisory lock to prevent parallel processing
 *   3. Render template (canal-específico: sms_* para SMS, padrão para demais)
 *   4. Rotear por notification_channel:
 *        whatsapp  → OutboxDispatcher (Z-API / Cloud API)  ← existente
 *        instagram → MetaSocialClient.sendInstagramMessage
 *        facebook  → MetaSocialClient.sendFacebookMessage
 *        sms       → TelnyxSmsClient.sendSms
 *   5. Update status in outbound_message_queue
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { getRenderedMessage, getSmsTemplate } from "../_shared/messageTemplates.ts";
import { MetaSocialClient, MetaSocialError } from "../_shared/metaSocialClient.ts";
import { TelnyxSmsClient } from "../_shared/telnyxSmsClient.ts";
import { getTelnyxApiKey } from "../_shared/masterConfig.ts";
import { corsHeaders } from "../_shared/cors.ts";

console.log("process-outbound v3 — Multi-Canal Initialized");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase           = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const now = new Date().toISOString();
    console.log(`[process-outbound] Checking queue at ${now}`);

    // ── Quiet Hours Guard ────────────────────────────────────────────────────
    const brazilHour = parseInt(
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false
      }).format(new Date()), 10
    );
    const isQuietHours = brazilHour >= 22 || brazilHour < 8;
    if (isQuietHours) {
      console.log(`[process-outbound] Quiet hours (${brazilHour}h Brazil). Skipping.`);
      return new Response(JSON.stringify({ processed: 0, reason: "quiet_hours" }), { headers: corsHeaders });
    }

    // 1. Fetch pending messages
    const { data: queue, error: fetchErr } = await supabase
      .from('outbound_message_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .lt('attempts', 3)
      .order('scheduled_at', { ascending: true })
      .limit(20);

    if (fetchErr) throw fetchErr;
    if (!queue?.length) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: corsHeaders });
    }

    console.log(`[process-outbound] Found ${queue.length} eligible messages`);

    // 2. Fetch tenant credentials (WhatsApp + Telnyx SMS)
    const tenantIds = [...new Set(queue.map((m: any) => m.tenant_id))];
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, name, zapi_instance_id, zapi_token, zapi_client_token, whatsapp_provider, cloud_api_phone_number_id, cloud_api_access_token, telnyx_api_key, sms_enabled')
      .in('id', tenantIds);

    const tenantMap: Record<string, any> = Object.fromEntries(
      (tenants ?? []).map((t: any) => [t.id, t])
    );

    // 3. Fetch Meta pages for Instagram/Facebook messages
    const socialTenantIds = queue
      .filter((m: any) => ['instagram', 'facebook'].includes(m.notification_channel))
      .map((m: any) => m.tenant_id);

    let metaPagesMap: Record<string, { instagram?: any; facebook?: any }> = {};

    if (socialTenantIds.length > 0) {
      const { data: metaPages } = await supabase
        .from('tenant_meta_pages')
        .select('tenant_id, page_id, page_access_token, instagram_account_id')
        .in('tenant_id', [...new Set(socialTenantIds)])
        .eq('is_active', true);

      for (const page of metaPages ?? []) {
        if (!metaPagesMap[page.tenant_id]) metaPagesMap[page.tenant_id] = {};
        // Primeira página com Instagram vinculado → usada para DM do Instagram
        if (page.instagram_account_id && !metaPagesMap[page.tenant_id].instagram) {
          metaPagesMap[page.tenant_id].instagram = page;
        }
        // Primeira página ativa → usada para Facebook Messenger
        if (!metaPagesMap[page.tenant_id].facebook) {
          metaPagesMap[page.tenant_id].facebook = page;
        }
      }
    }

    const outbox = new OutboxDispatcher(supabase);
    let processed = 0;

    for (const msg of queue) {
      // Advisory lock
      const { data: lockResult, error: lockErr } = await supabase.rpc("pg_try_advisory_lock", { key: crc32(msg.id) });
      if (lockErr || !lockResult) {
        console.log(`[process-outbound] Lock not acquired for msg ${msg.id}`);
        continue;
      }

      // Cancelar booking_confirmed (sempre enviado manualmente pelo agente)
      if (msg.message_type === 'booking_confirmed' || msg.template_key === 'booking_confirmed') {
        await supabase.from('outbound_message_queue')
          .update({ status: 'cancelled', error_log: 'Duplicate of manual confirmation' })
          .eq('id', msg.id);
        continue;
      }

      try {
        await supabase.from('outbound_message_queue').update({ status: 'processing' }).eq('id', msg.id);

        // Pular reminder se já confirmado
        if ((msg.message_type === 'reminder_24h' || msg.message_type === 'reminder_2h') && msg.reference_id) {
          const { data: appt } = await supabase
            .from('appointments').select('confirmation_status')
            .eq('id', msg.reference_id).maybeSingle();
          if (appt?.confirmation_status === 'confirmed') {
            await supabase.from('outbound_message_queue').update({ status: 'cancelled' }).eq('id', msg.id);
            continue;
          }
        }

        // Renderizar template (canal-específico para SMS)
        let text = "";
        if (msg.is_edited && msg.template_vars?.override_message) {
          text = msg.template_vars.override_message;
        } else if (msg.notification_channel === 'sms') {
          // Templates SMS: versão compacta sem markdown/emojis
          text = getSmsTemplate(msg.template_key, msg.template_vars);
        } else {
          text = getRenderedMessage(msg.template_key, msg.template_vars);
        }

        const tenant    = tenantMap[msg.tenant_id];
        const channel   = msg.notification_channel ?? 'whatsapp';
        const recipient = msg.channel_recipient_id ?? msg.patient_phone;

        console.log(`[process-outbound] Sending via '${channel}' to ${recipient}`);

        // ══ ROTEADOR MULTI-CANAL ══════════════════════════════════════════════
        switch (channel) {

          // ── WhatsApp (Z-API ou Cloud API) ────────────────────────────────
          case 'whatsapp': {
            if (!tenant?.zapi_instance_id && !tenant?.cloud_api_phone_number_id) {
              throw new Error(`WhatsApp credentials missing for tenant ${msg.tenant_id}`);
            }
            if (msg.media_url) {
              await outbox.sendMedia(tenant, recipient, {
                media_url:  msg.media_url,
                media_type: msg.media_type || 'video',
                caption:    text,
              });
            } else {
              await outbox.sendNow(tenant, recipient, { text });
            }
            break;
          }

          // ── Instagram Direct Message ─────────────────────────────────────
          case 'instagram': {
            const page = metaPagesMap[msg.tenant_id]?.instagram;
            if (!page) {
              throw new Error(`No active Instagram page for tenant ${msg.tenant_id}. Connect a page in Settings.`);
            }
            await MetaSocialClient.sendInstagramMessage(
              page.page_access_token,
              page.instagram_account_id,
              recipient,   // IGSID capturado do webhook
              text
            );
            break;
          }

          // ── Facebook Messenger ───────────────────────────────────────────
          case 'facebook': {
            const page = metaPagesMap[msg.tenant_id]?.facebook;
            if (!page) {
              throw new Error(`No active Facebook page for tenant ${msg.tenant_id}. Connect a page in Settings.`);
            }
            await MetaSocialClient.sendFacebookMessage(
              page.page_access_token,
              recipient,   // PSID capturado do webhook
              text
            );
            break;
          }

          // ── SMS via Telnyx ───────────────────────────────────────────────
          case 'sms': {
            // Prioridade: tenant key → Supabase Secret → master_config (UI)
            const smsApiKey = await getTelnyxApiKey(supabase, tenant?.telnyx_api_key);
            if (!smsApiKey || !tenant?.sms_enabled) {
              throw new Error(`SMS (Telnyx) not configured. Set TELNYX_API_KEY in /master/intelligence`);
            }
            // Número remetente: primeiro número ativo do tenant
            const { data: senderRow } = await supabase
              .from('tenant_phone_numbers')
              .select('phone_number')
              .eq('tenant_id', msg.tenant_id)
              .eq('is_active', true)
              .contains('capabilities', { sms: true })
              .limit(1)
              .maybeSingle();

            if (!senderRow) {
              throw new Error(`No active SMS number for tenant ${msg.tenant_id}`);
            }

            const smsClient = new TelnyxSmsClient(smsApiKey);
            await smsClient.sendSms(senderRow.phone_number, recipient, text);

            // Rastrear uso: SMS outbound
            const billingPeriod = new Date();
            const periodStr = `${billingPeriod.getFullYear()}-${String(billingPeriod.getMonth() + 1).padStart(2, "0")}-01`;
            await supabase.from("tenant_usage_log").insert({
              tenant_id:           msg.tenant_id,
              resource_type:       "sms_outbound",
              resource_id:         msg.id,
              quantity:            1,
              unit_cost_usd:       0.007,   // custo Telnyx por SMS enviado
              total_cost_usd:      0.007,
              billing_period:      periodStr,
              tenant_phone_number: senderRow.phone_number,
            }).catch(() => {}); // não bloquear por falha de tracking
            break;
          }

          default:
            throw new Error(`Unknown notification_channel: ${channel}`);
        }
        // ════════════════════════════════════════════════════════════════════

        // Sucesso
        await supabase.from('outbound_message_queue').update({
          status:  'sent',
          sent_at: new Date().toISOString(),
        }).eq('id', msg.id);

        // Rastrear confirmação de 48h
        if (msg.message_type === 'reminder_48h' && msg.reference_id) {
          await supabase.from('appointments')
            .update({ confirmation_status: 'awaiting' })
            .eq('id', msg.reference_id)
            .is('confirmation_status', null);
        }

        processed++;
        console.log(`[process-outbound] ✓ [${channel}] ${msg.template_key} → ${recipient}`);

      } catch (e: any) {
        console.error(`[process-outbound] Error msg ${msg.id}:`, e.message);

        // Tratamento especial para erros da Meta (janela 24h, token revogado)
        let finalError = e.message;
        let finalStatus = 'pending';
        const newAttempts = (msg.attempts || 0) + 1;

        if (e instanceof MetaSocialError) {
          if (e.isWindowExpired) {
            // Janela de 24h expirada — não vai funcionar em retry. Cancelar.
            finalStatus = 'failed';
            finalError = `Meta ${e.channel}: 24h window expired. Patient must send a message first.`;
          } else if (e.isTokenInvalid) {
            // Token revogado — marcar página como inativa e falhar
            finalStatus = 'failed';
            finalError = `Meta ${e.channel}: Page token invalid. Reconnect in Settings → Integrações.`;
            // Desativar a página problemática
            await supabase.from('tenant_meta_pages')
              .update({ is_active: false })
              .eq('tenant_id', msg.tenant_id)
              .eq('is_active', true);
          }
        }

        if (finalStatus === 'pending' && newAttempts >= 3) finalStatus = 'failed';

        await supabase.from('outbound_message_queue').update({
          status:        finalStatus === 'pending' ? (newAttempts >= 3 ? 'failed' : 'pending') : finalStatus,
          attempts:      newAttempts,
          error_message: finalError,
        }).eq('id', msg.id);

      } finally {
        await supabase.rpc("pg_advisory_unlock", { key: crc32(msg.id) });
      }
    }

    console.log(`[process-outbound] Completed. Processed: ${processed}`);
    return new Response(JSON.stringify({ processed }), { headers: corsHeaders });

  } catch (err: any) {
    console.error("[process-outbound] Fatal error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

function crc32(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
