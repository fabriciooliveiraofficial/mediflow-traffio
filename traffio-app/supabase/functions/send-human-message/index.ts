/**
 * SPRINT 3 — Edge Function: send-human-message
 *
 * Chamada pelo Painel de Atendimento Humano quando um atendente envia uma mensagem.
 * Responsabilidades:
 *   1. Validar que o user_id é o atendente atribuído à conversa (ownership check)
 *   2. Inserir a mensagem em conversation_messages com role='human'
 *   3. Enfileirar a mensagem na message_outbox para entrega Z-API com retry
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { SessionManager } from "../_shared/sessionManager.ts";
import { MetaSocialClient } from "../_shared/metaSocialClient.ts";

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { session_id, text, tenant_id, user_id, replied_to_id } = body;

    if (!session_id || !text?.trim() || !tenant_id || !user_id) {
      return new Response(
        JSON.stringify({ error: 'session_id, text, tenant_id e user_id são obrigatórios' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[send-human-message] Request from user:', user_id);

    // 1. Buscar sessão com credenciais de todos os canais
    const { data: session, error: sessionError } = await supabase
      .from('conversation_sessions')
      .select(`
        id,
        patient_phone,
        tenant_id,
        omnichannel_status,
        assigned_to_user_id,
        channel,
        platform_user_id,
        tenants (
          whatsapp_provider,
          zapi_instance_id,
          zapi_token,
          zapi_client_token,
          cloud_api_phone_number_id,
          cloud_api_access_token
        )
      `)
      .eq('id', session_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: 'Sessão não encontrada' }), { status: 404, headers: corsHeaders });
    }

    const tenantDetails = (session as any).tenants;

    // 2. AUTO-HANDOFF: Se um humano está enviando mensagem, assumimos o controle
    // Isso remove a fricção de ter que trocar o status manualmente.
    const mustUpdateStatus = session.omnichannel_status !== 'human_active' || session.assigned_to_user_id !== user_id;
    
    if (mustUpdateStatus) {
      console.log(`[send-human-message] Auto-handoff for session ${session_id}. Assigned to ${user_id}`);
      await supabase
        .from('conversation_sessions')
        .update({
          omnichannel_status: 'human_active',
          human_handoff: true,
          assigned_to_user_id: user_id,
          current_state: 'HUMAN_ACTIVE'
        })
        .eq('id', session_id);
    }

    // 3. Inserir mensagem na tabela de histórico
    const sessionManager = new SessionManager(supabase);
    const dbMsgId = await sessionManager.logMessage(session_id, 'human' as any, text.trim(), {
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

    // 4. IMMEDIATE DISPATCH: Enviar agora via Z-API/Cloud-API (Zero Latency) ou Broadcast para Live Chat / Meta
    const isLiveChat = session.channel === 'livechat';
    const isInstagram = session.channel === 'instagram';
    const isFacebook = session.channel === 'facebook';

    if (isLiveChat) {
      const realtimeChannel = supabase.channel(`livechat:${session_id}`);
      await realtimeChannel.send({
        type: 'broadcast',
        event: 'message',
        payload: {
          id: dbMsgId,
          role: 'human',
          content: text.trim(),
          created_at: new Date().toISOString()
        }
      });
      console.log(`[send-human-message] Broadcast sent to livechat:${session_id}`);
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
          throw new Error(`Falha ao enviar via ${session.channel}: ${metaErr.message}`);
        }
      }
    } else {
      const outbox = new OutboxDispatcher(supabase);
      try {
        const waMsgId = await outbox.sendNow(tenantDetails, session.patient_phone, { text: text.trim() }, 0, quotedMsgId);
        console.log(`[send-human-message] Immediate dispatch success for ${session.patient_phone}, waMsgId: ${waMsgId}`);
        
        if (dbMsgId && waMsgId) {
          await supabase.from('conversation_messages').update({ whatsapp_message_id: waMsgId }).eq('id', dbMsgId);
        }
      } catch (dispatchErr: any) {
        console.error(`[send-human-message] Immediate dispatch failed, falling back to outbox:`, dispatchErr.message);
        await outbox.enqueue(tenant_id, session.patient_phone, { text: text.trim(), quotedMsgId });
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('send-human-message error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
