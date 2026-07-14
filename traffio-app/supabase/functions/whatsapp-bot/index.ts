/**
 * whatsapp-bot — Edge Function (Supabase)
 *
 * Webhook receiver for Z-API and Cloud API WhatsApp messages.
 *
 * V6 Architecture (Inbox Pattern + Dual Provider):
 *   Z-API / Cloud API → webhook → [guards] → [idempotency] → INSERT message_inbox → 200 OK
 *
 * Processing is fully decoupled:
 *   message_inbox → process-inbox cron (20s) → SessionManager → conversation_messages
 *
 * Benefits:
 *   - Webhook responds in <100ms regardless of processing time
 *   - Multiple messages from same patient are batched
 *   - No parallel processing for the same conversation (advisory lock)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { TenantResolver } from "../_shared/tenantResolver.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { runCopilot } from "../_shared/copilot.ts";

console.log("whatsapp-bot v6 — Inbox Pattern + Dual Provider — Initialized");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // --- Cloud API GET challenge (webhook verification handshake) ---
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && challenge) {
      console.log("[whatsapp-bot] Cloud API verification challenge accepted");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase           = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();

    // Log de entrada — confirma que o webhook chegou na função
    console.log(`[whatsapp-bot] ▶ POST recebido | provider=${body.object === 'whatsapp_business_account' ? 'cloud_api' : 'zapi'} | instanceId=${body.instanceId ?? 'n/a'} | phone=${body.phone ?? 'n/a'}`);

    // --- Route: Cloud API vs Z-API ---
    if (body.object === "whatsapp_business_account") {
      return await handleCloudApi(supabase, body);
    } else {
      return await handleZapi(supabase, body);
    }

  } catch (error: any) {
    console.error("[whatsapp-bot] Fatal Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});

// =============================================================================
// Z-API Handler (original v5 logic, battle-tested)
// =============================================================================
async function handleZapi(supabase: any, body: any): Promise<Response> {
  const instanceId = body.instanceId;
  const phone      = body.phone;
  const fromMe     = body.fromMe;
  const isGroup    = !!body.isGroup || phone?.includes("-") || phone?.includes("@g.us");

  // --- TENANT RESOLUTION ---
  const tenantResolver = new TenantResolver(supabase);
  const tenant = await tenantResolver.resolveByInstanceId(instanceId);
  if (!tenant) {
    console.error(`[whatsapp-bot] Z-API: Tenant not found for instance: ${instanceId}`);
    return new Response("Tenant not found", { status: 404 });
  }



  // --- LOOP & GROUP GUARD ---
  const isSelf = fromMe || body.sender?.isMe || body.sender?.fromMe;
  if (isGroup) return new Response(JSON.stringify({ ignored: true, reason: "group_message"  }), { status: 200 });
  if (isSelf)  return new Response(JSON.stringify({ ignored: true, reason: "self_message"   }), { status: 200 });

  // --- EXTRACT TEXT ---
  const inputContent =
    body.text?.message       ||
    body.message             ||
    body.data?.message       ||
    body.buttonResponse?.buttonId ||
    body.optionListResponse?.id;

  // --- EXTRACT MEDIA ---
  const mediaUrl  = body.image?.imageUrl || body.audio?.audioUrl || body.video?.videoUrl || body.document?.documentUrl || body.sticker?.stickerUrl || null;
  const caption   = body.image?.caption || body.video?.caption || body.document?.caption || null;
  let messageType = "text";
  if (body.image)    messageType = "image";
  if (body.audio)    messageType = "audio";
  if (body.video)    messageType = "video";
  if (body.document) messageType = "document";
  if (body.sticker)  messageType = "sticker";

  // Determine content: text OR media marker
  const content = inputContent || caption || (mediaUrl ? `[${messageType}]` : null);

  if (!instanceId || !phone || !content) {
    return new Response(JSON.stringify({ ignored: "Empty event" }), { status: 200 });
  }

  // --- IDEMPOTENCY ---
  const messageId = body.messageId || body.id || `${phone}_${body.timestamp ?? Date.now()}`;
  const { error: idempotencyError } = await supabase
    .from("processed_webhooks")
    .insert({ message_id: messageId, tenant_id: tenant.id });

  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      console.log(`[whatsapp-bot] Z-API: Duplicate webhook [${messageId}] — ignored`);
      return new Response(JSON.stringify({ ignored: true, reason: "duplicate_webhook" }), { status: 200 });
    }
    console.warn("[whatsapp-bot] Z-API: Idempotency non-fatal:", idempotencyError.message);
  }

  // --- HUMAN HANDOFF GUARD ---
  // Se humano está ativamente atendendo, NÃO colocar no inbox do bot.
  // A mensagem será capturada apenas pelo processo de log direto.
  const { data: session } = await supabase
    .from("conversation_sessions")
    .select("id, omnichannel_status, human_handoff")
    .eq("tenant_id", tenant.id)
    .eq("patient_phone", phone)
    .maybeSingle();

  // Mesmo em modo human_active, registrar a mensagem para visibilidade no chat
  if (session?.omnichannel_status === "human_active") {
    console.log(`[whatsapp-bot] Z-API: [${phone}] human_active — logging directly to conversation`);
    // Inserir direto em conversation_messages para que o atendente humano veja em tempo real
    await supabase.from("conversation_messages").insert({
      session_id:          session.id,
      role:                "user",
      content:             content,
      message_type:        messageType,
      media_url:           mediaUrl,
      caption:             caption,
      whatsapp_message_id: messageId,
    });
    // Atualizar rolling memory
    const recentMessages = await getRecentMessages(supabase, session.id);
    recentMessages.push({ role: "user", content, timestamp: new Date().toISOString() });
    const trimmed = recentMessages.length > 20 ? recentMessages.slice(-20) : recentMessages;
    await supabase.from("conversation_sessions").update({ recent_messages: trimmed }).eq("id", session.id);

    // F1 Copiloto: com humano ativo a mensagem NÃO passa pelo message_inbox,
    // então o rascunho é gerado daqui, em background — é justamente na conversa
    // assumida que o atendente mais precisa da sugestão.
    maybeRunCopilot(supabase, tenant, session.id, phone);

    return new Response(JSON.stringify({ status: "human_active_logged" }), { headers: corsHeaders });
  }

  // --- INSERT INTO MESSAGE INBOX ---
  const { error: inboxError } = await supabase
    .from("message_inbox")
    .insert({
      tenant_id:    tenant.id,
      phone,
      content,
      message_id:   messageId,
      message_type: messageType,
      media_url:    mediaUrl,
      caption:      caption,
      received_at:  new Date().toISOString(),
      status:       "pending",
    });

  if (inboxError) {
    if (inboxError.code === "23505") {
      console.log(`[whatsapp-bot] Z-API: Duplicate inbox entry [${messageId}] — ignored`);
      return new Response(JSON.stringify({ ignored: true, reason: "duplicate_inbox" }), { status: 200 });
    }
    console.error("[whatsapp-bot] Z-API: Inbox insert failed:", inboxError.message);
    return new Response(JSON.stringify({ error: "inbox_insert_failed" }), { status: 500 });
  }

  console.log(`[whatsapp-bot] Z-API: [${phone}] Queued: "${content.substring(0, 60)}" (${messageType})`);
  triggerInboxProcessing();
  return new Response(JSON.stringify({ status: "queued" }), { headers: corsHeaders });
}

// =============================================================================
// Cloud API Handler (Meta WhatsApp Business Platform)
// =============================================================================
async function handleCloudApi(supabase: any, body: any): Promise<Response> {
  const entry   = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value   = changes?.value;

  if (!value) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const messages = value.messages || [];
  const statuses = value.statuses || [];
  const metadata = value.metadata;
  const phoneNumberId = metadata?.phone_number_id;

  // Status updates only (delivery receipts) — acknowledge and return
  if (messages.length === 0) {
    if (statuses.length > 0) {
      console.log(`[whatsapp-bot] Cloud API: ${statuses.length} status update(s) received`);
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // --- TENANT RESOLUTION ---
  const tenantResolver = new TenantResolver(supabase);
  const tenant = await tenantResolver.resolveByCloudApiPhoneNumberId(phoneNumberId);
  if (!tenant) {
    console.error(`[whatsapp-bot] Cloud API: Tenant not found for phone_number_id: ${phoneNumberId}`);
    return new Response("Tenant not found", { status: 404 });
  }



  let inserted = 0;

  for (const msg of messages) {
    const phone   = msg.from;
    const msgType = msg.type;
    const msgId   = msg.id;

    // Extract content based on message type
    let content = "";
    let mediaUrl: string | null = null;
    let caption: string | null = null;
    let messageType = "text";

    if (msgType === "text") {
      content = msg.text?.body || "";
    } else if (msgType === "image") {
      mediaUrl = msg.image?.id; // Cloud API returns media_id, not URL
      caption  = msg.image?.caption || null;
      messageType = "image";
      content  = caption || "[imagem]";
    } else if (msgType === "audio") {
      mediaUrl = msg.audio?.id;
      messageType = "audio";
      content  = "[áudio]";
    } else if (msgType === "video") {
      mediaUrl = msg.video?.id;
      caption  = msg.video?.caption || null;
      messageType = "video";
      content  = caption || "[vídeo]";
    } else if (msgType === "document") {
      mediaUrl = msg.document?.id;
      messageType = "document";
      content  = msg.document?.filename || "[documento]";
    } else if (msgType === "sticker") {
      mediaUrl = msg.sticker?.id;
      messageType = "sticker";
      content  = "[figurinha]";
    } else if (msgType === "interactive") {
      // Button/list responses
      const interactive = msg.interactive;
      if (interactive?.type === "button_reply") {
        content = interactive.button_reply?.id || interactive.button_reply?.title || "";
      } else if (interactive?.type === "list_reply") {
        content = interactive.list_reply?.id || interactive.list_reply?.title || "";
      }
    } else if (msgType === "button") {
      content = msg.button?.text || msg.button?.payload || "";
    } else {
      content = `[${msgType}]`;
    }

    if (!content) continue;

    // --- IDEMPOTENCY ---
    const { error: idempotencyError } = await supabase
      .from("processed_webhooks")
      .insert({ message_id: msgId, tenant_id: tenant.id });

    if (idempotencyError?.code === "23505") {
      console.log(`[whatsapp-bot] Cloud API: Duplicate [${msgId}] — ignored`);
      continue;
    }

    // --- HUMAN HANDOFF GUARD ---
    const { data: session } = await supabase
      .from("conversation_sessions")
      .select("id, omnichannel_status")
      .eq("tenant_id", tenant.id)
      .eq("patient_phone", phone)
      .maybeSingle();

    if (session?.omnichannel_status === "human_active") {
      console.log(`[whatsapp-bot] Cloud API: [${phone}] human_active — logging directly`);
      await supabase.from("conversation_messages").insert({
        session_id:          session.id,
        role:                "user",
        content:             content,
        message_type:        messageType,
        media_url:           mediaUrl,
        caption:             caption,
        whatsapp_message_id: msgId,
      });
      const recentMessages = await getRecentMessages(supabase, session.id);
      recentMessages.push({ role: "user", content, timestamp: new Date().toISOString() });
      const trimmed = recentMessages.length > 20 ? recentMessages.slice(-20) : recentMessages;
      await supabase.from("conversation_sessions").update({ recent_messages: trimmed }).eq("id", session.id);
      maybeRunCopilot(supabase, tenant, session.id, phone);
      inserted++;
      continue;
    }

    // --- INSERT INTO MESSAGE INBOX ---
    const timestamp = msg.timestamp ? new Date(parseInt(msg.timestamp) * 1000).toISOString() : new Date().toISOString();
    const { error: inboxError } = await supabase
      .from("message_inbox")
      .insert({
        tenant_id:    tenant.id,
        phone,
        content,
        message_id:   msgId,
        message_type: messageType,
        media_url:    mediaUrl,
        caption:      caption,
        received_at:  timestamp,
        status:       "pending",
      });

    if (inboxError) {
      if (inboxError.code === "23505") {
        console.log(`[whatsapp-bot] Cloud API: Duplicate inbox [${msgId}] — ignored`);
        continue;
      }
      console.error("[whatsapp-bot] Cloud API: Inbox insert failed:", inboxError.message);
      continue;
    }

    inserted++;
    console.log(`[whatsapp-bot] Cloud API: [${phone}] Queued: "${content.substring(0, 60)}" (${messageType})`);
  }

  if (inserted > 0) triggerInboxProcessing();
  return new Response(JSON.stringify({ status: "queued", inserted }), { headers: corsHeaders });
}

// =============================================================================
// F1 Copiloto no caminho human_active: as mensagens de conversas assumidas por
// humano não passam pelo message_inbox, então o rascunho é disparado daqui.
// Roda em background (waitUntil) — o webhook nunca espera a IA.
// =============================================================================
function maybeRunCopilot(supabase: any, tenant: any, sessionId: string, phone: string) {
  const botConfig = tenant?.bot_config || {};
  const activeAgent = botConfig.active_agent ?? (botConfig.enabled ? "ai_assistant" : "human");
  // copilot: sempre rascunho. ai_always: aqui a sessão está human_active
  // (a IA nunca responde por cima do humano) — então também vira rascunho.
  if (activeAgent !== "copilot" && activeAgent !== "ai_always") return;

  runInBackground(
    runCopilot(supabase, {
      tenantId: tenant.id,
      sessionId,
      phone,
      clinicName: tenant.name || "",
      botConfig,
    }).catch((e: any) => console.warn(`[whatsapp-bot] copilot background falhou (non-fatal): ${e?.message}`)),
  );
}

/** Mantém a task viva após a resposta do webhook (fire-and-forget se não houver waitUntil). */
function runInBackground(task: Promise<unknown>) {
  try {
    // @ts-ignore — disponível no runtime das Edge Functions da Supabase
    EdgeRuntime.waitUntil(task);
  } catch {
    /* runtime sem waitUntil — a task segue em fire-and-forget */
  }
}

// =============================================================================
// Latência (F1): aciona o process-inbox por push logo após enfileirar — o cron
// de ~20s vira apenas vassoura de segurança. O delay de 1,5s deixa a mensagem
// vencer o debounce curto e absorve rajadas imediatas; o advisory lock e a
// checagem de pendências no process-inbox garantem que invocações concorrentes
// são inofensivas.
// =============================================================================
function triggerInboxProcessing() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;

  const task = (async () => {
    await new Promise((r) => setTimeout(r, 1500));
    await fetch(`${url}/functions/v1/process-inbox`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch((e) => console.warn("[whatsapp-bot] push trigger failed (cron cobre):", e?.message));
  })();

  runInBackground(task);
}

// =============================================================================
// Helper: get recent messages from session for rolling memory update
// =============================================================================
async function getRecentMessages(supabase: any, sessionId: string): Promise<any[]> {
  const { data } = await supabase
    .from("conversation_sessions")
    .select("recent_messages")
    .eq("id", sessionId)
    .single();
  return data?.recent_messages || [];
}
