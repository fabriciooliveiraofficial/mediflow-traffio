/**
 * meta-social-webhook — Edge Function
 *
 * Webhook receiver para mensagens de Instagram DM e Facebook Messenger.
 * Segue o mesmo Inbox Pattern do whatsapp-bot:
 *   Meta → webhook → INSERT message_inbox → 200 OK
 *   message_inbox → process-inbox (cron) → SessionManager → AI agent
 *
 * Configurar no painel Meta Developers:
 *   App → Webhooks → Callback URL: {SUPABASE_URL}/functions/v1/meta-social-webhook
 *   Verify Token: valor do secret META_VERIFY_TOKEN
 *   Subscriptions: messages, messaging_postbacks (para Instagram e Pages)
 *
 * body.object === "instagram" → Instagram DM
 * body.object === "page"      → Facebook Messenger
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { upsertChannelPreference } from "../_shared/upsertChannelPreference.ts";
import { getMetaVerifyToken } from "../_shared/masterConfig.ts";
import { corsHeaders } from "../_shared/cors.ts";

console.log("meta-social-webhook v1 — Instagram DM + Facebook Messenger — Initialized");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Client criado antes do GET handler para poder ler master_config
  const supabaseUrl  = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase     = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── GET: Verificação do webhook (Meta envia challenge na configuração) ────
  if (req.method === "GET") {
    const url       = new URL(req.url);
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    // Prioridade: Supabase Secret → master_config (UI /master/intelligence)
    const expected  = await getMetaVerifyToken(supabase);

    if (mode === "subscribe" && token === expected && challenge) {
      console.log("[meta-social-webhook] Verification challenge accepted");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const body = await req.json();

    // Responder 200 imediatamente (Meta exige resposta em <5s)
    const response200 = new Response("EVENT_RECEIVED", { status: 200 });

    const objectType = body.object; // "instagram" | "page"
    if (!objectType || !["instagram", "page"].includes(objectType)) {
      console.log(`[meta-social-webhook] Ignored — unknown object type: ${objectType}`);
      return response200;
    }

    const channel: "instagram" | "facebook" = objectType === "instagram" ? "instagram" : "facebook";

    // Processar cada entry de forma assíncrona (não bloqueante)
    processEntries(supabase, channel, body.entry ?? []).catch((err) =>
      console.error("[meta-social-webhook] Background error:", err.message)
    );

    return response200;

  } catch (err: any) {
    console.error("[meta-social-webhook] Fatal:", err.message);
    return new Response("EVENT_RECEIVED", { status: 200 }); // Sempre 200 para Meta não reenviar
  }
});

// ─── Processamento assíncrono das mensagens ──────────────────────────────────

async function processEntries(
  supabase: any,
  channel: "instagram" | "facebook",
  entries: any[]
): Promise<void> {
  for (const entry of entries) {
    const accountOrPageId = entry.id; // IG account ID ou FB Page ID

    // Identificar o tenant pelo page/account ID
    const query = channel === "instagram"
      ? supabase.from("tenant_meta_pages").select("tenant_id, page_access_token, instagram_account_id").eq("instagram_account_id", accountOrPageId).eq("is_active", true).maybeSingle()
      : supabase.from("tenant_meta_pages").select("tenant_id, page_access_token").eq("page_id", accountOrPageId).eq("is_active", true).maybeSingle();

    const { data: page, error: pageErr } = await query;
    if (pageErr || !page) {
      console.warn(`[meta-social-webhook] No tenant found for ${channel} account/page: ${accountOrPageId}`);
      continue;
    }

    const tenantId = page.tenant_id;

    for (const messaging of entry.messaging ?? []) {
      await processMessagingEvent(supabase, tenantId, channel, messaging);
    }
  }
}

async function processMessagingEvent(
  supabase: any,
  tenantId: string,
  channel: "instagram" | "facebook",
  messaging: any
): Promise<void> {
  const senderId    = messaging.sender?.id;
  const recipientId = messaging.recipient?.id;
  const timestamp   = messaging.timestamp;
  const message     = messaging.message;
  const postback    = messaging.postback;

  // Ignorar mensagens enviadas pela própria página (echo)
  if (messaging.message?.is_echo) {
    console.log(`[meta-social-webhook] Ignored echo from ${senderId}`);
    return;
  }

  // Ignorar se não for mensagem nem postback
  if (!message && !postback) return;

  // Conteúdo da mensagem
  const text = message?.text ?? postback?.title ?? postback?.payload ?? "";
  const messageId = message?.mid ?? `postback_${timestamp}_${senderId}`;

  if (!senderId || !text) return;

  console.log(`[meta-social-webhook] ${channel} | sender: ${senderId} | tenant: ${tenantId} | text: "${text.substring(0, 50)}"`);

  // 1. Salvar preferência de canal com o ID da plataforma
  await upsertChannelPreference(supabase, tenantId, senderId, {
    preferred_channel:  channel,
    instagram_user_id:  channel === "instagram" ? senderId : undefined,
    facebook_user_id:   channel === "facebook"  ? senderId : undefined,
  });

  // 2. Garantir idempotência — ignorar mensagem já processada
  const { data: already } = await supabase
    .from("message_inbox")
    .select("id")
    .eq("message_id", messageId)
    .maybeSingle();

  if (already) {
    console.log(`[meta-social-webhook] Duplicate message ${messageId} — ignored`);
    return;
  }

  // 3. Garantir/atualizar conversation_session
  const { data: existingSession } = await supabase
    .from("conversation_sessions")
    .select("id, omnichannel_status, platform_user_id")
    .eq("tenant_id", tenantId)
    .eq("patient_phone", senderId)
    .maybeSingle();

  if (!existingSession) {
    // Criar nova sessão para este contato
    await supabase.from("conversation_sessions").insert({
      tenant_id:            tenantId,
      patient_phone:        senderId,   // Para IG/FB: usar o sender ID como identificador
      channel:              channel,
      current_state:        "INIT",
      omnichannel_status:   "bot_active",
      platform_user_id:     senderId,
      context:              {},
    });
    console.log(`[meta-social-webhook] Created new ${channel} session for sender ${senderId}`);
  } else if (!existingSession.platform_user_id) {
    // Atualizar platform_user_id se ainda não estava preenchido
    await supabase.from("conversation_sessions")
      .update({ platform_user_id: senderId, channel })
      .eq("tenant_id", tenantId)
      .eq("patient_phone", senderId);
  }

  // 4. Inserir na message_inbox (inbox pattern — mesmo do whatsapp-bot)
  const { error: inboxErr } = await supabase.from("message_inbox").insert({
    tenant_id:   tenantId,
    phone:       senderId,
    content:     text,
    message_id:  messageId,
    status:      "pending",
    received_at: new Date(timestamp ? timestamp : Date.now()).toISOString(),
  });

  if (inboxErr) {
    console.error(`[meta-social-webhook] Failed to insert into message_inbox:`, inboxErr.message);
  } else {
    console.log(`[meta-social-webhook] ✓ [${channel}] Queued message ${messageId} from ${senderId}`);
  }
}
