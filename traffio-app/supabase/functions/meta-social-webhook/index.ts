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

    // Processar cada entry de forma síncrona para evitar congelamento da Deno Deploy
    try {
      await processEntries(supabase, channel, body.entry ?? []);
    } catch (err: any) {
      console.error("[meta-social-webhook] Error processing entries:", err.message);
    }

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
      await processMessagingEvent(supabase, tenantId, channel, messaging, page.page_access_token ?? null);
    }

    // ── Handover Protocol: a Página nasce com "Page Inbox" como Primary Receiver.
    // Enquanto não assumirmos o controle da conversa, a Meta entrega os eventos
    // pelo canal `standby` em vez de `messaging`. Processamos a mensagem do mesmo
    // jeito e pedimos o controle da thread para que as próximas chegem como `messaging`.
    for (const standby of entry.standby ?? []) {
      await processMessagingEvent(supabase, tenantId, channel, standby, page.page_access_token ?? null);
      if (channel === "facebook" && page.page_access_token && standby.sender?.id) {
        await requestThreadControl(page.page_access_token, standby.sender.id);
      }
    }
  }
}

async function requestThreadControl(pageAccessToken: string, recipientId: string): Promise<void> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/request_thread_control?access_token=${pageAccessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: recipientId }, metadata: "traffio-auto-handover" }),
      }
    );
    const data = await res.json();
    if (!data.success) {
      console.error(`[meta-social-webhook] Failed to request thread control for ${recipientId}:`, JSON.stringify(data));
    } else {
      console.log(`[meta-social-webhook] ✓ Requested thread control for ${recipientId}`);
    }
  } catch (err: any) {
    console.error(`[meta-social-webhook] Exception requesting thread control for ${recipientId}:`, err.message);
  }
}

/**
 * Busca o nome real do remetente na Graph API usando o page token que já
 * usamos para responder. 1 chamada por sessão nova (não por mensagem) —
 * sem isto o CRM exibe "Instagram User" genérico para sempre.
 */
async function fetchProfileName(
  channel: "instagram" | "facebook",
  userId: string,
  pageAccessToken: string | null
): Promise<string | null> {
  if (!pageAccessToken) return null;
  try {
    const fields = channel === "instagram" ? "name,username" : "first_name,last_name";
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${userId}?fields=${fields}&access_token=${pageAccessToken}`
    );
    const data = await res.json();
    if (data.error) {
      console.warn(`[meta-social-webhook] Profile fetch failed for ${userId}:`, JSON.stringify(data.error));
      return null;
    }
    if (channel === "instagram") return data.name || data.username || null;
    const full = [data.first_name, data.last_name].filter(Boolean).join(" ");
    return full || null;
  } catch (err: any) {
    console.warn(`[meta-social-webhook] Profile fetch exception for ${userId}:`, err.message);
    return null;
  }
}

async function processMessagingEvent(
  supabase: any,
  tenantId: string,
  channel: "instagram" | "facebook",
  messaging: any,
  pageAccessToken: string | null
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

  // Anexo (imagem, áudio, vídeo ou arquivo) — Meta envia em message.attachments[0]
  const attachment = message?.attachments?.[0];
  const mediaUrl   = attachment?.payload?.url ?? null;
  const messageType = mediaUrl ? toAppMessageType(attachment.type) : "text";

  // Conteúdo da mensagem (texto, título/payload de postback, ou marcador de mídia)
  const rawText = message?.text ?? postback?.title ?? postback?.payload ?? "";
  const text = rawText || (mediaUrl ? `[${messageType}]` : "");
  const caption = mediaUrl && rawText ? rawText : null;
  const messageId = message?.mid ?? `postback_${timestamp}_${senderId}`;

  if (!senderId || !text) return;

  console.log(`[meta-social-webhook] ${channel} | sender: ${senderId} | tenant: ${tenantId} | text: "${text.substring(0, 50)}"${mediaUrl ? ` | media: ${messageType}` : ''}`);

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
    .select("id, omnichannel_status, platform_user_id, platform_display_name, recent_messages")
    .eq("tenant_id", tenantId)
    .eq("patient_phone", senderId)
    .maybeSingle();

  if (!existingSession) {
    // Buscar o nome real ANTES do insert: o trigger AFTER INSERT da sessão
    // cria o card no CRM e registra a identidade já com o display_name.
    const displayName = await fetchProfileName(channel, senderId, pageAccessToken);

    // Criar nova sessão para este contato
    await supabase.from("conversation_sessions").insert({
      tenant_id:             tenantId,
      patient_phone:         senderId,   // Para IG/FB: usar o sender ID como identificador
      channel:               channel,
      current_state:         "INIT",
      omnichannel_status:    "bot_active",
      platform_user_id:      senderId,
      platform_display_name: displayName,
      context:               {},
    });
    console.log(`[meta-social-webhook] Created new ${channel} session for sender ${senderId}${displayName ? ` (${displayName})` : ''}`);
  } else {
    if (!existingSession.platform_user_id || !existingSession.platform_display_name) {
      // Backfill de platform_user_id e do nome real em sessões antigas.
      // O UPDATE de platform_display_name dispara tr_crm_session_display_name,
      // que propaga o nome para crm_journey_identities.
      const displayName = existingSession.platform_display_name
        || await fetchProfileName(channel, senderId, pageAccessToken);
      await supabase.from("conversation_sessions")
        .update({
          platform_user_id: senderId,
          channel,
          ...(displayName && !existingSession.platform_display_name ? { platform_display_name: displayName } : {}),
        })
        .eq("tenant_id", tenantId)
        .eq("patient_phone", senderId);
    }

    // --- HUMAN HANDOFF FAST PATH ---
    // Se a conversa já está sob controle humano, registrar a mensagem no histórico diretamente,
    // evitando os 30s de latência do process-inbox cron.
    if (existingSession.omnichannel_status === "human_active") {
      console.log(`[meta-social-webhook] ${channel} | ${senderId} | human_active — logging directly to conversation`);
      await supabase.from("conversation_messages").insert({
        session_id:          existingSession.id,
        role:                "user",
        content:             text,
        message_type:        messageType,
        media_url:           mediaUrl,
        caption:             caption,
        whatsapp_message_id: messageId,
      });

      // Atualizar memória rotativa (recent_messages)
      const recent = existingSession.recent_messages || [];
      recent.push({ role: "user", content: text, timestamp: new Date().toISOString() });
      const trimmed = recent.length > 20 ? recent.slice(-20) : recent;
      await supabase.from("conversation_sessions").update({ recent_messages: trimmed }).eq("id", existingSession.id);
      return;
    }
  }

  // Tratamento de timestamp (Meta pode enviar microssegundos ou formato estranho)
  let validTimestamp = Date.now();
  if (timestamp) {
    if (timestamp > 9999999999999) {
      // Se vier em microssegundos (ex: 1781739354903000), converte para milissegundos
      validTimestamp = Math.floor(timestamp / 1000);
    } else {
      validTimestamp = timestamp;
    }
  }

  // 4. Inserir na message_inbox (inbox pattern — mesmo do whatsapp-bot)
  const { error: inboxErr } = await supabase.from("message_inbox").insert({
    tenant_id:    tenantId,
    phone:        senderId,
    content:      text,
    message_id:   messageId,
    message_type: messageType,
    media_url:    mediaUrl,
    caption:      caption,
    status:       "pending",
    received_at:  new Date(validTimestamp).toISOString(),
  });

  if (inboxErr) {
    console.error(`[meta-social-webhook] Failed to insert into message_inbox:`, inboxErr.message);
  } else {
    console.log(`[meta-social-webhook] ✓ [${channel}] Queued message ${messageId} from ${senderId}`);
  }
}

/** Mapeia o `attachment.type` do webhook da Meta para o vocabulário interno de message_type do app. */
function toAppMessageType(metaType: string): string {
  switch (metaType) {
    case "file":
      return "document";
    case "image":
    case "video":
    case "audio":
      return metaType;
    default:
      return "document";
  }
}
