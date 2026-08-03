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
import { OutboxDispatcher, type CloudApiBillingCategory } from "../_shared/outboxDispatcher.ts";
import { getRenderedMessage, getSmsTemplate } from "../_shared/messageTemplates.ts";
import { MetaSocialClient, MetaSocialError } from "../_shared/metaSocialClient.ts";
import { TelnyxSmsClient } from "../_shared/telnyxSmsClient.ts";
import { getTelnyxApiKey } from "../_shared/masterConfig.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsPricing } from "../_shared/pricing.ts";
import { logPlatform } from "../_shared/logger.ts";
import { sendTenantEmail, isValidEmail } from "../_shared/emailClient.ts";
import { getEmailSubject, renderEmailHtml, buildIcsAttachment } from "../_shared/emailTemplates.ts";
import { isBlockedByQuietHours } from "../_shared/tenantTime.ts";
import { getDefaultChannel, filterChannelsByMatrix, type ChannelInfo } from "../_shared/channelResolver.ts";
import { SessionManager } from "../_shared/sessionManager.ts";

console.log("process-outbound v4.1 — Fair-claim + canal padrão do tenant Initialized");

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

// F2 (docs/ROADMAP_PRODUTO_2026.md) — subconjunto de RECOVERY_TEMPLATE_KEYS elegível
// à resposta determinística automática (REMARCAR/RESCHEDULE/REAGENDAR). recall_immediate
// fica de fora: reativação não está ligada a um médico/horário específico como o recovery.
const STRUCTURED_RECOVERY_KEYS = ['recovery_immediate', 'recovery_48h', 'recovery_7d'];

/**
 * Locale de mensagens transacionais precisa ser canônico porque ele também é
 * usado pelo F2 quando a resposta do paciente é curta ("confirmed", "ok").
 * Nunca deixar valores como "en-US" ou "English" vazarem para o contexto.
 */
function normalizeConversationLocale(value: unknown): 'pt' | 'en' | 'es' {
  const locale = String(value || '').toLowerCase();
  if (locale.startsWith('en')) return 'en';
  if (locale.startsWith('es')) return 'es';
  return 'pt';
}

// Cloud API tier Pro (docs/ROADMAP_PRODUTO_2026.md, item 4) — categoria de billing Meta
// por template_key. Envios sem template (réplica de conversa ao vivo) ficam de fora
// desta função e caem no default "service" (grátis) do OutboxDispatcher.
function classifyCloudApiCategory(templateKey: string | undefined | null): CloudApiBillingCategory {
  if (!templateKey) return 'service';
  if (RECOVERY_TEMPLATE_KEYS.includes(templateKey)) return 'marketing';
  if (templateKey.startsWith('appointment_reminder') || templateKey === 'booking_confirmed' || templateKey === 'nps_survey') return 'utility';
  return 'service';
}

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
      .select('id, name, zapi_instance_id, zapi_token, zapi_client_token, whatsapp_provider, cloud_api_phone_number_id, cloud_api_access_token, telnyx_api_key, sms_enabled, bot_config, timezone, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from')
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
        .from('appointments').select('id, status, confirmation_status, date, start_time')
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
    const sessionManager = new SessionManager(supabase);
    let processed = 0;

    // Resolve o e-mail do paciente: preferência explícita → cadastro do paciente
    const resolvePatientEmail = async (tenantId: string, patientPhone: string): Promise<string | null> => {
      const { data: pref } = await supabase
        .from('patient_channel_preferences')
        .select('email')
        .eq('tenant_id', tenantId)
        .eq('patient_phone', patientPhone)
        .maybeSingle();
      if (isValidEmail(pref?.email)) return pref!.email;

      const clean = (patientPhone || '').replace(/\D/g, '');
      const { data: patients } = await supabase
        .from('patients')
        .select('email')
        .eq('tenant_id', tenantId)
        .or(`phone.eq.${clean},phone.eq.+${clean}`)
        .limit(1);
      const email = patients?.[0]?.email;
      return isValidEmail(email) ? email : null;
    };

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
      // booking_confirmed automático (sem override) é duplicata da confirmação
      // manual do agente e deve ser cancelado. Envios manuais explícitos
      // (is_edited + override_message, ex.: modal "Enviar Resumo" da Agenda)
      // são entregues normalmente pelo canal escolhido.
      const isManualAgentSend = !!(msg.is_edited && msg.template_vars?.override_message);
      if ((msg.message_type === 'booking_confirmed' || msg.template_key === 'booking_confirmed') && !isManualAgentSend) {
        await supabase.from('outbound_message_queue')
          .update({ status: 'cancelled', error_message: 'Duplicate of manual confirmation' }).eq('id', msg.id);
        return;
      }

      const appt = msg.reference_id ? apptMap[msg.reference_id] : null;

      // Lembrete de agendamento cancelado/reagendado não deve ser enviado
      if (msg.template_key?.startsWith('appointment_reminder')) {
        if (!appt || !['scheduled', 'confirmed'].includes(appt.status)) {
          await supabase.from('outbound_message_queue')
            .update({ status: 'cancelled', error_message: `Appointment ${appt ? 'status is \'' + appt.status + '\'' : 'not found'} — reminder skipped` }).eq('id', msg.id);
          return;
        }
      }

      // NPS só se o agendamento ainda está 'completed'
      if (msg.message_type === 'nps_survey' && appt && appt.status !== 'completed') {
        await supabase.from('outbound_message_queue')
          .update({ status: 'cancelled', error_message: `Appointment status is '${appt.status}', NPS cancelled` }).eq('id', msg.id);
        return;
      }

      const channelMatrix = tenant?.bot_config?.channel_automations ?? {};

      // Re-roteia uma mensagem com canal desabilitado na matriz para o primeiro
      // canal ainda elegível, priorizando o canal padrão do tenant
      // (bot_config.default_notification_channel) sobre a ordem fixa antiga
      // (WhatsApp → SMS → E-mail) — é o que torna o canal padrão efetivo
      // também para mensagens já enfileiradas com config desatualizada.
      //
      // E-6 (2026-08-02): reusa filterChannelsByMatrix (channelResolver.ts) em
      // vez de reimplementar a checagem da matriz aqui — é a mesma lição que
      // já custou caro neste projeto (E-2/E-3): duas cópias do mesmo conceito
      // divergem cedo ou tarde. Instagram/Facebook nunca aparecem nesta lista
      // de candidatos (não sustentam automação atrasada — restrição real da
      // janela de 24h da Meta), então esta função nunca precisa filtrá-los;
      // filterChannelsByMatrix cuida disso mesmo assim, de graça.
      const defaultChannel = getDefaultChannel(tenant?.bot_config);
      const pickFallbackChannel = async (
        automationKey: 'nps' | 'recovery',
      ): Promise<{ channel: string; recipientId: string } | null> => {
        const resolvedEmail = await resolvePatientEmail(msg.tenant_id, msg.patient_phone);
        const candidateOrder = [defaultChannel, 'whatsapp', 'sms', 'email'].filter((c, i, arr) => arr.indexOf(c) === i);
        const candidates: ChannelInfo[] = candidateOrder
          .map((ch) => ({ channel: ch as ChannelInfo["channel"], recipientId: ch === 'email' ? (resolvedEmail || '') : msg.patient_phone }))
          .filter((c) => c.channel !== 'email' || !!c.recipientId); // sem e-mail válido, nem tenta

        // filterChannelsByMatrix já trata a retrocompatibilidade de Recuperação
        // (config antiga sem 'recovery' em channel_automations.whatsapp = ligado
        // por padrão) — mesma regra histórica, agora numa fonte só.
        const eligible = filterChannelsByMatrix(candidates, channelMatrix, automationKey);
        return eligible[0] ? { channel: eligible[0].channel, recipientId: eligible[0].recipientId } : null;
      };

      // ── Guard da Matriz de Canais: NPS ────────────────────────────────────
      // Cobre mensagens enfileiradas por trigger/engine com canal desatualizado:
      // se o canal escolhido está desabilitado para NPS na matriz, re-roteia
      // priorizando o canal padrão do tenant; sem canal elegível, cancela
      // (nunca envia por um canal que o tenant desligou).
      if (msg.message_type === 'nps_survey' || msg.template_key === 'nps_survey') {
        const ch = msg.notification_channel ?? defaultChannel;
        const row = channelMatrix[ch];
        // E-6 (2026-08-02): Instagram/Facebook NUNCA sustentam automação
        // atrasada (janela de 24h da Meta) — bloqueados sempre, mesmo que
        // `row` seja undefined (eles nunca aparecem na matriz por design; a
        // trigger SQL enqueue_nps_on_completion pode enfileirar com esse canal
        // espelhando a mesma regra antiga — esta é a rede de segurança).
        const blockedForAutomation = ch === 'instagram' || ch === 'facebook' || (row !== undefined && row?.nps !== true);
        if (blockedForAutomation) {
          const fallback = await pickFallbackChannel('nps');
          if (!fallback) {
            await supabase.from('outbound_message_queue')
              .update({ status: 'cancelled', error_message: `NPS disabled for channel '${ch}' in channel matrix` }).eq('id', msg.id);
            return;
          }
          msg.notification_channel = fallback.channel;
          msg.channel_recipient_id = fallback.recipientId;
        }
      }

      // ── Guard da Matriz de Canais: lembretes/no-show prevention ─────────
      // O scheduler enfileira uma linha por canal elegível; linhas antigas com
      // canal desabilitado na matriz são canceladas (sem re-roteio para evitar
      // duplicidade com a linha do canal correto).
      if (msg.template_key?.startsWith('appointment_reminder')) {
        const ch = msg.notification_channel ?? 'whatsapp';
        const row = channelMatrix[ch];
        // E-6 (2026-08-02): mesma rede de segurança do guard de NPS acima.
        const blockedForAutomation = ch === 'instagram' || ch === 'facebook' || (row !== undefined && row?.no_show !== true);
        if (blockedForAutomation) {
          await supabase.from('outbound_message_queue')
            .update({ status: 'cancelled', error_message: `Reminders disabled for channel '${ch}' in channel matrix` }).eq('id', msg.id);
          return;
        }
      }

      // ── Recuperação (CRM): canal definido na Matriz de Canais do tenant ──
      // A fila é populada pelo motor SQL sem notification_channel; o canal de
      // entrega é decidido aqui, priorizando o canal padrão do tenant.
      if (msg.reference_type === 'crm_journey' && RECOVERY_TEMPLATE_KEYS.includes(msg.template_key)) {
        const fallback = await pickFallbackChannel('recovery');
        if (!fallback) {
          await supabase.from('outbound_message_queue')
            .update({ status: 'cancelled', error_message: 'Recovery automation disabled in channel matrix' }).eq('id', msg.id);
          return;
        }
        msg.notification_channel = fallback.channel;
        msg.channel_recipient_id = fallback.recipientId;
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
            const billingCategory: CloudApiBillingCategory = classifyCloudApiCategory(msg.template_key);
            if (msg.media_url) {
              await outbox.sendMedia(tenant, recipient, {
                media_url:  msg.media_url,
                media_type: msg.media_type || 'video',
                caption:    text,
              }, undefined, billingCategory);
            } else {
              await outbox.sendNow(tenant, recipient, { text }, 0, undefined, billingCategory);
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
            try {
              await supabase.from("tenant_usage_log").insert({
                tenant_id:           msg.tenant_id,
                resource_type:       "sms_outbound",
                resource_id:         msg.id,
                quantity:            1,
                unit_cost_usd:       pricing.unitCostUsd,
                total_cost_usd:      pricing.unitCostUsd,
                billing_period:      periodStr,
                tenant_phone_number: senderRow.phone_number,
              });
            } catch {
              // Ignore tracking error
            }
            break;
          }

          case 'email': {
            const to = isValidEmail(recipient)
              ? recipient
              : await resolvePatientEmail(msg.tenant_id, msg.patient_phone);
            if (!to) throw new Error(`No e-mail address found for patient ${msg.patient_phone}`);

            const emailLocale = (msg.template_vars?.locale || tenant?.bot_config?.notification_locale || 'pt') as string;
            const subject = getEmailSubject(msg.template_key, msg.template_vars, emailLocale);

            const isReminder = !!msg.template_key?.startsWith('appointment_reminder');
            const ctaUrl = isReminder ? (msg.template_vars?.checkin_link || msg.template_vars?.waiting_room_link || null) : null;
            const ctaLang = emailLocale.startsWith('en') ? 'en' : emailLocale.startsWith('es') ? 'es' : 'pt';
            const ctaLabel = ctaUrl
              ? ({ pt: 'Confirmar presença', en: 'Confirm attendance', es: 'Confirmar asistencia' } as Record<string, string>)[ctaLang]
              : null;

            const html = renderEmailHtml({
              clinicName: tenant?.name || msg.template_vars?.clinic_name || 'Clínica',
              bodyText:   text,
              locale:     emailLocale,
              ctaUrl,
              ctaLabel,
            });

            // Convite de calendário (.ics) para lembretes de agendamento
            let attachments: { filename: string; content: string; contentType: string }[] | undefined;
            if (isReminder && appt?.date && appt?.start_time) {
              const ics = buildIcsAttachment({
                uid:         appt.id,
                date:        appt.date,
                startTime:   appt.start_time,
                timezone:    tenantTimezone,
                summary:     `${msg.template_vars?.procedure_name || 'Consulta'} — ${tenant?.name || ''}`.replace(/ — $/, ''),
                description: msg.template_vars?.doctor_name || undefined,
                location:    msg.template_vars?.location_name || undefined,
              });
              if (ics) attachments = [ics];
            }

            await sendTenantEmail(tenant, { to, subject, text, html, attachments });

            // Rastrear uso (não-bloqueante, custo zero — SMTP do próprio tenant)
            const emailPeriod = new Date();
            const emailPeriodStr = `${emailPeriod.getFullYear()}-${String(emailPeriod.getMonth() + 1).padStart(2, "0")}-01`;
            try {
              await supabase.from("tenant_usage_log").insert({
                tenant_id:      msg.tenant_id,
                resource_type:  "email_outbound",
                resource_id:    msg.id,
                quantity:       1,
                unit_cost_usd:  0,
                total_cost_usd: 0,
                billing_period: emailPeriodStr,
              });
            } catch {
              // Ignore tracking error
            }
            break;
          }

          default:
            throw new Error(`Unknown notification_channel: ${channel}`);
        }
        // ════════════════════════════════════════════════════════════════════

        // Sucesso — marca individualmente (seguro contra reenvio em crash)
        await supabase.from('outbound_message_queue')
          .update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', msg.id);

        // F2 — o paciente frequentemente responde apenas "confirmed" ao
        // lembrete. Sem registrar a mensagem e sua consulta de referência, a
        // resposta chega ao agente como texto solto e pode ser confundida com
        // a confirmação de um novo slot. O marker é apenas um atalho; o F2
        // também consulta a fila enviada caso o cleanup da sessão o remova.
        if (channel === 'whatsapp' && msg.reference_id && msg.template_key?.startsWith('appointment_reminder')) {
          try {
            const patientSession = await sessionManager.getOrCreateSession(msg.tenant_id, msg.patient_phone);
            const locale = normalizeConversationLocale(msg.template_vars?.locale || tenant?.bot_config?.notification_locale);
            const sentAt = new Date().toISOString();
            await sessionManager.logMessage(patientSession.id, 'assistant', text, {
              message_type: 'appointment_reminder',
            });
            await sessionManager.updateContext(patientSession.id, {
              pending_appointment_confirmation: {
                appointment_id: msg.reference_id,
                template_key: msg.template_key,
                locale,
                sent_at: sentAt,
              },
            });
          } catch (markerErr: any) {
            // O envio já foi concluído; falha de correlação não pode provocar
            // reenvio. O F2 ainda tenta recuperar a referência pela fila.
            console.warn(`[process-outbound] marker de confirmação do lembrete falhou (non-fatal): ${markerErr?.message}`);
          }
        }

        // Rastrear confirmação de 48h
        if (msg.message_type === 'reminder_48h' && msg.reference_id) {
          await supabase.from('appointments')
            .update({ confirmation_status: 'awaiting' })
            .eq('id', msg.reference_id)
            .is('confirmation_status', null);
        }

        // F2 — marca a correlação para o pré-filtro determinístico de process-inbox
        // reconhecer a resposta (REMARCAR/RESCHEDULE/REAGENDAR). Só WhatsApp: é o
        // único canal com pipeline de resposta automática (SMS/e-mail não têm).
        if (channel === 'whatsapp' && msg.reference_type === 'crm_journey' && STRUCTURED_RECOVERY_KEYS.includes(msg.template_key)) {
          try {
            const { data: journey } = await supabase.from('crm_journeys')
              .select('patient_id').eq('id', msg.reference_id).maybeSingle();
            if (journey?.patient_id) {
              const patientSession = await sessionManager.getOrCreateSession(msg.tenant_id, msg.patient_phone);
              await sessionManager.updateContext(patientSession.id, {
                pending_recovery: {
                  template_key: msg.template_key,
                  crm_journey_id: msg.reference_id,
                  patient_id: journey.patient_id,
                  locale: normalizeConversationLocale(msg.template_vars?.locale || tenant?.bot_config?.notification_locale),
                  sent_at: new Date().toISOString(),
                },
              });
            }
          } catch (markErr: any) {
            console.warn(`[process-outbound] F2 marker falhou (non-fatal): ${markErr?.message}`);
          }
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
