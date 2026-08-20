/**
 * sync-facebook-comments — Edge Function
 *
 * Polling de comentários de posts da Página do Facebook — mesmo padrão de
 * sync-instagram-comments (fallback enquanto/se a assinatura de webhook em
 * tempo real não estiver disponível, e também como rede de segurança caso o
 * webhook falhe silenciosamente).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

const GRAPH_API = "https://graph.facebook.com/v21.0";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: pages, error } = await supabase
      .from("tenant_meta_pages")
      .select("tenant_id, page_id, page_access_token")
      .eq("is_active", true)
      .not("page_id", "is", null);

    if (error) throw error;

    let totalNew = 0;
    for (const page of pages ?? []) {
      try {
        totalNew += await syncCommentsForPage(supabase, page.tenant_id, page.page_id, page.page_access_token);
      } catch (err: any) {
        console.error(`[sync-facebook-comments] Failed for tenant ${page.tenant_id}:`, err.message);
      }
    }

    console.log(`[sync-facebook-comments] Done. ${totalNew} new comment(s) queued.`);
    return new Response(JSON.stringify({ success: true, new_comments: totalNew }), { headers: corsHeaders });
  } catch (err: any) {
    console.error("[sync-facebook-comments] Fatal:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

/** Varre os últimos posts da Página e importa comentários novos (dedupe por comment_id). */
async function syncCommentsForPage(
  supabase: any,
  tenantId: string,
  pageId: string,
  pageToken: string
): Promise<number> {
  const postsRes = await fetch(
    `${GRAPH_API}/${pageId}/posts?fields=id,comments.limit(50){id,message,from,created_time,parent}&limit=15&access_token=${pageToken}`
  );
  const postsData = await postsRes.json();
  if (postsData.error) {
    console.error(`[sync-facebook-comments] Posts fetch failed for ${pageId}:`, postsData.error.message);
    return 0;
  }

  let newCount = 0;
  for (const post of postsData.data ?? []) {
    for (const comment of post.comments?.data ?? []) {
      // Ignora o eco da nossa própria resposta (comentário feito pela própria Página)
      if (comment.from?.id === pageId) continue;

      const { data: already } = await supabase
        .from("facebook_comments")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("comment_id", comment.id)
        .maybeSingle();

      if (already) continue;

      const { error: insertErr } = await supabase.from("facebook_comments").insert({
        tenant_id:         tenantId,
        comment_id:        comment.id,
        post_id:           post.id,
        parent_comment_id: comment.parent?.id ?? null,
        page_id:           pageId,
        from_id:           comment.from?.id ?? null,
        from_name:         comment.from?.name ?? null,
        text:              comment.message ?? "",
        status:            "pending",
        received_at:       comment.created_time ?? new Date().toISOString(),
      });

      if (!insertErr) newCount++;
    }
  }

  return newCount;
}
