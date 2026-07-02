/**
 * process-outbound — Edge Function (Supabase Cron, every 1 minute)
 *
 * Outbound Worker: Scheduled Messages Processor — Multi-Canal (escala)
 *
 * Flow:
 *   1. claim_outbound_messages() — reivindica um lote justo e atômico (SKIP LOCKED +
 *      cap por tenant). Substitui SELECT + advisory lock + UPDATE processing por mensagem.
 *   2. Batch-fetch de tenants, status de agendamentos, páginas Meta e números SMS
 *      (1 query cada para o lote inteiro — sem N+1).
 *   3. Envio em paralelo com concorrência limitada.
 *   4. Roteamento por notification_channel (whatsapp / instagram / facebook / sms).
 *   5. Atualiza status individualmente (seguro contra reenvio em caso de crash).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { getRenderedMessage, getSmsTemplate } from "../_shared/messageTemplates.ts";
import { MetaSocialClient, MetaSocialError } from "../_shared/metaSocialClient.ts";
import { TelnyxSmsClient } from "../_shared/telnyxSmsClient.ts";
import { getTelnyxApiKey } from "../_shared/masterConfig.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsPricing } from "../_shared/pricing.ts";
import { logPlatform } from "../_shared/logger.ts";

console.log("process-outbound v4 — Fair-claim + paralelo Initialized");

// Substitui {{placeholders}} pelo valor real das template_vars do agendamento
function renderCustomCaptionFromVars(template: string, vars: any): string {
  if (!template || !vars) return template;
  let rendered = template;
  const map: Record<string, string> = {
    '{{nome_paciente}}':        vars.patient_name      || '',
    '{{data_agendamento}}':     vars.date              || '',
    '{{horario_agendamento}}':  vars.time              || '',
    '{{slot_agendado}}':        vars.time              || '',
    '{{nome_doutor}}':          vars.doctor_name       || '',
    '{{nome_do_profissional}}': vars.doctor_name       || '',
    '{{nome_procedimento}}':    vars.procedure_name    || '',
    '{{nome_local}}':           vars.location_name     || '',
    '{{link_endereco}}':        vars.location_link     || '',
    '{{link_sala_espera}}':     vars.waiting_room_link || '',
    '{{sala_de_espera}}':       vars.waiting_room_link || '',
    '{{link_checkin}}':         vars.checkin_link      || '',
    '{{nome_clinica}}':         vars.clinic_name       || '',
  };
  for (const [key, val] of Object.entries(map)) {
    rendered = rendered.replaceAll(key, val);
  }
  return rendered;
}

// Cadência de recuperação do CRM (Faltou → D0/D2/D7) + reativação (recall_due)
const RECOVERY_TEMPLATE_KEYS = ['recovery_immediate', 'recovery_48h', 'recovery_7d', 'recall_immediate'];

// Resolve a caption personalizada do bot_config do tenant para um lembrete.
// Retorna null se não houver caption configurada para este template/idioma.
function resolveTenantCaption(
  templateKey: string,
  botConfig: any,
  locale: string,
): string | null {
  if (!botConfig) return null;

  let captionObj: any = null;

  if (templateKey.startsWith('appointment_reminder_custom_')) {
    const mins = parseInt(templateKey.replace('appointment_reminder_custom_', '').replace('m', ''), 10);
    const reminder = (botConfig.custom_reminders as any[] | undefined)?.find(
      (r: any) => Math.abs(r.offset_minutes) === mins && r.offset_minutes < 0
    );
    captionObj = reminder?.caption ?? null;
  } else if (RECOVERY_TEMPLATE_KEYS.includes(templateKey)) {
    captionObj = botConfig.recovery_captions?.[templateKey] ?? null;
  } else {
    const stageMap: Record<string, string> = {
      'appointment_reminder_48h': '48h',
      'appointment_reminder_24h': '24h',
      'appointment_reminder_2h':  '2h',
      'appointment_reminder_15m': '15m',
    };
    const stage = stageMap[templateKey];
    if (stage) captionObj = botConfig.reminder_captions?.[stage] ?? null;
  }

  if (!captionObj) return null;

  let text = '';
  if (typeof captionObj === 'string') {
    text = captionObj;
  } else if (typeof captionObj === 'object') {
    text = captionObj[locale] || captionObj['pt'] || captionObj['en'] || captionObj['es'] || '';
  }
  return text || null;
}

function getLocalHourMinute(date: Date, timezone: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: false,
    }).formatToParts(date);
    return {
      hour:   parseInt(parts.find((p) => p.type === "hour")!.value, 10),
      minute: parseInt(parts.find((p) => p.type === "minute")!.value, 10),
    };
  } catch {
    return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
  }
}

// Quiet hours com grace window: mensagens já vencidas (scheduled_at <= now) que
// caem nos primeiros 30min do silêncio ainda são enviadas — evita que um backlog
// momentâneo empurre o lembrete para as 8h do dia seguinte, quando a consulta já
// teria passado. Fora dessa margem, respeita o silêncio normalmente.
function isBlockedByQuietHours(date: Date, timezone: string): boolean {
  const { hour, minute } = getLocalHourMinute(date, timezone);
  if (hour < 8) return true;
  if (hour > 22) return true;
  if (hour === 22 && minute >= 30) return true;
  return false;
}

// Pool de concorrência limitada — sem dependências externas.
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const size = Math.min(concurrency, items.length);
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase           = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Reivindicar lote justo e atômico (1 round-trip; já marca como 'processing')
    const { data: queue, error: claimErr } = await supabase.rpc("claim_outbound_messages", {
      p_batch_size:     150,
      p_per_tenant_cap: 15,
    });
    if (claimErr) throw claimErr;
    if (!queue?.length) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: corsHeaders });
    }

    console.log(`[process-outbound] Claimed ${queue.length} messages`);

    // 2. Batch-fetch de credenciais dos tenants
    const tenantIds = [...new Set(queue.map((m: any) => m.tenant_id))];
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, name, zapi_instance_id, zapi_token, zapi_client_token, whatsapp_provider, cloud_api_phone_number_id, cloud_api_access_token, telnyx_api_key, sms_enabled, bot_config, timezone')
      .in('id', tenantIds);
    const tenantMap: Record<string, any> = Object.fromEntries((tenants ?? []).map((t: any) => [t.id, t]));

    // 3. Batch-fetch dos status de agendamento (1 query p/ todos os guards — sem N+1)
    const apptIds = [...new Set(
      queue.filter((m: any) => m.reference_type === 'appointment' && m.reference_id)
           .map((m: any) => m.reference_id)
    )];
    const apptMap: Record<string, any> = {};
    if (apptIds.length > 0) {
      const { data: appts } = await supabase
        .from('appointments').select('id, status, confirmation_status')
        .in('id', apptIds);
      for (const a of appts ?? []) apptMap[a.id] = a;
    }

    // 4. Batch-fetch das páginas Meta (Instagram/Facebook)
    const socialTenantIds = queue
      .filter((m: any) => ['instagram', 'facebook'].includes(m.notification_channel))
      .map((m: any) => m.tenant_id);
    const metaPagesMap: Record<string, { instagram?: any; facebook?: any }> = {};
    if (socialTenantIds.length > 0) {
      const { data: metaPages } = await supabase
        .from('tenant_meta_pages')
        .select('tenant_id, page_id, page_access_token, instagram_account_id')
        .in('tenant_id', [...new Set(socialTenantIds)])
        .eq('is_active', true);
      for (const page of metaPages ?? []) {
        if (!metaPagesMap[page.tenant_id]) metaPagesMap[page.tenant_id] = {};
        if (page.instagram_account_id && !metaPagesMap[page.tenant_id].instagram) {
          metaPagesMap[page.tenant_id].instagram = page;
        }
        if (!metaPagesMap[page.tenant_id].facebook) {
          metaPagesMap[page.tenant_id].facebook = page;
        }
      }
    }

    // 5. Batch-fetch dos números SMS remetentes (1 query p/ todos os tenants SMS)
    const smsTenantIds = [...new Set(
      queue.filter((m: any) => m.notification_channel === 'sms').map((m: any) => m.tenant_id)
    )];
    const smsSenderMap: Record<string, any> = {};
    if (smsTenantIds.length > 0) {
      const { data: senders } = await supabase
        .from('tenant_phone_numbers')
        .select('tenant_id, phone_number, country_code')
        .in('tenant_id', smsTenantIds)
        .eq('is_active', true)
        .contains('capabilities', { sms: true });
      for (const s of senders ?? []) {
        if (!smsSenderMap[s.tenant_id]) smsSenderMap[s.tenant_id] = s;
      }
    }
    const telnyxKeyCache = new Map<string, string | null>();
    const getTelnyxKeyCached = async (tenantId: string, tenantKey: string | null) => {
      if (telnyxKeyCache.has(tenantId)) return telnyxKeyCache.get(tenantId) ?? null;
      const k = await getTelnyxApiKey(supabase, tenantKey);
      telnyxKeyCache.set(tenantId, k);
      return k;
    };

    const outbox = new OutboxDispatcher(supabase);
    let processed = 0;

    // 6. Processar o lote em paralelo (concorrência limitada)
    await runPool(queue, 15, async (msg: any) => {
      const tenant = tenantMap[msg.tenant_id];

      // ── Quiet Hours (timezone do tenant, com grace window de 30min) ──
      const tenantTimezone = tenant?.timezone || 'America/Sao_Paulo';
      if (isBlockedByQuietHours(new Date(), tenantTimezone)) {
        await supabase.from('outbound_message_queue')
          .update({ status: 'pending', claimed_at: null }).eq('id', msg.id);
        return;
      }

      // ── Guards (in-memory via apptMap — sem queries por mensagem) ──
      // booking_confirmed: sempre enviado manualmente pelo agente
      if (msg.message_type === 'booking_confirmed' || msg.template_key === 'booking_confirmed') {
        await supabase.from('outbound_message_queue')
          .update({ status: 'cancelled', error_message: 'Duplicate of manual confirmation' }).eq('id', msg.id);
        return;
      }

      const appt = msg.reference_id ? apptMap[msg.reference_id] : null;

      // Lembrete de agendamento cancelado/reagendado não deve ser enviado
      if (msg.template_key?.startsWith('appointment_reminder') && appt
          && !['scheduled', 'confirmed'].includes(appt.status)) {
        await supabase.from('outbound_message_queue')
          .update({ status: 'cancelled', error_message: `Appointment status is '${appt.status}' — reminder skipped` }).eq('id', msg.id);
        return;
      }

      // NPS só se o agendamento ainda está 'completed'
      if (msg.message_type === 'nps_survey' && appt && appt.status !== 'completed') {
        await supabase.from('outbound_message_queue')
          .update({ status: 'cancelled', error_message: `Appointment status is '${appt.status}', NPS cancelled` }).eq('id', msg.id);
        return;
      }

      // ── Recuperação (CRM): canal definido na Matriz de Canais do tenant ──
      // A fila é populada pelo motor SQL sem notification_channel; o canal de
      // entrega é decidido aqui via bot_config.channel_automations.<canal>.recovery.
      if (msg.reference_type === 'crm_journey' && RECOVERY_TEMPLATE_KEYS.includes(msg.template_key)) {
        const autos = tenant?.bot_config?.channel_automations ?? {};
        const waOn  = autos.whatsapp?.recovery !== false; // default: WhatsApp ligado
        const smsOn = autos.sms?.recovery === true;
        if (!waOn && !smsOn) {
          await supabase.from('outbound_message_queue')
            .update({ status: 'cancelled', error_message: 'Recovery automation disabled in channel matrix' }).eq('id', msg.id);
          return;
        }
        msg.notification_channel = waOn ? 'whatsapp' : 'sms';
      }

      try {
        // Pular reminder se já confirmado
        if ((msg.message_type === 'reminder_24h' || msg.message_type === 'reminder_2h')
            && appt?.confirmation_status === 'confirmed') {
          await supabase.from('outbound_message_queue').update({ status: 'cancelled' }).eq('id', msg.id);
          return;
        }

        // ── Renderizar texto: override manual → caption do tenant → template padrão ──
        let text = "";
        if (msg.is_edited && msg.template_vars?.override_message) {
          text = msg.template_vars.override_message;
        } else {
          // Idioma: vars da mensagem → idioma padrão do tenant (página Inteligência) → pt
          const locale = (msg.template_vars?.locale || tenant?.bot_config?.notification_locale || 'pt') as string;
          const customCaption = resolveTenantCaption(msg.template_key, tenant?.bot_config, locale);
          if (customCaption) {
            text = renderCustomCaptionFromVars(customCaption, msg.template_vars);
          } else if (msg.notification_channel === 'sms') {
            text = getSmsTemplate(msg.template_key, { ...msg.template_vars, locale });
          } else {
            text = getRenderedMessage(msg.template_key, { ...msg.template_vars, locale });
          }
        }

        // Template inexistente nunca deve chegar ao paciente
        if (text.startsWith('[Template')) {
          await supabase.from('outbound_message_queue')
            .update({ status: 'failed', error_message: `Template '${msg.template_key}' not found — message blocked` }).eq('id', msg.id);
          return;
        }

        // NPS: caption customizada do tenant (variáveis {nome}/{clínica})
        const isNps = msg.template_key === 'nps_survey' || msg.message_type === 'nps_survey';
        if (!msg.is_edited && isNps && tenant?.bot_config?.nps_captions) {
          const rawLocale = (msg.template_vars?.locale || 'pt').toLowerCase();
          const langKey = rawLocale.startsWith('en') ? 'en' : rawLocale.startsWith('es') ? 'es' : 'pt';
          const customCaption = tenant.bot_config.nps_captions[langKey];
          if (customCaption) {
            const patientName = msg.template_vars?.patient_name || '';
            const clinicName  = msg.template_vars?.clinic_name  || '';
            text = customCaption
              .replace(/\{nome\}/g, patientName)
              .replace(/\{clínica\}/g, clinicName)
              .replace(/\{clinic_name\}/g, clinicName)
              .replace(/\{patient_name\}/g, patientName);
          }
        }

        const channel   = msg.notification_channel ?? 'whatsapp';
        const recipient = msg.channel_recipient_id ?? msg.patient_phone;

        // ══ ROTEADOR MULTI-CANAL ══════════════════════════════════════════════
        switch (channel) {
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

          case 'instagram': {
            const page = metaPagesMap[msg.tenant_id]?.instagram;
            if (!page) throw new Error(`No active Instagram page for tenant ${msg.tenant_id}. Connect a page in Settings.`);
            await MetaSocialClient.sendInstagramMessage(page.page_access_token, page.instagram_account_id, recipient, text);
            break;
          }

          case 'facebook': {
            const page = metaPagesMap[msg.tenant_id]?.facebook;
            if (!page) throw new Error(`No active Facebook page for tenant ${msg.tenant_id}. Connect a page in Settings.`);
            await MetaSocialClient.sendFacebookMessage(page.page_access_token, recipient, text);
            break;
          }

          case 'sms': {
            const smsApiKey = await getTelnyxKeyCached(msg.tenant_id, tenant?.telnyx_api_key);
            if (!smsApiKey || !tenant?.sms_enabled) {
              throw new Error(`SMS (Telnyx) not configured. Set TELNYX_API_KEY in /master/intelligence`);
            }
            const senderRow = smsSenderMap[msg.tenant_id];
            if (!senderRow) throw new Error(`No active SMS number for tenant ${msg.tenant_id}`);

            const smsClient = new TelnyxSmsClient(smsApiKey);
            const mediaUrls = msg.media_url ? [msg.media_url] : undefined;
            const toPhone = recipient.startsWith('+')
              ? recipient
              : `+${recipient.replace(/\D/g, '')}`;
            const fromPhone = senderRow.phone_number.startsWith('+')
              ? senderRow.phone_number
              : `+${senderRow.phone_number.replace(/\D/g, '')}`;
            await smsClient.sendSms(fromPhone, toPhone, text, mediaUrls);

            // Rastrear uso (não-bloqueante)
            const pricing = getSmsPricing(senderRow?.country_code ?? "US", "sms");
            const billingPeriod = new Date();
            const periodStr = `${billingPeriod.getFullYear()}-${String(billingPeriod.getMonth() + 1).padStart(2, "0")}-01`;
            await supabase.from("tenant_usage_log").insert({
              tenant_id:           msg.tenant_id,
              resource_type:       "sms_outbound",
              resource_id:         msg.id,
              quantity:            1,
              unit_cost_usd:       pricing.unitCostUsd,
              total_cost_usd:      pricing.unitCostUsd,
              billing_period:      periodStr,
              tenant_phone_number: senderRow.phone_number,
            }).catch(() => {});
            break;
          }

          default:
            throw new Error(`Unknown notification_channel: ${channel}`);
        }
        // ════════════════════════════════════════════════════════════════════

        // Sucesso — marca individualmente (seguro contra reenvio em crash)
        await supabase.from('outbound_message_queue')
          .update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', msg.id);

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

        let finalError   = e.message;
        let finalStatus  = 'pending';
        const newAttempts = (msg.attempts || 0) + 1;

        if (e instanceof MetaSocialError) {
          if (e.isWindowExpired) {
            finalStatus = 'failed';
            finalError  = `Meta ${e.channel}: 24h window expired. Patient must send a message first.`;
          } else if (e.isTokenInvalid) {
            finalStatus = 'failed';
            finalError  = `Meta ${e.channel}: Page token invalid. Reconnect in Settings → Integrações.`;
            await supabase.from('tenant_meta_pages')
              .update({ is_active: false })
              .eq('tenant_id', msg.tenant_id)
              .eq('is_active', true);
          }
        }

        if (finalStatus === 'pending' && newAttempts >= 3) finalStatus = 'failed';

        // Backoff: falha transitória (provedor fora do ar) não deve consumir as 3
        // tentativas em 3 minutos seguidos. Empurra scheduled_at para dar tempo do
        // provedor se recuperar, em vez de tentar de novo no próximo minuto.
        const backoffMinutes = newAttempts === 1 ? 5 : 15;
        const retryAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

        await supabase.from('outbound_message_queue').update({
          status:        finalStatus === 'pending' ? (newAttempts >= 3 ? 'failed' : 'pending') : finalStatus,
          attempts:      newAttempts,
          error_message: finalError,
          claimed_at:    null,
          ...(finalStatus === 'pending' ? { scheduled_at: retryAt } : {}),
        }).eq('id', msg.id);
      }
    });

    console.log(`[process-outbound] Completed. Processed: ${processed}/${queue.length}`);
    return new Response(JSON.stringify({ processed, claimed: queue.length }), { headers: corsHeaders });

  } catch (err: any) {
    console.error("[process-outbound] Fatal error:", err);
    await logPlatform(supabase, {
      level: "fatal",
      source: "process-outbound",
      eventName: "fatal_error",
      message: err.message,
      metadata: { stack: err.stack }
    });
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
