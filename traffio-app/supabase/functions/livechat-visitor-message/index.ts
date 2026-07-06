import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

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

    // Suporte para recuperar o histórico da conversa
    if (action === 'get_history') {
      if (!session_id) {
        return new Response(
          JSON.stringify({ error: 'session_id é obrigatório para carregar o histórico.' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { data: messages, error: msgsError } = await supabase
        .from('conversation_messages')
        .select('id, role, content, message_type, media_url, file_name, created_at')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });

      if (msgsError) throw msgsError;

      return new Response(
        JSON.stringify({ success: true, messages }),
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
      if (!visitor_name?.trim() || !visitor_email?.trim() || !visitor_phone?.trim()) {
        return new Response(
          JSON.stringify({ error: 'Nome, E-mail e Telefone são obrigatórios para iniciar o atendimento.' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      activeSessionId = crypto.randomUUID();
      isNewSession = true;

      // Telefone sintético único para a coluna de restrição no banco
      const syntheticPhone = `livechat-${crypto.randomUUID()}`;

      const { error: sessionError } = await supabase
        .from('conversation_sessions')
        .insert({
          id: activeSessionId,
          tenant_id,
          patient_phone: syntheticPhone,
          channel: 'livechat',
          omnichannel_status: 'queued', // Direto para a fila de atendimento humano
          context: {
            visitor_name: visitor_name.trim(),
            visitor_email: visitor_email.trim(),
            visitor_phone: visitor_phone.trim()
          }
        });

      if (sessionError) throw sessionError;
      console.log(`[livechat-visitor-message] Nova sessão de livechat criada: ${activeSessionId}`);
    } else {
      // Reabrir ou atualizar a sessão existente, jogando-a de volta para a fila do painel se fechada
      const { error: updateError } = await supabase
        .from('conversation_sessions')
        .update({
          omnichannel_status: 'queued',
          updated_at: new Date().toISOString()
        })
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

    // 4. Inserir a mensagem no histórico (conversation_messages)
    const { data: dbMsg, error: msgError } = await supabase
      .from('conversation_messages')
      .insert({
        session_id: activeSessionId,
        role: 'user', // 'user' indica o visitante
        content: fileObj ? (content || `[${messageType}]`) : content.trim(),
        message_type: messageType,
        media_url: mediaUrl,
        file_name: fileObj ? fileObj.name : null,
        file_size: fileObj ? fileObj.size : null,
        mime_type: fileObj ? fileObj.type : null
      })
      .select('id, created_at')
      .single();

    if (msgError) throw msgError;

    // 5. Transmitir via Supabase Realtime Broadcast para sincronizar a mensagem instantaneamente
    const realtimeChannel = supabase.channel(`livechat:${activeSessionId}`);
    await realtimeChannel.send({
      type: 'broadcast',
      event: 'message',
      payload: {
        id: dbMsg.id,
        role: 'user',
        content: fileObj ? (content || `[${messageType}]`) : content.trim(),
        message_type: messageType,
        media_url: mediaUrl,
        file_name: fileObj ? fileObj.name : null,
        created_at: dbMsg.created_at
      }
    });

    return new Response(
      JSON.stringify({ success: true, session_id: activeSessionId }),
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
