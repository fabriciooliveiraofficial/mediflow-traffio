/**
 * reply-instagram-comment — Edge Function
 *
 * Chamada pelo painel do Traffio (InstagramCommentsDrawer) quando um atendente
 * responde a um comentário público de post do Instagram (permissão
 * instagram_manage_comments). Diferente de send-human-message: não existe
 * conversation_session envolvida — o comentário vive em instagram_comments.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { MetaSocialClient } from "../_shared/metaSocialClient.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const { tenant_id, comment_id, text, user_id } = body;

    if (!tenant_id || !comment_id || !text?.trim() || !user_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id, comment_id, text e user_id são obrigatórios" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase    = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: comment, error: commentErr } = await supabase
      .from("instagram_comments")
      .select("id, comment_id, ig_account_id, status")
      .eq("tenant_id", tenant_id)
      .eq("comment_id", comment_id)
      .maybeSingle();

    if (commentErr || !comment) {
      return new Response(JSON.stringify({ error: "Comentário não encontrado" }), { status: 404, headers: corsHeaders });
    }

    const { data: metaPage } = await supabase
      .from("tenant_meta_pages")
      .select("page_access_token")
      .eq("tenant_id", tenant_id)
      .not("instagram_account_id", "is", null)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!metaPage?.page_access_token) {
      return new Response(
        JSON.stringify({ error: "Nenhuma conta do Instagram conectada/ativa para este tenant" }),
        { status: 400, headers: corsHeaders }
      );
    }

    await MetaSocialClient.replyToInstagramComment(metaPage.page_access_token, comment_id, text.trim());

    await supabase
      .from("instagram_comments")
      .update({
        status:             "replied",
        reply_text:         text.trim(),
        replied_at:         new Date().toISOString(),
        replied_by_user_id: user_id,
      })
      .eq("id", comment.id);

    console.log(`[reply-instagram-comment] Replied to comment ${comment_id} (tenant ${tenant_id})`);

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (err: any) {
    console.error("[reply-instagram-comment] Error:", err.message);
    // 200 com { error } — supabase-js não esconde a mensagem original (mesmo padrão de send-human-message)
    return new Response(JSON.stringify({ error: err.message }), { status: 200, headers: corsHeaders });
  }
});
