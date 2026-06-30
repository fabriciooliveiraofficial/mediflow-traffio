/**
 * check-recall — Edge Function (Supabase Cron, daily at 9h UTC)
 * v2.0 — Reescrito para schema real + outbound_message_queue
 *
 * Lógica:
 *   1. Para cada tenant com recall_enabled = true no bot_config:
 *      a. Lê recall_days (padrão: 180 dias)
 *      b. Encontra pacientes com last_visit_at < agora - recall_days
 *      c. Verifica cooldown: não enviar se já foi recalled nos últimos recall_days/2 dias
 *      d. Enfileira mensagem 'recall' na outbound_message_queue
 *   2. Respeita quiet hours (8h–22h no timezone do tenant)
 *   3. Processa até 30 pacientes por tenant por execução (batching)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

console.log("check-recall v2.0 initialized");

function getLocalHour(date: Date, timezone: string): number {
    try {
        return parseInt(
            new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                hour:     "numeric",
                hour12:   false,
            }).format(date),
            10
        );
    } catch {
        return date.getUTCHours();
    }
}

function getRecallScheduledAt(timezone: string): string {
    const now = new Date();
    const localHour = getLocalHour(now, timezone);

    // Se já passou das 9h local, agenda para amanhã às 9h; caso contrário, hoje às 9h
    const scheduledLocal = new Date();
    scheduledLocal.setHours(0, 0, 0, 0);

    // Calcula offset UTC do timezone
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone:     timezone,
            timeZoneName: "shortOffset",
        }).formatToParts(now);
        const tzStr = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
        const match = tzStr.match(/GMT([+-]\d+(?::\d+)?)?/);
        const raw   = match?.[1] ?? "+0";
        const [hPart, mPart = "0"] = raw.replace("+", "").replace("-", "").split(":");
        const sign  = raw.startsWith("-") ? 1 : -1;
        const offsetMs = sign * (parseInt(hPart, 10) * 60 + parseInt(mPart, 10)) * 60 * 1000;

        // 9h local em UTC
        const nineAmUtcMs = Date.UTC(
            scheduledLocal.getUTCFullYear(),
            scheduledLocal.getUTCMonth(),
            scheduledLocal.getUTCDate(),
            9,
            0, 0
        ) + offsetMs;

        const targetMs = nineAmUtcMs + (localHour >= 9 ? 24 * 60 * 60 * 1000 : 0);
        return new Date(targetMs).toISOString();
    } catch {
        // Fallback: amanhã às 9h UTC
        const fallback = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        fallback.setUTCHours(9, 0, 0, 0);
        return fallback.toISOString();
    }
}

serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase           = createClient(supabaseUrl, supabaseServiceKey);

    try {
        const now = new Date();
        let totalEnqueued = 0;

        // 1. Buscar todos os tenants com recall habilitado
        const { data: tenants, error: tenantsErr } = await supabase
            .from("tenants")
            .select("id, name, bot_config, timezone")
            .not("bot_config", "is", null);

        if (tenantsErr) throw tenantsErr;

        for (const tenant of tenants ?? []) {
            const botConfig  = (tenant.bot_config ?? {}) as Record<string, any>;
            const recallEnabled = botConfig.recall_enabled === true;

            if (!recallEnabled) continue;

            const recallDays    = (botConfig.recall_days as number) ?? 180;
            const cooldownDays  = Math.max(30, Math.floor(recallDays / 2));
            const timezone      = tenant.timezone || "America/Sao_Paulo";

            const cutoffDate   = new Date(now.getTime() - recallDays    * 24 * 60 * 60 * 1000);
            const cooldownDate = new Date(now.getTime() - cooldownDays  * 24 * 60 * 60 * 1000);

            // 2. Buscar pacientes deste tenant com last_visit_at antiga
            const { data: patients, error: patientsErr } = await supabase
                .from("patients")
                .select("id, full_name, phone, preferred_locale")
                .eq("tenant_id", tenant.id)
                .lt("last_visit_at", cutoffDate.toISOString())
                .not("phone", "is", null)
                .limit(30);

            if (patientsErr) {
                console.error(`[check-recall] Patients query failed for tenant ${tenant.id}:`, patientsErr.message);
                continue;
            }

            for (const patient of patients ?? []) {
                if (!patient.phone) continue;

                // 3. Verificar cooldown — não enviar se já foi recall-ado recentemente
                const { count: recentCount } = await supabase
                    .from("outbound_message_queue")
                    .select("*", { count: "exact", head: true })
                    .eq("tenant_id",   tenant.id)
                    .eq("patient_phone", patient.phone)
                    .eq("template_key", "recall")
                    .in("status", ["pending", "sent", "processing"])
                    .gte("created_at", cooldownDate.toISOString());

                if (recentCount && recentCount > 0) {
                    console.log(`[check-recall] Cooldown skip: ${patient.phone} (tenant ${tenant.id})`);
                    continue;
                }

                // 4. Determinar canal preferido
                let channel     = "whatsapp";
                let recipientId = patient.phone;

                const { data: pref } = await supabase
                    .from("patient_channel_preferences")
                    .select("preferred_channel, sms_phone, whatsapp_phone, email")
                    .eq("patient_phone", patient.phone)
                    .maybeSingle();

                if (pref?.preferred_channel) {
                    channel = pref.preferred_channel;
                    if (channel === "sms")       recipientId = pref.sms_phone      ?? patient.phone;
                    if (channel === "whatsapp")  recipientId = pref.whatsapp_phone ?? patient.phone;
                    if (channel === "email")     recipientId = pref.email          ?? patient.phone;
                }

                // Verificar se o canal tem automações habilitadas
                const channelAutomations = (botConfig.channel_automations ?? {}) as Record<string, any>;
                const channelEnabled     = channelAutomations[channel]?.no_show === true
                    || channelAutomations[channel]?.nps === true;

                if (!channelEnabled) channel = "whatsapp"; // fallback

                // 5. Calcular scheduled_at (próxima 9h local do tenant)
                const scheduledAt = getRecallScheduledAt(timezone);

                const locale = (() => {
                    const l = (botConfig.notification_locale || patient.preferred_locale || "pt").toLowerCase();
                    if (l.startsWith("en")) return "en";
                    if (l.startsWith("es")) return "es";
                    return "pt";
                })();

                // 6. Enfileirar recall
                const { error: insertErr } = await supabase
                    .from("outbound_message_queue")
                    .insert({
                        tenant_id:            tenant.id,
                        patient_phone:        patient.phone,
                        message_type:         "recall",
                        template_key:         "recall",
                        template_vars: {
                            patient_name: patient.full_name || "Paciente",
                            clinic_name:  tenant.name,
                            locale,
                        },
                        scheduled_at:         scheduledAt,
                        reference_id:         null,
                        reference_type:       "patient",
                        status:               "pending",
                        notification_channel: channel,
                        channel_recipient_id: recipientId,
                        is_edited:            false,
                    });

                if (insertErr) {
                    console.error(`[check-recall] Insert failed for ${patient.phone}:`, insertErr.message);
                } else {
                    totalEnqueued++;
                    console.log(`[check-recall] ✓ Recall queued | ${patient.phone} | ${channel} | tenant ${tenant.id}`);
                }
            }
        }

        return new Response(
            JSON.stringify({ enqueued: totalEnqueued, tenants_processed: (tenants ?? []).length }),
            { status: 200, headers: corsHeaders }
        );

    } catch (err: any) {
        console.error("[check-recall] Fatal error:", err.message);
        return new Response(
            JSON.stringify({ error: err.message }),
            { status: 500, headers: corsHeaders }
        );
    }
});
