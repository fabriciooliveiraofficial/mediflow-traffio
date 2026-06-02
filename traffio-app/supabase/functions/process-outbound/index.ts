/**
 * process-outbound — Edge Function (Supabase Cron, every 1 minute)
 *
 * Outbound Worker: Scheduled Messages Processor
 *
 * Flow:
 *   1. Fetch pending messages from outbound_message_queue where scheduled_at <= now
 *   2. Use advisory lock to prevent parallel processing
 *   3. Render template using message_templates.ts
 *   4. Send directly via Z-API using tenant credentials
 *   5. Update status in outbound_message_queue
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { getRenderedMessage } from "../_shared/messageTemplates.ts";
import { corsHeaders } from "../_shared/cors.ts";

console.log("process-outbound v2 — Initialized");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase           = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const now = new Date().toISOString();
    console.log(`[process-outbound] Checking queue at ${now}`);

    // ── Quiet Hours Guard ────────────────────────────────────────────────────
    // Never send follow-ups between 22:00 and 08:00 (Brazil/São Paulo time).
    // Sending at night dramatically increases block/report rates.
    const brazilHour = parseInt(
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false
      }).format(new Date()), 10
    );
    const isQuietHours = brazilHour >= 22 || brazilHour < 8;
    if (isQuietHours) {
      console.log(`[process-outbound] Quiet hours (${brazilHour}h Brazil). Skipping follow-ups.`);
      return new Response(JSON.stringify({ processed: 0, reason: "quiet_hours" }), { headers: corsHeaders });
    }

    // 1. Fetch pending messages (no join — avoid FK dependency issues)
    const { data: queue, error: fetchErr } = await supabase
        .from('outbound_message_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_at', now)
        .lt('attempts', 3)
        .order('scheduled_at', { ascending: true })
        .limit(20);

    if (fetchErr) {
      console.error("[process-outbound] Fetch error:", JSON.stringify(fetchErr));
      throw fetchErr;
    }

    console.log(`[process-outbound] Found ${queue?.length ?? 0} eligible messages`);

    if (!queue || queue.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: corsHeaders });
    }

    // 2. Fetch unique tenants needed for this batch
    const tenantIds = [...new Set(queue.map((m: any) => m.tenant_id))];
    const { data: tenants, error: tenantErr } = await supabase
        .from('tenants')
        .select('id, name, zapi_instance_id, zapi_token, zapi_client_token')
        .in('id', tenantIds);

    if (tenantErr) {
      console.error("[process-outbound] Tenant fetch error:", JSON.stringify(tenantErr));
      throw tenantErr;
    }

    const tenantMap = Object.fromEntries((tenants ?? []).map((t: any) => [t.id, t]));

    const outbox = new OutboxDispatcher(supabase);
    let processed = 0;

    for (const msg of queue) {
        // 3. Acquire advisory lock (prevents parallel processing of same message)
        const { data: lockResult, error: lockErr } = await supabase.rpc("pg_try_advisory_lock", { key: crc32(msg.id) });
        if (lockErr || !lockResult) {
          console.log(`[process-outbound] Lock not acquired for msg ${msg.id}`);
          continue;
        }

        // 3b. booking_confirmed messages are ALWAYS a duplicate:
        // The booking confirmation is sent immediately by SidebarBookingView (human agent)
        if (msg.message_type === 'booking_confirmed' || msg.template_key === 'booking_confirmed') {
            await supabase.from('outbound_message_queue').update({ 
                status: 'cancelled',
                error_log: 'Automatically cancelled: duplicate of manual/bot confirmation'
            }).eq('id', msg.id);
            continue;
        }

        try {
            // 4. Mark as processing
            await supabase.from('outbound_message_queue').update({ status: 'processing' }).eq('id', msg.id);

            // 4c. Skip reminders if appointment already confirmed by patient
            if ((msg.message_type === 'reminder_24h' || msg.message_type === 'reminder_2h') && msg.reference_id) {
                const { data: appt } = await supabase
                    .from('appointments')
                    .select('confirmation_status')
                    .eq('id', msg.reference_id)
                    .maybeSingle();
                if (appt?.confirmation_status === 'confirmed') {
                    console.log(`[process-outbound] Skipping ${msg.message_type} — appointment already confirmed`);
                    await supabase.from('outbound_message_queue').update({ status: 'cancelled' }).eq('id', msg.id);
                    continue;
                }
            }

            // 5. Render Template or use Override
            let text = "";
            if (msg.is_edited && msg.template_vars?.override_message) {
                text = msg.template_vars.override_message;
                console.log(`[process-outbound] Using manual override for msg ${msg.id}`);
            } else {
                text = getRenderedMessage(msg.template_key, msg.template_vars);
            }

            const tenant = tenantMap[msg.tenant_id];

            if (!tenant?.zapi_instance_id || !tenant?.zapi_token) {
                throw new Error(`Tenant Z-API credentials missing for tenant ${msg.tenant_id}`);
            }

            // 6. Delivery — send directly via Z-API or Cloud API
            if (msg.media_url) {
                console.log(`[process-outbound] Sending MEDIA (${msg.media_type}) to ${msg.patient_phone}`);
                await outbox.sendMedia(tenant, msg.patient_phone, {
                    media_url: msg.media_url,
                    media_type: msg.media_type || 'video',
                    caption: text
                });
            } else {
                console.log(`[process-outbound] Sending TEXT to ${msg.patient_phone}`);
                await outbox.sendNow(tenant, msg.patient_phone, { text });
            }

            // 7. Success Update
            await supabase.from('outbound_message_queue').update({
                status: 'sent',
                sent_at: new Date().toISOString()
            }).eq('id', msg.id);



            // 8b. Confirmation Reminder Tracking — cancel remaining reminders if 48h was sent
            // (24h reminder will only send if patient hasn't confirmed yet via agent)
            if (msg.message_type === 'reminder_48h' && msg.reference_id) {
                // Update appointment status to 'awaiting_confirmation' for tracking
                await supabase
                    .from('appointments')
                    .update({ confirmation_status: 'awaiting' })
                    .eq('id', msg.reference_id)
                    .is('confirmation_status', null);
                console.log(`[process-outbound] Appointment ${msg.reference_id} → awaiting_confirmation`);
            }

            processed++;
            console.log(`[process-outbound] ✓ Sent ${msg.template_key} to ${msg.patient_phone}`);

        } catch (e: any) {
            console.error(`[process-outbound] Error processing msg ${msg.id}:`, e.message);
            const newAttempts = (msg.attempts || 0) + 1;
            await supabase.from('outbound_message_queue').update({
                status: newAttempts >= 3 ? 'failed' : 'pending',
                attempts: newAttempts,
                error_message: e.message
            }).eq('id', msg.id);
        } finally {
            await supabase.rpc("pg_advisory_unlock", { key: crc32(msg.id) });
        }
    }

    console.log(`[process-outbound] Completed. Processed: ${processed}`);
    return new Response(JSON.stringify({ processed }), { headers: corsHeaders });

  } catch (err: any) {
    console.error("[process-outbound] Fatal error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

/** Simple CRC32-like hash for string to int8 lock key */
function crc32(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}
