import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

// Helper to keep task alive for fire-and-forget
function runInBackground(task: Promise<unknown>) {
  try {
    // @ts-ignore
    EdgeRuntime.waitUntil(task);
  } catch {
    /* fire-and-forget */
  }
}

function triggerInboxProcessing() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;

  const task = (async () => {
    // 1.5s delay to allow transaction commit and debounce
    await new Promise((r) => setTimeout(r, 1500));
    await fetch(`${url}/functions/v1/process-inbox`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch((e) => console.warn("[livechat-visitor-message] push trigger failed:", e?.message));
  })();

  runInBackground(task);
}

serve(async (req: Request) => {
  // Tratar requisição OPTIONS para CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let session_id: string | null = null;
    let tenant_id: string | null = null;
    let visitor_name: string | null = null;
    let visitor_email: string | null = null;
    let visitor_phone: string | null = null;
    let content = "";
    let fileObj: File | null = null;
    let action: string | null = null;

    // 1. Processar dados da requisição com base no tipo de conteúdo (FormData ou JSON)
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      session_id = formData.get("session_id") as string;
      tenant_id = formData.get("tenant_id") as string;
      visitor_name = formData.get("visitor_name") as string;
      visitor_email = formData.get("visitor_email") as string;
      visitor_phone = formData.get("visitor_phone") as string;
      content = (formData.get("content") as string) || "";
      fileObj = formData.get("file") as File;
      action = formData.get("action") as string;
    } else {
      const body = await req.json();
      session_id = body.session_id;
      tenant_id = body.tenant_id;
      visitor_name = body.visitor_name;
      visitor_email = body.visitor_email;
      visitor_phone = body.visitor_phone;
      content = body.content || "";
      action = body.action;
    }

    // Configuração do widget + localização do tenant (fonte de verdade de idioma/timezone)
    if (action === 'get_config') {
      if (!tenant_id) {
        return new Response(
          JSON.stringify({ error: 'tenant_id é obrigatório.' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const [{ data: config }, { data: tenant }] = await Promise.all([
        supabase
          .from('tenant_livechat_configs')
          .select('primary_color, welcome_title, welcome_subtitle, pill_text, header_title, header_subtitle, inactivity_timeout_minutes, is_active')
          .eq('tenant_id', tenant_id)
          .maybeSingle(),
        supabase
          .from('tenants')
          .select('locale, timezone')
          .eq('id', tenant_id)
          .maybeSingle()
      ]);

      return new Response(
        JSON.stringify({
          success: true,
          config: config ?? null,
          locale: tenant?.locale ?? 'pt-BR',
          timezone: tenant?.timezone ?? 'America/Sao_Paulo'
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Suporte para recuperar o histórico da conversa
    if (action === 'get_history') {
      if (!session_id || !tenant_id) {
        return new Response(
          JSON.stringify({ error: 'session_id e tenant_id são obrigatórios para carregar o histórico.' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validar que a sessão pertence ao tenant informado
      const { data: sessionRow, error: sessionErr } = await supabase
        .from('conversation_sessions')
        .select('id, omnichannel_status, assigned_to_user_id, patient_phone')
        .eq('id', session_id)
        .eq('tenant_id', tenant_id)
        .maybeSingle();

      if (sessionErr) throw sessionErr;
      if (!sessionRow) {
        return new Response(
          JSON.stringify({ error: 'Sessão não encontrada.' }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Notas internas (role='internal') nunca são expostas ao visitante
      const { data: convMsgs, error: msgsError } = await supabase
        .from('conversation_messages')
        .select('id, role, content, message_type, media_url, file_name, created_at')
        .eq('session_id', session_id)
        .neq('role', 'internal');

      if (msgsError) throw msgsError;

      // Pegar também mensagens pendentes na message_inbox (ex: a primeira mensagem "Fulano iniciou o atendimento" ou as recém-enviadas)
      const { data: inboxMsgs, error: inboxErr } = await supabase
        .from('message_inbox')
        .select('message_id, content, message_type, media_url, file_name, created_at')
        .eq('tenant_id', tenant_id)
        .eq('phone', sessionRow.patient_phone)
        .eq('status', 'pending');
      
      if (inboxErr) throw inboxErr;

      // Transformar inboxMsgs no mesmo formato de conversation_messages (como foram enviadas pelo visitante, role sempre é 'user')
      const pendingMsgs = (inboxMsgs || []).map(m => ({
        id: m.message_id,
        role: 'user',
        content: m.content,
        message_type: m.message_type,
        media_url: m.media_url,
        file_name: m.file_name,
        created_at: m.created_at
      }));

      // Juntar e ordenar
      const messages = [...(convMsgs || []), ...pendingMsgs].sort((a, b) => {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      // Nome do atendente atribuído (exibido no cabeçalho do widget)
      let agentName: string | null = null;
      if (sessionRow.assigned_to_user_id) {
        const { data: agentProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', sessionRow.assigned_to_user_id)
          .maybeSingle();
        agentName = agentProfile?.full_name ?? null;
      }

      return new Response(
        JSON.stringify({
          success: true,
          messages,
          session_status: sessionRow.omnichannel_status,
          agent_name: agentName
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Encerramento do atendimento pelo visitante (ou por inatividade no widget)
    if (action === 'end_session') {
      if (!session_id || !tenant_id) {
        return new Response(
          JSON.stringify({ error: 'session_id e tenant_id são obrigatórios para encerrar o atendimento.' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: closeError } = await supabase
        .from('conversation_sessions')
        .update({
          omnichannel_status: 'closed',
          closed_at: new Date().toISOString(),
          human_handoff: false
        })
        .eq('id', session_id)
        .eq('tenant_id', tenant_id);

      if (closeError) throw closeError;

      // Avisar o painel de atendimento e outras abas do visitante em tempo real
      const closeChannel = supabase.channel(`livechat:${session_id}`);
      await closeChannel.send({
        type: 'broadcast',
        event: 'session_closed',
        payload: { session_id, closed_by: 'visitor' }
      });

      console.log(`[livechat-visitor-message] Sessão ${session_id} encerrada pelo visitante.`);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: 'tenant_id é obrigatório.' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let activeSessionId = (session_id && session_id !== 'null' && session_id !== 'undefined') ? session_id : null;
    let isNewSession = false;

    // 2. Se for uma nova sessão, validar os campos obrigatórios (Nome, E-mail, Telefone)
    if (!activeSessionId) {
      const vName = typeof visitor_name === 'string' ? visitor_name.trim() : '';
      const vEmail = typeof visitor_email === 'string' ? visitor_email.trim() : '';
      const vPhone = typeof visitor_phone === 'string' ? visitor_phone.trim() : '';

      if (!vName || !vEmail || !vPhone) {
        return new Response(
          JSON.stringify({ error: 'Nome, E-mail e Telefone são obrigatórios para iniciar o atendimento.' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      activeSessionId = crypto.randomUUID();
      isNewSession = true;

      const cleanName = vName;
      const cleanEmail = vEmail;
      const cleanPhone = vPhone;

      // Cadastrar ou atualizar o lead na tabela de pacientes do tenant
      try {
        const { data: existingPt } = await supabase
          .from('patients')
          .select('id')
          .eq('tenant_id', tenant_id)
          .eq('phone', cleanPhone)
          .maybeSingle();

        if (existingPt) {
          await supabase
            .from('patients')
            .update({ full_name: cleanName, email: cleanEmail })
            .eq('id', existingPt.id);
        } else {
          await supabase
            .from('patients')
            .insert({
              tenant_id,
              full_name: cleanName,
              email: cleanEmail,
              phone: cleanPhone,
              metadata: { source: 'livechat' }
            });
        }
      } catch (ptErr) {
        console.warn('[livechat-visitor-message] Alerta ao registrar paciente:', ptErr);
      }

      // Telefone sintético único para a coluna de restrição no banco
      const syntheticPhone = `livechat-${crypto.randomUUID()}`;

      const { error: sessionError } = await supabase
        .from('conversation_sessions')
        .insert({
          id: activeSessionId,
          tenant_id,
          patient_phone: syntheticPhone,
          channel: 'livechat',
          omnichannel_status: 'bot_active', // Encaminha para o Agente de IA / Fluxo Estruturado
          context: {
            visitor_name: cleanName,
            visitor_email: cleanEmail,
            visitor_phone: cleanPhone
          }
        });

      if (sessionError) throw sessionError;
      console.log(`[livechat-visitor-message] Nova sessão de livechat criada: ${activeSessionId}`);
    } else {
      // Sessão existente: preservar o atendimento em andamento.
      // Só volta para o bot ('bot_active') se a sessão estava FECHADA — se um
      // atendente já está ativo (human_active), status e atribuição são mantidos
      // para que a conversa continue na lista dele sem precisar "Assumir" de novo.
      const { data: existingSession, error: fetchError } = await supabase
        .from('conversation_sessions')
        .select('omnichannel_status')
        .eq('id', activeSessionId)
        .eq('tenant_id', tenant_id)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!existingSession) {
        return new Response(
          JSON.stringify({ error: 'Sessão não encontrada.' }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (existingSession.omnichannel_status === 'closed') {
        updates.omnichannel_status = 'bot_active';
        updates.closed_at = null;
        updates.assigned_to_user_id = null;
      }

      const { error: updateError } = await supabase
        .from('conversation_sessions')
        .update(updates)
        .eq('id', activeSessionId);

      if (updateError) throw updateError;
    }

    let mediaUrl: string | null = null;
    let messageType = 'text';

    // 3. Se um arquivo for enviado, realizar o upload para o Storage
    if (fileObj) {
      const ext = fileObj.name.split('.').pop() || '';
      const isImage = fileObj.type.startsWith('image/');
      const isVideo = fileObj.type.startsWith('video/');
      const isAudio = fileObj.type.startsWith('audio/');
      const folder = isImage ? 'images' : isVideo ? 'videos' : isAudio ? 'audios' : 'documents';
      messageType = isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'document';

      const fileName = `${tenant_id}/livechat/${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(fileName, fileObj, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(uploadData.path);
      mediaUrl = publicUrl;
      console.log(`[livechat-visitor-message] Upload de arquivo realizado: ${mediaUrl}`);
    }

    if (!content.trim() && !fileObj) {
      return new Response(
        JSON.stringify({ error: 'A mensagem ou o arquivo é obrigatório.' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Buscar a sessão para obter patient_phone e status omnichannel
    const { data: sessionData, error: sessionErr } = await supabase
      .from('conversation_sessions')
      .select('patient_phone, omnichannel_status')
      .eq('id', activeSessionId)
      .single();

    if (sessionErr || !sessionData) throw sessionErr || new Error('Sessão não encontrada.');

    let formattedContent = fileObj ? (content || `[${messageType}]`) : content.trim();
    const vNameStr = typeof visitor_name === 'string' ? visitor_name.trim() : '';
    if (isNewSession && vNameStr) {
      const vEmailStr = typeof visitor_email === 'string' ? visitor_email.trim() : '';
      const vPhoneStr = typeof visitor_phone === 'string' ? visitor_phone.trim() : '';
      formattedContent = `📋 [Dados do Lead - Live Chat]\nNome: ${vNameStr}\nE-mail: ${vEmailStr}\nTelefone: ${vPhoneStr}\n\n${formattedContent}`;
    }

    if (sessionData.omnichannel_status === 'human_active') {
      // FAST PATH: Atendimento Humano Ativo — grava direto em conversation_messages
      const { error: msgError } = await supabase
        .from('conversation_messages')
        .insert({
          id: msgId,
          session_id: activeSessionId,
          role: 'user',
          content: formattedContent,
          message_type: messageType,
          media_url: mediaUrl,
          file_name: fileObj ? fileObj.name : null,
          file_size: fileObj ? fileObj.size : null,
          mime_type: fileObj ? fileObj.type : null,
          created_at: createdAt
        });

      if (msgError) throw msgError;
    } else {
      // BOT PATH: Grava na message_inbox para o process-inbox (IA / Fluxo Estruturado) processar
      const { error: inboxErr } = await supabase
        .from('message_inbox')
        .insert({
          tenant_id,
          phone: sessionData.patient_phone,
          content: formattedContent,
          message_id: msgId,
          message_type: messageType,
          media_url: mediaUrl,
          status: 'pending',
          received_at: createdAt
        });

      if (inboxErr) throw inboxErr;
      console.log(`[livechat-visitor-message] Mensagem enfileirada na message_inbox para ${sessionData.patient_phone}`);
      
      // TRIGGER AI/PROCESS INBOX
      triggerInboxProcessing();
    }

    // 5. Transmitir via Supabase Realtime Broadcast para sincronizar a mensagem instantaneamente em todas as abas
    const realtimeChannel = supabase.channel(`livechat:${activeSessionId}`);
    await realtimeChannel.send({
      type: 'broadcast',
      event: 'message',
      payload: {
        id: msgId,
        role: 'user',
        content: formattedContent,
        message_type: messageType,
        media_url: mediaUrl,
        file_name: fileObj ? fileObj.name : null,
        created_at: createdAt
      }
    });

    return new Response(
      JSON.stringify({ success: true, session_id: activeSessionId, message_id: msgId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error('livechat-visitor-message error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno no servidor.' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
