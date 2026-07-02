import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { MetaSocialClient } from "../_shared/metaSocialClient.ts";
import { TelnyxSmsClient } from "../_shared/telnyxSmsClient.ts";
import { getTelnyxApiKey } from "../_shared/masterConfig.ts";
import { getSmsPricing } from "../_shared/pricing.ts";

/**
 * Edge Function: send-human-media
 *
 * Chamada quando um atendente envia mídia (imagem, áudio, vídeo, documento).
 * O arquivo já deve estar no Supabase Storage (bucket: chat-media) antes desta chamada.
 *
 * Recebe: {
 *   session_id: string,
 *   tenant_id:  string,
 *   media_url:  string,   // URL pública do Supabase Storage
 *   media_type: 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'gif',
 *   mime_type?: string,
 *   caption?:   string,
 *   file_name?: string,
 *   file_size?: number,
 *   duration_s?: number,
 * }
 */

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl      = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase         = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const { session_id, tenant_id, media_url, media_type, mime_type, caption, file_name, file_size, duration_s, replied_to_id } = body;

    if (!session_id || !tenant_id || !media_url || !media_type) {
      return json({ error: 'session_id, tenant_id, media_url e media_type são obrigatórios' }, 400);
    }

    const VALID_TYPES = ['image', 'audio', 'video', 'document', 'sticker', 'gif'];
    if (!VALID_TYPES.includes(media_type)) {
      return json({ error: `media_type inválido: ${media_type}` }, 400);
    }

    // ── Autenticar atendente    // 0. DIAGNOSTIC LOGGING
    const headers = Object.fromEntries(req.headers.entries());
    console.log('[send-human-media] Incoming Body:', JSON.stringify(body));
    console.log('[send-human-media] Incoming Headers:', JSON.stringify(headers));

    // 1. Authenticate Attendant (Stronger Logging)
    const authHeader = req.headers.get('Authorization') ?? '';
    let user_id: string | null = null;
    
    if (authHeader && authHeader !== 'Bearer undefined') {
      const token = authHeader.replace('Bearer ', '');
      console.log('[send-human-media] Attempting JWT Auth with token (first 10 chars):', token.substring(0, 10));
      
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (user) {
        user_id = user.id;
        console.log('[send-human-media] JWT Auth SUCCESS. User ID:', user_id);
      } else {
        console.warn('[send-human-media] JWT Auth FAILED:', authError?.message);
      }
    } else {
      console.log('[send-human-media] No valid Authorization header found.');
    }

    // Fallback to body.user_id if JWT failed
    if (!user_id && body.user_id) {
      console.log('[send-human-media] Using fallback user_id from body:', body.user_id);
      user_id = body.user_id;
    }

    console.log('[send-human-media] Final resolved user_id:', user_id);

    if (!user_id) {
      console.error('[send-human-media] 401 Unauthorized: No valid user resolved.');
      return new Response(JSON.stringify({ 
        error: 'Não autenticado', 
        details: 'Invalid token or missing user_id',
        debug: { hasAuthHeader: !!authHeader, hasBodyUserId: !!body.user_id } 
      }), { status: 401, headers: corsHeaders });
    }

    // ── Buscar sessão e credenciais WhatsApp + Telnyx ─────────────────────────
    const { data: session, error: sessionError } = await supabase
      .from('conversation_sessions')
      .select(`
        id, patient_phone, tenant_id, omnichannel_status, assigned_to_user_id, channel, platform_user_id,
        tenants (
          whatsapp_provider, zapi_instance_id, zapi_token, zapi_client_token,
          cloud_api_phone_number_id, cloud_api_access_token,
          telnyx_api_key, sms_enabled
        )
      `)
      .eq('id', session_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (sessionError || !session) return json({ error: 'Sessão não encontrada' }, 404);

    const tenantDetails = (session as any).tenants;

    // ── Auto-handoff: atribuir atendente se necessário ───────────────────────
    if (session.omnichannel_status !== 'human_active' || session.assigned_to_user_id !== user_id) {
      await supabase.from('conversation_sessions').update({
        omnichannel_status: 'human_active',
        human_handoff: true,
        assigned_to_user_id: user_id,
        current_state: 'HUMAN_ACTIVE',
      }).eq('id', session_id);
    }

    // ── Inserir mensagem no histórico (com atualização de Rolling Memory) ────
    const { SessionManager } = await import("../_shared/sessionManager.ts");
    const sessionManager = new SessionManager(supabase);
    
    let dbMsgId: string | undefined;
    try {
      dbMsgId = await sessionManager.logMessage(session_id, 'human', caption || `[${media_type}]`, {
        media_url,
        message_type: media_type,
        file_name,
        mime_type,
        file_size,
        caption,
        duration_s,
        replied_to_id: replied_to_id || null
      });
    } catch (insertError) {
      console.error('[send-human-media] Log error:', insertError);
      throw insertError;
    }

    // ── Resolver o whatsapp_message_id da mensagem sendo respondida ──────────
    let quotedMsgId: string | undefined;
    if (replied_to_id) {
      const { data: repliedMsg } = await supabase
        .from('conversation_messages')
        .select('whatsapp_message_id')
        .eq('id', replied_to_id)
        .maybeSingle();
      quotedMsgId = repliedMsg?.whatsapp_message_id ?? undefined;
    }

    // ── Enviar via WhatsApp, Meta (Instagram/Facebook), Telnyx SMS/MMS ou Broadcast para Live Chat ──
    const isLiveChat = session.channel === 'livechat';
    const isInstagram = session.channel === 'instagram';
    const isFacebook = session.channel === 'facebook';
    const isSms = session.channel === 'sms';

    if (isLiveChat) {
      const realtimeChannel = supabase.channel(`livechat:${session_id}`);
      await realtimeChannel.send({
        type: 'broadcast',
        event: 'message',
        payload: {
          id: dbMsgId,
          role: 'human',
          content: caption || `[${media_type}]`,
          media_url,
          message_type: media_type,
          file_name,
          mime_type,
          created_at: new Date().toISOString()
        }
      });
      console.log(`[send-human-media] Broadcast sent to livechat:${session_id}`);
    } else if (isInstagram || isFacebook) {
      // Enviar via Meta Graph API usando platform_user_id (PSID ou IGSID)
      const recipientId = (session as any).platform_user_id ?? session.patient_phone;

      const pageQuery = isInstagram
        ? supabase.from('tenant_meta_pages').select('page_access_token, instagram_account_id').eq('tenant_id', tenant_id).not('instagram_account_id', 'is', null).eq('is_active', true).limit(1).maybeSingle()
        : supabase.from('tenant_meta_pages').select('page_access_token').eq('tenant_id', tenant_id).eq('is_active', true).limit(1).maybeSingle();

      const { data: metaPage } = await pageQuery;

      if (!metaPage?.page_access_token) {
        console.error(`[send-human-media] No Meta page token for tenant ${tenant_id}. Message saved but not delivered.`);
        return json({ error: `Página do ${session.channel} não conectada ou token ausente.` });
      }

      try {
        const result = isInstagram
          ? await MetaSocialClient.sendInstagramAttachment(metaPage.page_access_token, recipientId, media_url, media_type)
          : await MetaSocialClient.sendFacebookAttachment(metaPage.page_access_token, recipientId, media_url, media_type);

        console.log(`[send-human-media] ${session.channel} attachment sent to ${recipientId}`);

        if (dbMsgId && result.messageId) {
          await supabase.from('conversation_messages').update({ whatsapp_message_id: result.messageId }).eq('id', dbMsgId);
        }

        // A API da Meta não suporta anexo + texto na mesma mensagem (sem campo "caption" nativo).
        // Enviamos a legenda como uma segunda mensagem de texto imediatamente após o anexo.
        if (caption?.trim()) {
          try {
            isInstagram
              ? await MetaSocialClient.sendInstagramMessage(metaPage.page_access_token, (metaPage as any).instagram_account_id, recipientId, caption.trim())
              : await MetaSocialClient.sendFacebookMessage(metaPage.page_access_token, recipientId, caption.trim());
            console.log(`[send-human-media] ${session.channel} caption sent to ${recipientId}`);
          } catch (captionErr: any) {
            console.error(`[send-human-media] Caption dispatch failed: ${captionErr.message}`);
            return json({ error: `Anexo enviado, mas a legenda falhou via ${session.channel}: ${captionErr.message}` });
          }
        }
      } catch (metaErr: any) {
        console.error(`[send-human-media] Meta dispatch failed: ${metaErr.message}`);
        return json({ error: `Falha ao enviar anexo via ${session.channel}: ${metaErr.message}` });
      }
    } else if (isSms) {
      // Prioridade: tenant key → Supabase Secret → master_config (UI)
      const smsApiKey = await getTelnyxApiKey(supabase, tenantDetails?.telnyx_api_key);
      if (!smsApiKey || !tenantDetails?.sms_enabled) {
        throw new Error(`SMS/MMS (Telnyx) não está configurado ou habilitado para este tenant.`);
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
        throw new Error(`Nenhum número de envio de SMS/MMS ativo encontrado para este tenant.`);
      }

      const smsClient = new TelnyxSmsClient(smsApiKey);
      const mediaUrls = media_url ? [media_url] : undefined;
      const smsText = caption?.trim() || "";
      const toPhone = session.patient_phone.startsWith('+')
        ? session.patient_phone
        : `+${session.patient_phone.replace(/\D/g, '')}`;
      const fromPhone = senderRow.phone_number.startsWith('+')
        ? senderRow.phone_number
        : `+${senderRow.phone_number.replace(/\D/g, '')}`;
      const telnyxRes = await smsClient.sendSms(fromPhone, toPhone, smsText, mediaUrls);
      console.log(`[send-human-media] MMS sent to ${session.patient_phone}. Msg ID: ${telnyxRes.messageId}`);

      if (dbMsgId && telnyxRes.messageId) {
        await supabase
          .from('conversation_messages')
          .update({ whatsapp_message_id: telnyxRes.messageId })
          .eq('id', dbMsgId);
      }

      // Rastrear uso: SMS/MMS outbound
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
        console.error(`[send-human-media] Falha ao logar uso de SMS/MMS:`, logErr.message);
      }
    } else {
      const outbox = new OutboxDispatcher(supabase);
      try {
        const waMsgId = await outbox.sendMedia(tenantDetails, session.patient_phone, {
          media_url,
          media_type,
          mime_type,
          caption,
          file_name,
        }, quotedMsgId);

        if (dbMsgId && waMsgId) {
          await supabase.from('conversation_messages').update({ whatsapp_message_id: waMsgId }).eq('id', dbMsgId);
        }
      } catch (dispatchErr: any) {
        console.error('[send-human-media] Dispatch failed:', dispatchErr.message);
        // Não retorna erro ao cliente — a mensagem foi salva no histórico e pode ser re-enviada se necessário por outros meios
      }
    }

    return json({ success: true });

  } catch (err: any) {
    console.error('[send-human-media] Fatal:', err);
    return json({ error: err.message ?? 'Erro interno' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
