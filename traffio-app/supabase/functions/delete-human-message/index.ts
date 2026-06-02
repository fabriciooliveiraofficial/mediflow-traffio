import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { message_id, session_id, tenant_id, user_id, delete_on_whatsapp } = body;

    if (!message_id || !tenant_id || !user_id) {
      return new Response(
        JSON.stringify({ error: 'message_id, tenant_id e user_id são obrigatórios' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Verificar se a mensagem existe e pertence à sessão/tenant
    const { data: msg, error: msgError } = await supabase
      .from('conversation_messages')
      .select(`
        id, 
        role, 
        whatsapp_message_id, 
        session_id,
        conversation_sessions (
          tenant_id,
          patient_phone,
          tenants (
            whatsapp_provider,
            zapi_instance_id,
            zapi_token,
            zapi_client_token
          )
        )
      `)
      .eq('id', message_id)
      .single();

    if (msgError || !msg) {
      return new Response(JSON.stringify({ error: 'Mensagem não encontrada' }), { status: 404, headers: corsHeaders });
    }

    const session = (msg as any).conversation_sessions;
    if (session.tenant_id !== tenant_id) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 403, headers: corsHeaders });
    }

    let waDeleteSuccess = false;
    let waError = null;

    // 2. Tentar deletar no WhatsApp se solicitado e aplicável
    if (delete_on_whatsapp && msg.whatsapp_message_id && msg.role !== 'internal') {
      const outbox = new OutboxDispatcher(supabase);
      try {
        const isOwner = msg.role === 'human' || msg.role === 'bot'; // Deletamos as que nós enviamos como "owner"
        await outbox.deleteMessage(session.tenants, session.patient_phone, msg.whatsapp_message_id, isOwner);
        waDeleteSuccess = true;
      } catch (e: any) {
        console.error('[delete-human-message] WhatsApp delete failed:', e.message);
        waError = e.message;
        // Se falhou no WhatsApp, retornamos erro a menos que haja um override (futuro)
        // Por padrão, se pediu delete_on_whatsapp e falhou, não deletamos do DB ainda para permitir retry.
        // Exceto se Cloud API, que já lança erro no Dispatcher.
        if (session.tenants.whatsapp_provider === 'cloud_api') {
            return new Response(JSON.stringify({ error: 'Cloud API não suporta exclusão para todos.' }), { status: 400, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ error: `WhatsApp Error: ${e.message}` }), { status: 500, headers: corsHeaders });
      }
    }

    // 3. Deletar do Banco de Dados
    const { error: deleteError } = await supabase
      .from('conversation_messages')
      .delete()
      .eq('id', message_id);

    if (deleteError) {
      return new Response(JSON.stringify({ error: 'Erro ao deletar do banco: ' + deleteError.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      whatsapp_deleted: waDeleteSuccess,
      whatsapp_error: waError
    }), { headers: corsHeaders });

  } catch (error: any) {
    console.error('delete-human-message error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
