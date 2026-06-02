/**
 * process-inbox — Edge Function (Supabase Cron, every 2 seconds)
 *
 * Inbox Worker: Debounce + Context Fusion + Conversation Lock + ClinicalAgent
 *
 * Flow per conversation turn:
 *   1. Fetch all pending messages grouped by (tenant_id, phone)
 *   2. Debounce: skip phones whose last message arrived < DEBOUNCE_MS ago
 *   3. Acquire PostgreSQL advisory lock per phone (prevents parallel runs)
 *   4. Context Fusion: concatenate all pending messages into one user turn
 *   5. Send typing indicator via Z-API
 *   6. Run ClinicalAgent once with the fused turn
 *   7. Send response
 *   8. Mark messages as done, release lock
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { TenantResolver } from "../_shared/tenantResolver.ts";
import { SessionManager } from "../_shared/sessionManager.ts";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { corsHeaders } from "../_shared/cors.ts";

// How long to wait after the last message before processing (ms).
// Gives the patient time to finish typing multiple messages.
const DEBOUNCE_MS = 1200;

console.log("process-inbox v1 — Debounce + Fusion Worker — Initialized");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase           = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const now    = Date.now();
    const cutoff = new Date(now - DEBOUNCE_MS).toISOString();

    // --- 1. Find all conversations with pending messages past the debounce window ---
    const { data: pendingGroups, error: fetchError } = await supabase
      .from("message_inbox")
      .select("tenant_id, phone")
      .eq("status", "pending")
      .lte("received_at", cutoff)
      .order("received_at", { ascending: true });

    if (fetchError) {
      console.error("[process-inbox] Fetch error:", fetchError.message);
      return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
    }

    if (!pendingGroups || pendingGroups.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: corsHeaders });
    }

    // Deduplicate: one entry per (tenant_id, phone)
    const seen    = new Set<string>();
    const batches = pendingGroups.filter((row: any) => {
      const key = `${row.tenant_id}:${row.phone}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let processed = 0;

    for (const batch of batches) {
      const { tenant_id, phone } = batch as any;
      try {
        await processConversationTurn(supabase, tenant_id, phone, cutoff);
        processed++;
      } catch (turnErr: any) {
        console.error(`[process-inbox] [${phone}] Turn failed:`, turnErr.message, turnErr.stack?.substring(0, 300));
        // Mark messages as failed so they don't block the queue forever
        try {
          const { data: failedMsgs } = await supabase
            .from("message_inbox")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("phone", phone)
            .in("status", ["pending", "processing"]);
          if (failedMsgs?.length) {
            await supabase
              .from("message_inbox")
              .update({ status: "failed" })
              .in("id", failedMsgs.map((m: any) => m.id));
          }
        } catch (_) { /* best effort cleanup */ }
      }
    }

    console.log(`[process-inbox] Processed ${processed} conversation(s)`);
    return new Response(JSON.stringify({ processed }), { headers: corsHeaders });

  } catch (err: any) {
    console.error("[process-inbox] Fatal error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

// =============================================================================
// Core: process one conversation turn (debounce + lock + fusion + agent)
// =============================================================================
async function processConversationTurn(
  supabase: any,
  tenantId: string,
  phone: string,
  cutoff: string
): Promise<void> {

  // --- CRITICAL FIX: Instantiate SessionManager ---
  const sessionManager = new SessionManager(supabase);

  // --- 2. Acquire advisory lock (per-phone, prevents parallel processing) ---
  // Lock key: hash of phone string to fit int8 range
  const lockKey = phoneToLockKey(phone);

  const { data: lockResult } = await supabase.rpc("pg_try_advisory_lock", { key: lockKey });
  if (!lockResult) {
    // Another worker is already processing this conversation — skip
    console.log(`[process-inbox] [${phone}] Lock busy, skipping`);
    return;
  }

  try {
    // --- 3. Fetch all pending messages for this phone up to debounce cutoff ---
    const { data: messages, error: msgError } = await supabase
      .from("message_inbox")
      .select("id, content, received_at, message_id, media_url, message_type, caption")
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .eq("status", "pending")
      .lte("received_at", cutoff)
      .order("received_at", { ascending: true });

    if (msgError || !messages || messages.length === 0) {
      console.log(`[process-inbox] No messages for ${phone} after re-check`);
      return;
    }

    const messageIds = messages.map((m: any) => m.id);

    // --- 4. Mark as processing (prevent double-pick by concurrent cron runs) ---
    const batchId = crypto.randomUUID();
    await supabase
      .from("message_inbox")
      .update({ status: "processing", batch_id: batchId })
      .in("id", messageIds);

    // --- 5. Context Fusion: merge multiple messages into one coherent user turn ---
    let fusedContent = messages.length === 1
      ? messages[0].content
      : messages.map((m: any) => m.content).join("\n");

    console.log(`[process-inbox] [${phone}] Fused ${messages.length} msg(s): "${fusedContent.substring(0, 80)}"`);

    // --- 5b. Media/voice guard — categorizar e salvar mídia para visibilidade humana ---
    // Z-API e Cloud API entregam mídia com content vazio ou markers tipo [áudio].
    // Categorizamos para que o atendente veja no chat, mesmo que o bot não processe.
    const mediaMatch = fusedContent?.trim().match(/^\[(áudio|audio|imagem|image|vídeo|video|documento|document|sticker|figurinha)\]$/i);
    const isMediaOnly = !fusedContent?.trim() || !!mediaMatch;

    if (isMediaOnly) {
      const typeMap: Record<string, string> = {
        audio: 'audio', áudio: 'audio', image: 'image', imagem: 'image',
        video: 'video', vídeo: 'video', document: 'document', documento: 'document',
        sticker: 'sticker', figurinha: 'sticker'
      };
      const detectedType = mediaMatch ? typeMap[mediaMatch[1].toLowerCase()] : 'text';

      console.log(`[process-inbox] [${phone}] Media detected (${detectedType}) — saving for human visibility`);
      
      // Buscar URL de mídia do message_inbox (se disponível)
      const { data: rawMsg } = await supabase
        .from('message_inbox')
        .select('media_url, caption')
        .in('id', messageIds)
        .not('media_url', 'is', null)
        .limit(1)
        .maybeSingle();

      const session = await sessionManager.getOrCreateSession(tenantId, phone);
      const incomingWaId = messages[0]?.message_id;

      await sessionManager.logMessage(session.id, 'user', rawMsg?.caption || fusedContent || `[${detectedType}]`, {
        whatsapp_message_id: incomingWaId,
        message_type: detectedType,
        media_url: rawMsg?.media_url,
        caption: rawMsg?.caption
      });

      // Trigger handoff para que o humano assuma o atendimento de mídia
      if (session.omnichannel_status !== 'human_active' && session.omnichannel_status !== 'queued') {
        await sessionManager.triggerHumanHandoff(session.id);
      }

      await markMessages(supabase, messageIds, 'done');
      return;
    }

    const session = await sessionManager.getOrCreateSession(tenantId, phone);

    // --- 6. Patient lookup & Funnel tracking (Passive CRM) ---
    const [{ data: patientRow }, { data: patientData }] = await Promise.all([
      supabase.from("patient_funnel_stage")
        .select("id, patient_name, current_stage")
        .eq("tenant_id", tenantId)
        .eq("patient_phone", phone)
        .maybeSingle(),
      supabase.from("patients")
        .select("id, full_name")
        .eq("tenant_id", tenantId)
        .eq("phone", phone)
        .maybeSingle()
    ]);

    const funnelUpdate: any = {
      last_interaction_at: new Date().toISOString(),
      last_message_snippet: fusedContent.length > 200 ? fusedContent.substring(0, 197) + '...' : fusedContent
    };

    if (!patientRow) {
        const sessionName = (session as any).context?.known_first_name ?? null;
        await supabase
          .from("patient_funnel_stage")
          .upsert({
            tenant_id: tenantId,
            patient_phone: phone,
            patient_name: patientData?.full_name || sessionName || null,
            current_stage: 'novo_lead',
            lead_source: 'whatsapp',
            ...funnelUpdate
          }, { onConflict: 'tenant_id, patient_phone' });
    } else {
        await supabase
          .from("patient_funnel_stage")
          .update(funnelUpdate)
          .eq('tenant_id', tenantId)
          .eq('patient_phone', phone);
    }

    // --- 7. Log message to history ---
    await sessionManager.logMessage(session.id, "user", fusedContent, {
      whatsapp_message_id: messages[0]?.message_id
    });

    // --- 8. Ensure Human Visibility (Trigger Handoff/Queue) ---
    console.log(`[process-inbox] [${phone}] Routing message to human queue.`);
    if (session.omnichannel_status !== "human_active" && session.omnichannel_status !== "queued") {
      await sessionManager.triggerHumanHandoff(session.id);
    }

    // --- 12. Mark inbox messages as done ---
    await markMessages(supabase, messageIds, "done");

  } finally {
    // Always release the advisory lock
    await supabase.rpc("pg_advisory_unlock", { key: lockKey });
  }
}

// =============================================================================
// Helpers
// =============================================================================

async function markMessages(supabase: any, ids: string[], status: string) {
  await supabase
    .from("message_inbox")
    .update({ status })
    .in("id", ids);
}

/**
 * Converts a phone number string to a stable int8 lock key.
 * Uses the last 9 digits of the phone (avoids country code collisions).
 */
function phoneToLockKey(phone: string): number {
  const digits = phone.replace(/\D/g, "").slice(-9);
  return parseInt(digits, 10) || 0;
}

