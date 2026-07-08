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
import { getNextLocalNineAM } from "../_shared/tenantTime.ts";
import { resolveEligibleChannels } from "../_shared/channelResolver.ts";

console.log("check-recall v2.1 (canal padrão do tenant) initialized");

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
                .select("id, full_name, phone, preferred_locale, email")
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

                // 4. Determinar canal: preferência do paciente ∩ matriz do tenant,
                // com fallback para o canal padrão do tenant. Recall pertence à
                // coluna "Recuperação" da matriz. Sem canal elegível nem sequer
                // no padrão → paciente é pulado (nunca fallback fixo p/ WhatsApp).
                const { data: pref } = await supabase
                    .from("patient_channel_preferences")
                    .select("preferred_channel, sms_phone, whatsapp_phone, email")
                    .eq("tenant_id", tenant.id)
                    .eq("patient_phone", patient.phone)
                    .maybeSingle();

                const resolveRecipient = (ch: string): string => {
                    if (ch === "sms" || ch === "mms") return pref?.sms_phone ?? patient.phone;
                    if (ch === "email")               return pref?.email ?? patient.email ?? "";
                    return pref?.whatsapp_phone ?? patient.phone;
                };

                // preferred_channel pode ser lista ("whatsapp,email")
                const preferredChannels = (pref?.preferred_channel || "")
                    .split(",")
                    .map((c: string) => c.trim())
                    .filter(Boolean)
                    .map((ch: string) => ({ channel: ch as any, recipientId: resolveRecipient(ch) }));

                const channelAutomations = (botConfig.channel_automations ?? {}) as Record<string, any>;
                const eligible = resolveEligibleChannels({
                    preferredChannels,
                    matrix:        channelAutomations,
                    automationKey: "recovery",
                    botConfig,
                    patientPhone:  patient.phone,
                    patientEmail:  patient.email,
                });

                if (eligible.length === 0) {
                    console.log(`[check-recall] Sem canal elegível para ${patient.phone} (tenant ${tenant.id}) — recall não enviado`);
                    continue;
                }

                const channel     = eligible[0].channel;
                const recipientId = eligible[0].recipientId;

                // 5. Calcular scheduled_at (próxima 9h local do tenant)
                const scheduledAt = getNextLocalNineAM(timezone);

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

                    // Reabre (ou cria) o card do paciente no CRM Journey Engine em
                    // 'recall_due' — sem isto o recall dispara mensagem mas o CRM
                    // nunca sabe que o paciente voltou a estar em prospecção ativa.
                    const { data: journeyId, error: journeyErr } = await supabase.rpc("crm_ensure_journey", {
                        p_tenant_id:   tenant.id,
                        p_patient_id:  patient.id,
                        p_lead_phone:  patient.phone,
                        p_session_id:  null,
                        p_origin:      "recall",
                    });
                    if (journeyErr) {
                        console.error(`[check-recall] crm_ensure_journey failed for ${patient.phone}:`, journeyErr.message);
                    } else if (journeyId) {
                        const { error: moveErr } = await supabase.rpc("crm_move_stage", {
                            p_journey_id: journeyId,
                            p_to_stage:   "recall_due",
                            p_actor:      "system",
                        });
                        if (moveErr) {
                            console.error(`[check-recall] crm_move_stage failed for ${patient.phone}:`, moveErr.message);
                        }
                    }
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
