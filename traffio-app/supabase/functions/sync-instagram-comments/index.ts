/**
 * sync-instagram-comments — Edge Function
 *
 * Polling de comentários do Instagram (fallback para instagram_manage_comments).
 *
 * O webhook em tempo real (meta-social-webhook, field "comments") está pronto
 * no código, mas a Meta bloqueia a assinatura desse campo específico com
 * "(#3) Application does not have the capability to make this API call" —
 * provavelmente porque a permissão ainda não tem Advanced Access aprovado
 * (rejeitada no App Review de 14/07, pendente de reenvio). A leitura direta
 * via Graph API (GET /{media-id}/comments), porém, funciona normalmente com
 * o token já concedido — por isso este polling supre o gap enquanto o
 * webhook não é liberado. Mesmo padrão de sync-ads-performance (cron batendo
 * em todas as contas ativas).
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
      .select("tenant_id, instagram_account_id, page_access_token")
      .eq("is_active", true)
      .not("instagram_account_id", "is", null);

    if (error) throw error;

    let totalNew = 0;
    for (const page of pages ?? []) {
      try {
        totalNew += await syncCommentsForAccount(supabase, page.tenant_id, page.instagram_account_id, page.page_access_token);
      } catch (err: any) {
        console.error(`[sync-instagram-comments] Failed for tenant ${page.tenant_id}:`, err.message);
      }
    }

    console.log(`[sync-instagram-comments] Done. ${totalNew} new comment(s) queued.`);
    return new Response(JSON.stringify({ success: true, new_comments: totalNew }), { headers: corsHeaders });
  } catch (err: any) {
    console.error("[sync-instagram-comments] Fatal:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

/** Varre as últimas mídias da conta e importa comentários novos (dedupe por comment_id). */
async function syncCommentsForAccount(
  supabase: any,
  tenantId: string,
  igAccountId: string,
  pageToken: string
): Promise<number> {
  const mediaRes = await fetch(
    `${GRAPH_API}/${igAccountId}/media?fields=id,comments_count&limit=15&access_token=${pageToken}`
  );
  const mediaData = await mediaRes.json();
  if (mediaData.error) {
    console.error(`[sync-instagram-comments] Media fetch failed for ${igAccountId}:`, mediaData.error.message);
    return 0;
  }

  let newCount = 0;
  for (const media of mediaData.data ?? []) {
    if (!media.comments_count) continue;

    const commentsRes = await fetch(
      `${GRAPH_API}/${media.id}/comments?fields=id,text,username,timestamp,parent_id&access_token=${pageToken}`
    );
    const commentsData = await commentsRes.json();
    if (commentsData.error) {
      console.error(`[sync-instagram-comments] Comments fetch failed for media ${media.id}:`, commentsData.error.message);
      continue;
    }

    for (const comment of commentsData.data ?? []) {
      const { data: already } = await supabase
        .from("instagram_comments")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("comment_id", comment.id)
        .maybeSingle();

      if (already) continue;

      const { error: insertErr } = await supabase.from("instagram_comments").insert({
        tenant_id:         tenantId,
        comment_id:        comment.id,
        media_id:          media.id,
        parent_comment_id: comment.parent_id ?? null,
        ig_account_id:     igAccountId,
        from_id:           null,
        from_username:     comment.username ?? null,
        text:              comment.text ?? "",
        status:            "pending",
        received_at:       comment.timestamp ?? new Date().toISOString(),
      });

      if (!insertErr) newCount++;
    }
  }

  return newCount;
}
