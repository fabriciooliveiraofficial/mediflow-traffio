/**
 * SPRINT 3 — Edge Function: send-human-message
 *
 * Chamada pelo Painel de Atendimento Humano quando um atendente envia uma mensagem.
 * Responsabilidades:
 *   1. Validar que o user_id é o atendente atribuído à conversa (ownership check)
 *   2. Inserir a mensagem em conversation_messages com role='human'
 *   3. Enfileirar a mensagem na message_outbox para entrega Z-API com retry
 *
 * Envio cross-channel (confirmação de agendamento e afins):
 *   - `target_channel` opcional ('whatsapp' | 'sms' | 'instagram' | 'facebook' | 'email'):
 *     despacha por um canal diferente do da sessão de origem, resolvendo (ou criando,
 *     quando telefone-based) a sessão do canal-alvo para registrar a mensagem.
 *   - Alternativamente aceita `patient_phone` + `target_channel` sem `session_id`
 *     (ex.: novo SMS iniciado pela Central de Comunicações).
 *   - 'email' envia via SMTP do tenant (fallback global) e registra nota interna.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { SessionManager } from "../_shared/sessionManager.ts";
import { MetaSocialClient } from "../_shared/metaSocialClient.ts";
import { TelnyxSmsClient } from "../_shared/telnyxSmsClient.ts";
import { getTelnyxApiKey } from "../_shared/masterConfig.ts";
import { getSmsPricing } from "../_shared/pricing.ts";

const SESSION_SELECT = `
  id,
  patient_phone,
  patient_id,
  tenant_id,
  omnichannel_status,
  assigned_to_user_id,
  channel,
  platform_user_id,
  tenants (
    name,
    whatsapp_provider,
    zapi_instance_id,
    zapi_token,
    zapi_client_token,
    cloud_api_phone_number_id,
    cloud_api_access_token,
    telnyx_api_key,
    sms_enabled,
    smtp_host,
    smtp_port,
    smtp_user,
    smtp_pass,
    smtp_from
  )
`;

const normalizeChannel = (c: string | null | undefined) => c || 'whatsapp';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { session_id, text, media_url, media_type, tenant_id, user_id, replied_to_id, target_channel, patient_phone } = body;

    const hasPhoneEntry = !!(patient_phone && target_channel);
    if ((!session_id && !hasPhoneEntry) || !text?.trim() || !tenant_id || !user_id) {
      return new Response(
        JSON.stringify({ error: 'session_id (ou patient_phone + target_channel), text, tenant_id e user_id são obrigatórios' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[send-human-message] Request from user:', user_id, target_channel ? `(target: ${target_channel})` : '');

    // 1. Resolver a sessão de origem (quando informada)
    let session: any = null;
    if (session_id) {
      const { data, error: sessionError } = await supabase
        .from('conversation_sessions')
        .select(SESSION_SELECT)
        .eq('id', session_id)
        .eq('tenant_id', tenant_id)
        .single();

      if (sessionError || !data) {
        return new Response(JSON.stringify({ error: 'Sessão não encontrada' }), { status: 404, headers: corsHeaders });
      }
      session = data;
    }

    // 1b. E-MAIL: envia via SMTP e registra nota interna na conversa de origem
    if (target_channel === 'email') {
      if (!session) {
        return new Response(JSON.stringify({ error: 'session_id é obrigatório para envio por e-mail' }), { status: 400, headers: corsHeaders });
      }

      // Resolver o e-mail do destinatário: paciente vinculado → paciente pelo
      // telefone da sessão → preferência de canal. (A UI localiza o paciente por
      // telefone mesmo sem vínculo formal na sessão — o envio deve acompanhar.)
      let email: string | null = null;
      if (session.patient_id) {
        const { data: patientRow } = await supabase
          .from('patients')
          .select('email')
          .eq('id', session.patient_id)
          .maybeSingle();
        email = patientRow?.email?.trim() || null;
      }
      if (!email) {
        const cleanPhone = (session.patient_phone || '').replace(/\D/g, '');
        if (cleanPhone) {
          const { data: byPhone } = await supabase
            .from('patients')
            .select('email')
            .eq('tenant_id', tenant_id)
            .or(`phone.eq.${cleanPhone},phone.eq.+${cleanPhone}`)
            .limit(1);
          email = byPhone?.[0]?.email?.trim() || null;
        }
      }
      if (!email) {
        const { data: pref } = await supabase
          .from('patient_channel_preferences')
          .select('email')
          .eq('tenant_id', tenant_id)
          .eq('patient_phone', session.patient_phone)
          .maybeSingle();
        email = pref?.email?.trim() || null;
      }

      if (!email) {
        throw new Error('Paciente não possui e-mail cadastrado.');
      }

      await sendConfirmationEmail((session as any).tenants, email, text.trim());

      // Comprovante visível apenas internamente na conversa de origem
      await supabase.from('conversation_messages').insert({
        session_id: session.id,
        role: 'internal',
        content: `📧 E-mail enviado para ${email}:\n\n${text.trim()}`,
      });

      console.log(`[send-human-message] Email sent to ${email} (session ${session.id})`);
      return new Response(JSON.stringify({ success: true, delivered_via: 'email' }), { headers: corsHeaders });
    }

    // 1c. Cross-channel: resolver/criar a sessão do canal-alvo
    const dispatchChannel = target_channel ? normalizeChannel(target_channel) : normalizeChannel(session?.channel);
    if (!session || (target_channel && normalizeChannel(session.channel) !== dispatchChannel)) {
      session = await resolveTargetSession(supabase, {
        tenantId: tenant_id,
        targetChannel: dispatchChannel,
        sourceSession: session,
        rawPhone: patient_phone,
        userId: user_id,
      });
    }

    const tenantDetails = (session as any).tenants;

    // 2. AUTO-HANDOFF: Se um humano está enviando mensagem, assumimos o controle
    // Isso remove a fricção de ter que trocar o status manualmente.
    const mustUpdateStatus = session.omnichannel_status !== 'human_active' || session.assigned_to_user_id !== user_id;

    if (mustUpdateStatus) {
      console.log(`[send-human-message] Auto-handoff for session ${session.id}. Assigned to ${user_id}`);
      await supabase
        .from('conversation_sessions')
        .update({
          omnichannel_status: 'human_active',
          human_handoff: true,
          handoff_reason: null,
          handoff_kind: null,
          assigned_to_user_id: user_id,
          current_state: 'HUMAN_ACTIVE'
        })
        .eq('id', session.id);
    }

    // 3. Inserir mensagem na tabela de histórico
    const sessionManager = new SessionManager(supabase);
    const dbMsgId = await sessionManager.logMessage(session.id, 'human' as any, text.trim(), {
      replied_to_id,
    });

    // 3b. Resolver o whatsapp_message_id da mensagem sendo respondida
    let quotedMsgId: string | undefined;
    if (replied_to_id) {
      const { data: repliedMsg } = await supabase
        .from('conversation_messages')
        .select('whatsapp_message_id')
        .eq('id', replied_to_id)
        .maybeSingle();
      quotedMsgId = repliedMsg?.whatsapp_message_id ?? undefined;
      console.log(`[send-human-message] Reply to internal id=${replied_to_id}, wa_id=${quotedMsgId ?? 'not found'}`);
    }

    // 4. IMMEDIATE DISPATCH: Enviar agora via Z-API/Cloud-API (Zero Latency) ou Broadcast para Live Chat / Meta / Telnyx SMS
    const isLiveChat = dispatchChannel === 'livechat';
    const isInstagram = dispatchChannel === 'instagram';
    const isFacebook = dispatchChannel === 'facebook';
    const isSms = dispatchChannel === 'sms';

    if (isLiveChat) {
      // Nome do atendente para o widget exibir com quem o visitante está falando
      const { data: agentProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user_id)
        .maybeSingle();
      const senderName = agentProfile?.full_name ?? null;

      const realtimeChannel = supabase.channel(`livechat:${session.id}`);
      await realtimeChannel.send({
        type: 'broadcast',
        event: 'message',
        payload: {
          id: dbMsgId,
          role: 'human',
          content: text.trim(),
          sender_name: senderName,
          created_at: new Date().toISOString()
        }
      });
      console.log(`[send-human-message] Broadcast sent to livechat:${session.id}`);
    } else if (isInstagram || isFacebook) {
      // Enviar via Meta Graph API usando platform_user_id (PSID ou IGSID)
      const recipientId = session.platform_user_id ?? session.patient_phone;

      // Buscar Page Access Token do tenant
      const pageQuery = isInstagram
        ? supabase.from('tenant_meta_pages').select('page_access_token, instagram_account_id').eq('tenant_id', tenant_id).not('instagram_account_id', 'is', null).eq('is_active', true).limit(1).maybeSingle()
        : supabase.from('tenant_meta_pages').select('page_access_token').eq('tenant_id', tenant_id).eq('is_active', true).limit(1).maybeSingle();

      const { data: metaPage } = await pageQuery;

      if (!metaPage?.page_access_token) {
        console.error(`[send-human-message] No Meta page token for tenant ${tenant_id}. Message saved but not delivered.`);
      } else {
        try {
          if (isInstagram) {
            await MetaSocialClient.sendInstagramMessage(
              metaPage.page_access_token,
              metaPage.instagram_account_id,
              recipientId,
              text.trim()
            );
            console.log(`[send-human-message] Instagram DM sent to ${recipientId}`);
          } else {
            await MetaSocialClient.sendFacebookMessage(
              metaPage.page_access_token,
              recipientId,
              text.trim()
            );
            console.log(`[send-human-message] Facebook Messenger sent to ${recipientId}`);
          }
        } catch (metaErr: any) {
          console.error(`[send-human-message] Meta dispatch failed: ${metaErr.message}`);
          // Não falhar silenciosamente — informar o atendente
          throw new Error(`Falha ao enviar via ${dispatchChannel}: ${metaErr.message}`);
        }
      }
    } else if (isSms) {
      // Prioridade: tenant key → Supabase Secret → master_config (UI)
      const smsApiKey = await getTelnyxApiKey(supabase, tenantDetails?.telnyx_api_key);
      if (!smsApiKey || !tenantDetails?.sms_enabled) {
        throw new Error(`SMS (Telnyx) não está configurado ou habilitado para este tenant.`);
      }

      // Buscar número remetente: primeiro número ativo do tenant que tenha capacidade SMS
      const { data: senderRow } = await supabase
        .from('tenant_phone_numbers')
        .select('phone_number, country_code')
        .eq('tenant_id', tenant_id)
        .eq('is_active', true)
        .contains('capabilities', { sms: true })
        .limit(1)
        .maybeSingle();

      if (!senderRow) {
        throw new Error(`Nenhum número de envio de SMS ativo encontrado para este tenant.`);
      }

      // Telnyx exige E.164 (tanto para o remetente quanto para o destinatário)
      const toPhone = session.patient_phone.startsWith('+')
        ? session.patient_phone
        : `+${session.patient_phone.replace(/\D/g, '')}`;
      const fromPhone = senderRow.phone_number.startsWith('+')
        ? senderRow.phone_number
        : `+${senderRow.phone_number.replace(/\D/g, '')}`;

      const smsClient = new TelnyxSmsClient(smsApiKey);
      const telnyxRes = await smsClient.sendSms(fromPhone, toPhone, text.trim());
      console.log(`[send-human-message] SMS sent to ${toPhone}. Msg ID: ${telnyxRes.messageId}`);

      if (dbMsgId && telnyxRes.messageId) {
        await supabase
          .from('conversation_messages')
          .update({ whatsapp_message_id: telnyxRes.messageId })
          .eq('id', dbMsgId);
      }

      // Rastrear uso: SMS outbound
      try {
        const pricing = getSmsPricing(senderRow?.country_code ?? "US", "sms");
        const billingPeriod = new Date();
        const periodStr = `${billingPeriod.getFullYear()}-${String(billingPeriod.getMonth() + 1).padStart(2, "0")}-01`;
        await supabase.from("tenant_usage_log").insert({
          tenant_id:           tenant_id,
          resource_type:       "sms_outbound",
          resource_id:         dbMsgId,
          quantity:            1,
          unit_cost_usd:       pricing.unitCostUsd,
          total_cost_usd:      pricing.unitCostUsd,
          billing_period:      periodStr,
          tenant_phone_number: senderRow.phone_number,
        });
      } catch (logErr: any) {
        console.error(`[send-human-message] Falha ao logar uso de SMS:`, logErr.message);
      }
    } else {
      const outbox = new OutboxDispatcher(supabase);
      // Sessões SMS guardam E.164 com '+'; WhatsApp usa apenas dígitos (no-op no fluxo normal)
      const waPhone = session.patient_phone.replace(/^\+/, '');
      try {
        const payloadObj: any = { text: text.trim() };
        if (media_url) {
          payloadObj.media_url = media_url;
          payloadObj.media_type = media_type || 'image';
          payloadObj.caption = text.trim();
        }
        const waMsgId = await outbox.sendNow(tenantDetails, waPhone, payloadObj, 0, quotedMsgId);
        console.log(`[send-human-message] Immediate dispatch success for ${waPhone}, waMsgId: ${waMsgId}`);

        if (dbMsgId && waMsgId) {
          await supabase.from('conversation_messages').update({ whatsapp_message_id: waMsgId }).eq('id', dbMsgId);
        }
      } catch (dispatchErr: any) {
        console.error(`[send-human-message] Immediate dispatch failed, falling back to outbox:`, dispatchErr.message);
        const payloadObj: any = { text: text.trim(), quotedMsgId };
        if (media_url) {
          payloadObj.media_url = media_url;
          payloadObj.media_type = media_type || 'image';
          payloadObj.caption = text.trim();
        }
        await outbox.enqueue(tenant_id, waPhone, payloadObj);
      }
    }

    return new Response(JSON.stringify({ success: true, session_id: session.id, delivered_via: dispatchChannel }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('send-human-message error:', error);
    // Retornamos 200 com { error } para que o supabase-js não esconda a mensagem de erro original
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: corsHeaders });
  }
});

/**
 * Resolve a sessão do canal-alvo para um envio cross-channel.
 * Canais Meta exigem sessão existente (precisamos do PSID/IGSID);
 * WhatsApp/SMS são telefone-based e a sessão é criada quando não existe.
 */
async function resolveTargetSession(
  supabase: any,
  opts: {
    tenantId: string;
    targetChannel: string;
    sourceSession: any | null;
    rawPhone?: string;
    userId: string;
  }
): Promise<any> {
  const { tenantId, targetChannel, sourceSession, rawPhone, userId } = opts;

  // Identidade do paciente: patient_id e/ou telefone real
  // (sessões Instagram/Facebook guardam PSID/IGSID em patient_phone — não é telefone)
  const patientId = sourceSession?.patient_id ?? null;
  let phone: string | null = null;

  const sourceIsMeta = ['instagram', 'facebook', 'livechat'].includes(sourceSession?.channel || '');
  if (rawPhone) {
    phone = rawPhone;
  } else if (sourceSession && !sourceIsMeta && sourceSession.patient_phone && !/[a-zA-Z]/.test(sourceSession.patient_phone)) {
    phone = sourceSession.patient_phone;
  }
  if (!phone && patientId) {
    const { data: p } = await supabase
      .from('patients')
      .select('phone, mobile')
      .eq('id', patientId)
      .maybeSingle();
    phone = p?.phone || p?.mobile || null;
  }
  const cleanPhone = phone ? phone.replace(/\D/g, '') : '';

  // Buscar sessão existente no canal-alvo
  const orParts: string[] = [];
  if (patientId) orParts.push(`patient_id.eq.${patientId}`);
  if (cleanPhone) orParts.push(`patient_phone.eq.${cleanPhone}`, `patient_phone.eq."+${cleanPhone}"`);

  if (orParts.length > 0) {
    let query = supabase
      .from('conversation_sessions')
      .select(SESSION_SELECT)
      .eq('tenant_id', tenantId)
      .or(orParts.join(','));

    query = targetChannel === 'whatsapp'
      ? query.or('channel.eq.whatsapp,channel.is.null')
      : query.eq('channel', targetChannel);

    const { data: existing } = await query
      .order('updated_at', { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) return existing[0];
  }

  if (targetChannel === 'instagram' || targetChannel === 'facebook') {
    const label = targetChannel === 'instagram' ? 'Instagram Direct' : 'Facebook Messenger';
    throw new Error(`O paciente não possui conversa no ${label}. Só é possível enviar por esse canal quando já existe uma conversa iniciada pelo paciente.`);
  }

  if (!cleanPhone) {
    throw new Error('Paciente sem telefone cadastrado — não é possível enviar por este canal.');
  }

  // Criar sessão nova (telefone-based): SMS em E.164 com '+', WhatsApp só dígitos
  const newPhone = targetChannel === 'sms' ? `+${cleanPhone}` : cleanPhone;
  const insertPayload: any = {
    tenant_id: tenantId,
    patient_phone: newPhone,
    channel: targetChannel,
    current_state: 'HUMAN_ACTIVE',
    omnichannel_status: 'human_active',
    human_handoff: true,
    assigned_to_user_id: userId,
    context: {},
  };
  if (patientId) insertPayload.patient_id = patientId;

  const { data: created, error: insertError } = await supabase
    .from('conversation_sessions')
    .insert(insertPayload)
    .select(SESSION_SELECT)
    .single();

  if (created) return created;

  // Conflito com unique (tenant_id, patient_phone): outra sessão já usa esse número
  // (ex.: sessão WhatsApp com o mesmo formato). Reutilizamos para registrar o histórico;
  // o despacho continua seguindo o canal-alvo.
  console.warn(`[send-human-message] Session insert conflict (${insertError?.message}); reusing existing row for ${newPhone}`);
  const { data: fallback, error: fetchError } = await supabase
    .from('conversation_sessions')
    .select(SESSION_SELECT)
    .eq('tenant_id', tenantId)
    .eq('patient_phone', newPhone)
    .single();

  if (fetchError || !fallback) {
    throw new Error(`Não foi possível resolver a conversa do canal ${targetChannel}: ${insertError?.message}`);
  }
  return fallback;
}

/**
 * Envia o e-mail de confirmação usando o SMTP próprio do tenant,
 * com fallback para o SMTP global do sistema (secrets SMTP_*).
 */
async function sendConfirmationEmail(tenantDetails: any, to: string, message: string): Promise<void> {
  let hostname = tenantDetails?.smtp_host;
  let port = tenantDetails?.smtp_port ? Number(tenantDetails.smtp_port) : 465;
  let username = tenantDetails?.smtp_user;
  let password = tenantDetails?.smtp_pass;
  let from = tenantDetails?.smtp_from || username;
  const clinicName = tenantDetails?.name || 'Traffio';

  const hasTenantSMTP = hostname && username && password;
  if (!hasTenantSMTP) {
    hostname = Deno.env.get('SMTP_HOST') ?? '';
    port = Number(Deno.env.get('SMTP_PORT') ?? '465');
    username = Deno.env.get('SMTP_USER') ?? '';
    password = Deno.env.get('SMTP_PASS') ?? '';
    from = Deno.env.get('SMTP_FROM') ?? username;
  }

  if (!hostname || !username || !password) {
    throw new Error('SMTP não configurado para este tenant (e sem SMTP global disponível).');
  }

  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0E7C7B;">${clinicName}</h2>
      <p style="white-space: pre-wrap; line-height: 1.6;">${escaped}</p>
      <p style="font-size: 12px; color: #718096; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
        Este é um e-mail automático enviado em nome de ${clinicName}.
      </p>
    </div>
  `;

  const client = new SMTPClient({
    connection: {
      hostname,
      port,
      tls: port === 465,
      auth: { username, password },
    },
  });

  try {
    await client.send({
      from: `${clinicName} <${from}>`,
      to,
      subject: `Confirmação de Agendamento - ${clinicName}`,
      content: message,
      html,
    });
  } finally {
    await client.close();
  }
}
