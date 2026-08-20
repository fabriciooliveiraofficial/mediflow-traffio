/**
 * ai-reply-facebook-comments — Edge Function
 *
 * Resposta automática por IA a comentários pendentes de posts da Página do
 * Facebook — espelha ai-reply-instagram-comments (mesmo padrão ManyChat:
 * resposta pública + Private Reply). Mesmo opt-in: só processa tenants com
 * bot_config.active_agent === 'ai_always' (o mesmo AI Dial da página
 * Intelligence, não uma flag nova).
 *
 * IMPORTANTE (lição do incidente de 20/08/2026 com o Instagram): a resposta
 * privada é sempre best-effort — se falhar, a resposta pública (que já foi
 * publicada) tem que ser registrada como "replied" de qualquer forma, senão
 * o cron reprocessa o mesmo comentário pending a cada execução e duplica a
 * resposta pública indefinidamente.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { claudeChat } from "../_shared/llmProvider.ts";
import { getAiModelAgent } from "../_shared/masterConfig.ts";
import { MetaSocialClient } from "../_shared/metaSocialClient.ts";

const DRAFT_TOOL = {
  name: "draft_comment_reply",
  description: "Rascunha a resposta pública e a resposta privada para um comentário do Facebook.",
  input_schema: {
    type: "object",
    properties: {
      public_reply: {
        type: "string",
        description: "Resposta pública curta (1-2 frases), aparece publicamente abaixo do comentário.",
      },
      private_reply: {
        type: "string",
        description: "Mensagem privada mais completa, enviada na caixa de entrada de quem comentou.",
      },
    },
    required: ["public_reply", "private_reply"],
  },
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: tenants, error: tenantsErr } = await supabase
      .from("tenants")
      .select("id, name, bot_config")
      .eq("bot_config->>active_agent", "ai_always");

    if (tenantsErr) throw tenantsErr;

    if (!tenants?.length) {
      return new Response(JSON.stringify({ success: true, replied: 0, note: "no tenant with active_agent=ai_always" }), { headers: corsHeaders });
    }

    const agentModel = await getAiModelAgent(supabase);
    let totalReplied = 0;

    for (const tenant of tenants) {
      const { data: pending, error: pendingErr } = await supabase
        .from("facebook_comments")
        .select("id, comment_id, page_id, from_name, text")
        .eq("tenant_id", tenant.id)
        .eq("status", "pending")
        .order("received_at", { ascending: true })
        .limit(10);

      if (pendingErr || !pending?.length) continue;

      const { data: metaPage } = await supabase
        .from("tenant_meta_pages")
        .select("page_access_token")
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (!metaPage?.page_access_token) continue;

      for (const comment of pending) {
        try {
          const replied = await replyToComment(supabase, tenant, comment, metaPage.page_access_token, agentModel);
          if (replied) totalReplied++;
        } catch (err: any) {
          console.error(`[ai-reply-facebook-comments] Failed for comment ${comment.comment_id}:`, err.message);
        }
      }
    }

    console.log(`[ai-reply-facebook-comments] Done. ${totalReplied} comment(s) replied.`);
    return new Response(JSON.stringify({ success: true, replied: totalReplied }), { headers: corsHeaders });
  } catch (err: any) {
    console.error("[ai-reply-facebook-comments] Fatal:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

async function replyToComment(
  supabase: any,
  tenant: { id: string; name: string; bot_config: any },
  comment: { id: string; comment_id: string; page_id: string; from_name: string | null; text: string | null },
  pageToken: string,
  model: string
): Promise<boolean> {
  const clinicName = tenant.name || "nossa clínica";

  const system = `Você é o assistente de redes sociais da clínica "${clinicName}" no Facebook. Alguém comentou publicamente em um post da Página. Sua tarefa é redigir DUAS respostas curtas usando a ferramenta draft_comment_reply:

1. public_reply: resposta pública breve (1-2 frases), calorosa, que aparece publicamente logo abaixo do comentário. Deve convidar a pessoa a checar a caixa de mensagens (você também vai mandar uma mensagem privada).
2. private_reply: mensagem privada um pouco mais completa, dando continuidade ao assunto do comentário e convidando a pessoa a tirar dúvidas ou agendar uma avaliação.

Regras obrigatórias (violar qualquer uma é falha grave):
- NUNCA mencione preços, valores, planos ou parcelamento — nem aproximados. Se perguntarem sobre valores, diga que a equipe explica tudo direitinho na conversa.
- Fale do BENEFÍCIO para a pessoa (sorrir com confiança, mastigar sem dor, se sentir bem) — nunca use jargão clínico/técnico (nomes de procedimento, materiais, termos médicos).
- Tom acolhedor e humano, nunca robótico ou como script de vendas agressivo.
- Não prometa horário específico de agendamento — você não tem acesso à agenda aqui.
- Não invente informação sobre a clínica que você não tem.
- Responda em português do Brasil, a não ser que o comentário esteja claramente em outro idioma.`;

  const userMsg = `Comentário de ${comment.from_name ?? "usuário"}: "${comment.text ?? ""}"`;

  const result = await claudeChat(supabase, {
    tenantId: tenant.id,
    purpose: "facebook_comment_ai_reply",
    model,
    maxTokens: 400,
    system,
    messages: [{ role: "user", content: userMsg }],
    tools: [DRAFT_TOOL],
    toolChoice: { type: "tool", name: "draft_comment_reply" },
  });

  const toolCall = result.toolCalls.find((t) => t.name === "draft_comment_reply");
  if (!toolCall) {
    console.warn(`[ai-reply-facebook-comments] No tool call returned for comment ${comment.comment_id}`);
    return false;
  }

  const publicReply = String(toolCall.input.public_reply ?? "").trim();
  const privateReply = String(toolCall.input.private_reply ?? "").trim();
  if (!publicReply || !privateReply) return false;

  await MetaSocialClient.replyToFacebookComment(pageToken, comment.comment_id, publicReply);

  // Best-effort — nunca deixar a privada travar o registro da pública (ver
  // nota no cabeçalho do arquivo sobre o incidente de duplicação).
  let privateReplySent = false;
  try {
    await MetaSocialClient.sendPrivateReplyToFacebookComment(pageToken, comment.page_id, comment.comment_id, privateReply);
    privateReplySent = true;
  } catch (privateErr: any) {
    console.warn(`[ai-reply-facebook-comments] Private reply failed for ${comment.comment_id} (non-fatal): ${privateErr.message}`);
  }

  const { error: updateErr } = await supabase
    .from("facebook_comments")
    .update({
      status:                 "replied",
      reply_text:             publicReply,
      private_reply_text:     privateReplySent ? privateReply : null,
      replied_at:             new Date().toISOString(),
      private_reply_sent_at:  privateReplySent ? new Date().toISOString() : null,
      ai_generated:           true,
    })
    .eq("id", comment.id);

  if (updateErr) {
    throw new Error(`resposta pública já publicada, mas falhou ao gravar status no banco: ${updateErr.message}`);
  }

  console.log(`[ai-reply-facebook-comments] ✓ Replied to comment ${comment.comment_id} (tenant ${tenant.id})`);
  return true;
}
