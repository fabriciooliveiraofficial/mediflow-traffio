/**
 * restore-filtered-inbound — botão "Não é spam" da aba Filtrados do Inbox.
 *
 * Desfaz uma decisão do filtro anti-spam (_shared/inboundSpamFilter.ts):
 *   1. marca o remetente como 'trusted' (source 'human') na reputação GLOBAL —
 *      nenhuma camada automática volta a filtrá-lo, em nenhuma clínica;
 *   2. devolve a mensagem ao fluxo normal:
 *        - DM filtrada na entrada  → cria a sessão (como o webhook faria) e
 *          reinjeta em message_inbox → o agente responde;
 *        - DM filtrada pela triagem (Camada 3, meio de conversa) → reabre a
 *          sessão na FILA HUMANA: a IA já errou o julgamento uma vez ali, quem
 *          retoma é uma pessoa;
 *        - comentário → volta a 'pending' → o cron de respostas atende.
 *
 * Body: { kind: "dm" | "instagram_comment" | "facebook_comment", id: string }
 * Auth: JWT do usuário do painel; precisa ser membro do tenant dono do item.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { recordSenderVerdict, type MetaPlatform } from "../_shared/inboundSpamFilter.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) return json({ error: "não autenticado" }, 401);

    const { kind, id } = await req.json();
    if (!id || !["dm", "instagram_comment", "facebook_comment"].includes(kind)) {
      return json({ error: "kind (dm | instagram_comment | facebook_comment) e id são obrigatórios" }, 400);
    }

    const table = kind === "dm" ? "filtered_inbound" : kind === "instagram_comment" ? "instagram_comments" : "facebook_comments";
    const { data: row } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
    if (!row) return json({ error: "item não encontrado" }, 404);

    const { data: membership } = await supabase
      .from("members").select("user_id").eq("tenant_id", row.tenant_id).eq("user_id", user.id).maybeSingle();
    if (!membership) return json({ error: "sem acesso a esta clínica" }, 403);

    // ── Comentário ──────────────────────────────────────────────────────────
    if (kind !== "dm") {
      const platform: MetaPlatform = kind === "instagram_comment" ? "instagram" : "facebook";
      if (!row.filter_verdict) return json({ error: "este comentário não foi filtrado pelo anti-spam" }, 409);
      const senderId = row.from_id || `name:${row.from_username ?? row.from_name ?? "unknown"}`;
      await recordSenderVerdict(supabase, { platform, senderId, verdict: "trusted", reason: "restaurado no painel", source: "human", tenantId: row.tenant_id });
      const { error } = await supabase.from(table)
        .update({ status: "pending", filter_verdict: null, filter_reason: null })
        .eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true, restored: "comment" });
    }

    // ── DM ──────────────────────────────────────────────────────────────────
    if (row.restored_at) return json({ success: true, restored: "already" });
    const channel = row.channel as MetaPlatform;
    await recordSenderVerdict(supabase, { platform: channel, senderId: row.sender_id, verdict: "trusted", reason: "restaurado no painel", source: "human", tenantId: row.tenant_id });

    const { data: session } = await supabase
      .from("conversation_sessions")
      .select("id")
      .eq("tenant_id", row.tenant_id)
      .eq("patient_phone", row.sender_id)
      .maybeSingle();

    if (row.layer === "triage") {
      if (session) {
        await supabase.from("conversation_sessions")
          .update({ omnichannel_status: "queued", human_handoff: true, handoff_kind: "soft", handoff_reason: "manual" })
          .eq("id", session.id);
      }
    } else {
      if (!session) {
        // Mesmo insert do meta-social-webhook: sem `channel` aqui, a sessão
        // nasceria como 'whatsapp' e a resposta sairia pelo canal errado.
        await supabase.from("conversation_sessions").insert({
          tenant_id: row.tenant_id, patient_phone: row.sender_id, channel,
          current_state: "INIT", omnichannel_status: "bot_active",
          platform_user_id: row.sender_id, platform_display_name: row.sender_name, context: {},
        });
      }
      const { error: inboxErr } = await supabase.from("message_inbox").insert({
        tenant_id: row.tenant_id, phone: row.sender_id, content: row.content, message_id: row.message_id,
        message_type: row.message_type, media_url: row.media_url, caption: row.caption, channel,
        status: "pending", received_at: new Date().toISOString(),
      });
      if (inboxErr) return json({ error: `falha ao reinjetar a mensagem: ${inboxErr.message}` }, 500);

      // Push — mesmo padrão dos webhooks; o cron cobre se falhar.
      const push = fetch(`${supabaseUrl}/functions/v1/process-inbox`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
      try {
        // @ts-ignore
        EdgeRuntime.waitUntil(push);
      } catch { /* fire-and-forget */ }
    }

    await supabase.from("filtered_inbound")
      .update({ restored_at: new Date().toISOString(), restored_by: user.id })
      .eq("id", id);

    return json({ success: true, restored: row.layer === "triage" ? "human_queue" : "agent" });
  } catch (err: any) {
    console.error("[restore-filtered-inbound] erro:", err?.message);
    return json({ error: err?.message ?? "erro interno" }, 500);
  }
});
