/**
 * ai-reply-instagram-comments — Edge Function
 *
 * Resposta automática por IA a comentários pendentes do Instagram — padrão
 * ManyChat: gera (1) uma resposta pública curta (aparece publicamente abaixo
 * do comentário, via replyToInstagramComment) e (2) uma resposta privada
 * (Private Reply oficial da Meta — sendPrivateReplyToComment, cai na caixa
 * de entrada de quem comentou; se a pessoa responder, a conversa passa a
 * fluir pelo webhook de DM normal, sem nenhuma integração extra necessária).
 *
 * Opt-in por tenant: obedece o mesmo "AI Dial" da página Intelligence
 * (Humano / Copiloto / IA Sempre — bot_config.active_agent) que já rege o
 * agente para DM/livechat/WhatsApp. Só responde comentário automaticamente
 * quando active_agent === 'ai_always' — em 'human' ou 'copilot' o comentário
 * fica pending para um atendente responder pelo painel, igual às outras
 * conversas nesses modos. Não é uma flag nova/escondida — reusa o controle
 * que o usuário já tem na UI.
 *
 * Roda alguns minutos depois de sync-instagram-comments no cron (o
 * comentário precisa estar em `instagram_comments` antes de a IA poder
 * responder).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { claudeChat } from "../_shared/llmProvider.ts";
import { getAiModelAgent } from "../_shared/masterConfig.ts";
import { MetaSocialClient } from "../_shared/metaSocialClient.ts";

const DRAFT_TOOL = {
  name: "draft_comment_reply",
  description: "Rascunha a resposta pública e a resposta privada para um comentário do Instagram.",
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
        .from("instagram_comments")
        .select("id, comment_id, ig_account_id, from_username, text")
        .eq("tenant_id", tenant.id)
        .eq("status", "pending")
        .order("received_at", { ascending: true })
        .limit(10);

      if (pendingErr || !pending?.length) continue;

      const { data: metaPage } = await supabase
        .from("tenant_meta_pages")
        .select("page_access_token")
        .eq("tenant_id", tenant.id)
        .not("instagram_account_id", "is", null)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (!metaPage?.page_access_token) continue;

      for (const comment of pending) {
        try {
          const replied = await replyToComment(supabase, tenant, comment, metaPage.page_access_token, agentModel);
          if (replied) totalReplied++;
        } catch (err: any) {
          console.error(`[ai-reply-instagram-comments] Failed for comment ${comment.comment_id}:`, err.message);
        }
      }
    }

    console.log(`[ai-reply-instagram-comments] Done. ${totalReplied} comment(s) replied.`);
    return new Response(JSON.stringify({ success: true, replied: totalReplied }), { headers: corsHeaders });
  } catch (err: any) {
    console.error("[ai-reply-instagram-comments] Fatal:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

async function replyToComment(
  supabase: any,
  tenant: { id: string; name: string; bot_config: any },
  comment: { id: string; comment_id: string; ig_account_id: string; from_username: string | null; text: string | null },
  pageToken: string,
  model: string
): Promise<boolean> {
  const clinicName = tenant.name || "nossa clínica";

  const system = `Você é o assistente de redes sociais da clínica "${clinicName}" no Instagram. Alguém comentou publicamente em um post. Sua tarefa é redigir DUAS respostas curtas usando a ferramenta draft_comment_reply:

1. public_reply: resposta pública breve (1-2 frases), calorosa, que aparece publicamente logo abaixo do comentário. Deve convidar a pessoa a checar a caixa de mensagens (você também vai mandar uma mensagem privada).
2. private_reply: mensagem privada um pouco mais completa, dando continuidade ao assunto do comentário e convidando a pessoa a tirar dúvidas ou agendar uma avaliação.

Regras obrigatórias (violar qualquer uma é falha grave):
- NUNCA mencione preços, valores, planos ou parcelamento — nem aproximados. Se perguntarem sobre valores, diga que a equipe explica tudo direitinho na conversa.
- Fale do BENEFÍCIO para a pessoa (sorrir com confiança, mastigar sem dor, se sentir bem) — nunca use jargão clínico/técnico (nomes de procedimento, materiais, termos médicos).
- Tom acolhedor e humano, nunca robótico ou como script de vendas agressivo.
- Não prometa horário específico de agendamento — você não tem acesso à agenda aqui.
- Não invente informação sobre a clínica que você não tem.
- Responda em português do Brasil, a não ser que o comentário esteja claramente em outro idioma.`;

  const userMsg = `Comentário de @${comment.from_username ?? "usuário"}: "${comment.text ?? ""}"`;

  const result = await claudeChat(supabase, {
    tenantId: tenant.id,
    purpose: "instagram_comment_ai_reply",
    model,
    maxTokens: 400,
    system,
    messages: [{ role: "user", content: userMsg }],
    tools: [DRAFT_TOOL],
    toolChoice: { type: "tool", name: "draft_comment_reply" },
  });

  const toolCall = result.toolCalls.find((t) => t.name === "draft_comment_reply");
  if (!toolCall) {
    console.warn(`[ai-reply-instagram-comments] No tool call returned for comment ${comment.comment_id}`);
    return false;
  }

  const publicReply = String(toolCall.input.public_reply ?? "").trim();
  const privateReply = String(toolCall.input.private_reply ?? "").trim();
  if (!publicReply || !privateReply) return false;

  await MetaSocialClient.replyToInstagramComment(pageToken, comment.comment_id, publicReply);

  // Resposta privada é best-effort: a Private Replies API exige a mesma
  // capability que a Meta ainda não liberou para instagram_manage_comments
  // (erro #3, "Application does not have the capability to make this API
  // call" — mesmo bloqueio do webhook em tempo real, ver
  // instagram_comments_capability_gap.md). Se falhar aqui, a resposta
  // pública (que já funciona) NÃO pode ficar bloqueada, e o comentário
  // PRECISA ser marcado como respondido — senão o cron reprocessa o mesmo
  // comentário a cada execução e duplica a resposta pública indefinidamente
  // (incidente real: 7 respostas duplicadas em produção em 20/08/2026 antes
  // deste guard existir).
  let privateReplySent = false;
  try {
    await MetaSocialClient.sendPrivateReplyToComment(pageToken, comment.ig_account_id, comment.comment_id, privateReply);
    privateReplySent = true;
  } catch (privateErr: any) {
    console.warn(`[ai-reply-instagram-comments] Private reply failed for ${comment.comment_id} (non-fatal, capability provavelmente não liberada ainda): ${privateErr.message}`);
  }

  // Crítico: se este UPDATE falhar, o comentário fica pending pra sempre e o
  // cron posta a resposta pública de novo a cada execução — por isso checa o
  // erro explicitamente em vez de assumir sucesso silencioso.
  const { error: updateErr } = await supabase
    .from("instagram_comments")
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

  console.log(`[ai-reply-instagram-comments] ✓ Replied to comment ${comment.comment_id} (tenant ${tenant.id})`);
  return true;
}
