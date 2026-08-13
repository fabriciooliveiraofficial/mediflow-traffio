// @ts-nocheck
/**
 * schedule-reminders — Edge Function (Supabase Cron)
 * v4.0 — Multi-Canal + Multi-timezone
 *
 * Novidades v4:
 *   - Consulta patient_channel_preferences para rotear cada lembrete
 *     pelo canal preferido do paciente (WhatsApp, Instagram, Facebook, SMS)
 *   - Auto-detect: se sem preferência manual, usa o canal da última sessão ativa
 *   - Popula notification_channel + channel_recipient_id na fila
 *   - Vídeos de lembrete só se aplicam ao canal WhatsApp
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { getSafeScheduledTime, getUTCOffsetString, isAppointmentAnchoredOffset, isReminderTargetStillEligible } from "../_shared/tenantTime.ts";
import { resolveEligibleChannels, type ChannelInfo as ResolvedChannelInfo } from "../_shared/channelResolver.ts";

console.log("schedule-reminders v4.1 (canal padrão do tenant + multi-timezone) initialized");

function renderCustomCaption(template: string, vars: any): string {
    if (!template) return "";
    let rendered = template;
    const map: Record<string, string> = {
        '{{nome_paciente}}':        vars.patient_name || "",
        '{{data_agendamento}}':     vars.date || "",
        '{{horario_agendamento}}':  vars.time || "",
        '{{slot_agendado}}':        vars.time || "",
        '{{nome_doutor}}':          vars.doctor_name || "",
        '{{nome_do_profissional}}': vars.doctor_name || "",
        '{{nome_procedimento}}':    vars.procedure_name || "",
        '{{nome_local}}':           vars.location_name || "",
        '{{link_endereco}}':        vars.location_link || "",
        '{{link_sala_espera}}':     vars.waiting_room_link || "",
        '{{sala_de_espera}}':       vars.waiting_room_link || "",
        '{{link_checkin}}':         vars.checkin_link || "",
        '{{nome_clinica}}':         vars.clinic_name || "Nossa Clínica",
    };
    for (const [key, val] of Object.entries(map)) {
        rendered = rendered.replaceAll(key, val);
    }
    return rendered;
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

type ChannelInfo = ResolvedChannelInfo;

function normalizeLocale(value: unknown): 'pt' | 'en' | 'es' {
    const locale = String(value || '').toLowerCase();
    if (locale.startsWith('en')) return 'en';
    if (locale.startsWith('es')) return 'es';
    return 'pt';
}

/** `start_time` é um horário civil da clínica, não um instante UTC. */
function formatReminderTime(value: string, timeFormat: string | null | undefined, locale: string): string {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return String(value || '').substring(0, 5);
    const hour = Number(match[1]);
    const minute = match[2];
    const use12h = timeFormat === '12h' || (timeFormat !== '24h' && normalizeLocale(locale) === 'en');
    if (!use12h) return `${String(hour).padStart(2, '0')}:${minute}`;
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute} ${suffix}`;
}

function formatReminderDate(value: string, locale: string): string {
    const [year, month, day] = String(value || '').split('-');
    if (!year || !month || !day) return String(value || '');
    return normalizeLocale(locale) === 'en' ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}

// ─── Handler principal ───────────────────────────────────────────────────────

serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase           = createClient(supabaseUrl, supabaseServiceKey);

    try {
        const now       = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        // A varredura começa no dia UTC anterior para não perder o "hoje" de
        // clínicas atrás de UTC quando o servidor já virou a data. A decisão
        // final continua usando o relógio/local timezone de cada tenant.
        const scanStartDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        // Janela de varredura: maior offset de lembrete em uso é de dias, não meses.
        // Limitar a 10 dias evita escanear toda a agenda futura (timeout em tenants
        // com agenda cheia) — agendamentos distantes entram na janela conforme se
        // aproximam, cobertos pela cadência de 5 minutos do cron.
        const windowEnd = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        const { data: appointments, error: fetchErr } = await supabase
            .from("appointments")
            .select(`
                id, tenant_id, date, start_time, status, created_at, booked_by,
                patients(phone, full_name, preferred_locale, email),
                doctors(full_name),
                locations(id, name, address, google_maps_url, latitude, longitude),
                appointment_types(name)
            `)
            .or("date.gte." + scanStartDate + ",created_at.gte." + yesterday)
            .lte("date", windowEnd)
            .in("status", ["scheduled", "confirmed"])
            .order("date", { ascending: true });

        if (fetchErr) throw fetchErr;
        if (!appointments?.length) {
            return new Response(JSON.stringify({ scheduled: 0, count: 0 }), { headers: corsHeaders });
        }

        // 2. Buscar configurações dos tenants
        const tenantIds = [...new Set(appointments.map((a: any) => a.tenant_id))];
        const { data: tenants } = await supabase
            .from("tenants")
            .select("id, name, slug, bot_config, timezone, time_format")
            .in("id", tenantIds);

        const tenantConfigMap: Record<string, any> = Object.fromEntries(
            (tenants ?? []).map((t: any) => [t.id, {
                bot_config: t.bot_config ?? {},
                name:       t.name,
                slug:       t.slug,
                timezone:   t.timezone || "America/Sao_Paulo",
                time_format: t.time_format || null,
            }])
        );

        // 3. ── NOVO: Buscar preferências de canal dos pacientes ────────────────
        const patientPhones: string[] = [
            ...new Set(
                appointments
                    .map((a: any) => (Array.isArray(a.patients) ? a.patients[0] : a.patients)?.phone)
                    .filter(Boolean) as string[]
            )
        ];

        const channelMap: Record<string, ChannelInfo[]> = {};

        if (patientPhones.length > 0) {
            // 3a. Preferências explícitas salvas
            const { data: prefs } = await supabase
                .from("patient_channel_preferences")
                .select("patient_phone, preferred_channel, instagram_user_id, facebook_user_id, sms_phone, whatsapp_phone, email")
                .in("patient_phone", patientPhones);

            for (const pref of prefs ?? []) {
                const channels = (pref.preferred_channel || "whatsapp").split(",");
                const list: ChannelInfo[] = [];

                for (const ch of channels) {
                    let recipientId = pref.whatsapp_phone ?? pref.patient_phone;
                    if (ch === "instagram") recipientId = pref.instagram_user_id ?? pref.patient_phone;
                    if (ch === "facebook")  recipientId = pref.facebook_user_id  ?? pref.patient_phone;
                    if (ch === "sms" || ch === "mms")       recipientId = pref.sms_phone         ?? pref.patient_phone;
                    if (ch === "email") {
                        const apt = appointments.find((a: any) => (Array.isArray(a.patients) ? a.patients[0] : a.patients)?.phone === pref.patient_phone);
                        const patientEmail = (Array.isArray(apt?.patients) ? apt?.patients[0] : apt?.patients)?.email;
                        recipientId = pref.email ?? patientEmail ?? "";
                    }
                    
                    list.push({
                        channel:     ch as ChannelInfo["channel"],
                        recipientId,
                    });
                }
                channelMap[pref.patient_phone] = list;
            }

            // 3b. Auto-detect para pacientes sem preferência salva
            const phonesMissing = patientPhones.filter((p) => !channelMap[p]);
            if (phonesMissing.length > 0) {
                const { data: sessions } = await supabase
                    .from("conversation_sessions")
                    .select("patient_phone, channel, platform_user_id, updated_at")
                    .in("patient_phone", phonesMissing)
                    .order("updated_at", { ascending: false });

                const seenPhones = new Set<string>();
                for (const s of sessions ?? []) {
                    if (seenPhones.has(s.patient_phone)) continue;
                    seenPhones.add(s.patient_phone);
                    // E-6 (2026-08-02): Live Chat nunca teve canal de notificação
                    // próprio — o "fallback para whatsapp" antigo mandava o
                    // lembrete para o telefone SINTÉTICO da sessão
                    // (livechat-<uuid>), que não existe, e o lembrete morria
                    // silenciosamente. Deixar SEM entrada aqui: resolveEligibleChannels
                    // (channelResolver.ts) cai automaticamente para o e-mail
                    // cadastrado quando não sobra nenhuma preferência viável —
                    // a mesma correção usada para Instagram/Facebook.
                    if (s.channel === "livechat") continue;
                    const ch = s.channel || "whatsapp";
                    const recipientId = (ch === "instagram" || ch === "facebook")
                        ? (s.platform_user_id ?? s.patient_phone)
                        : s.patient_phone;
                    channelMap[s.patient_phone] = [{
                        channel:     ch as ChannelInfo["channel"],
                        recipientId,
                    }];
                }
            }
        }
        // ─────────────────────────────────────────────────────────────────────

        let enqueuedCount = 0;

        for (const appt of appointments) {
            const patientData = Array.isArray(appt.patients) ? appt.patients[0] : appt.patients;
            if (!patientData?.phone) continue;

            const tenantConfig  = tenantConfigMap[appt.tenant_id] ?? { bot_config: {}, name: "Clínica", timezone: "America/Sao_Paulo", time_format: null, slug: null };
            const { bot_config: botConfig, name: clinicName, timezone } = tenantConfig;

            if (!botConfig.no_show_prevention) continue;

            // Normalizar start_time: PostgreSQL retorna "HH:MM:SS", precisamos de "HH:MM:SS"
            // Evitar duplicar os segundos se já estiverem presentes
            const startTimeSec  = appt.start_time.length <= 5
                ? `${appt.start_time}:00`   // "HH:MM"    → "HH:MM:00"
                : appt.start_time;           // "HH:MM:SS" → sem alteração

            const apptRefDate   = new Date(`${appt.date}T${startTimeSec}Z`);
            const utcOffset     = getUTCOffsetString(timezone, apptRefDate);
            const apptTimestamp = new Date(`${appt.date}T${startTimeSec}${utcOffset}`).getTime();

            const doctorData    = Array.isArray(appt.doctors)           ? appt.doctors[0]           : appt.doctors;
            const locationData  = Array.isArray(appt.locations)         ? appt.locations[0]         : appt.locations;
            const typeData      = Array.isArray(appt.appointment_types) ? appt.appointment_types[0] : appt.appointment_types;

            const doctorName    = doctorData?.full_name || "Especialista";
            const locationName  = locationData?.name    || "Clínica";
            const addressText   = locationData?.address || "";
            const procedureName = typeData?.name        || "Consulta";

            let locationLink = locationData?.google_maps_url || "";
            if (!locationLink && addressText) {
                locationLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`;
            }

            const patientLocale = normalizeLocale(patientData.preferred_locale || botConfig.notification_locale || "pt");
            const dateFormatted = formatReminderDate(appt.date, patientLocale);
            const timeShort     = formatReminderTime(appt.start_time, tenantConfig.time_format, patientLocale);
            
            const customAppUrl  = botConfig.app_url;
            const appUrlEnv     = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL") || "https://mediflow-traffio.com";
            const publicUrl     = customAppUrl || appUrlEnv;

            const vars = {
                patient_name:      patientData.full_name || "Paciente",
                date:              dateFormatted,
                time:              timeShort,
                doctor_name:       doctorName,
                procedure_name:    procedureName,
                location_name:     locationName,
                location_link:     locationLink,
                clinic_name:       clinicName,
                waiting_room_link: publicUrl + "/checkin?apt=" + appt.id + (locationData?.id ? "&loc=" + locationData.id : ""),
                checkin_link:      publicUrl + "/checkin?apt=" + appt.id + (locationData?.id ? "&loc=" + locationData.id : ""),
                locale:            patientLocale,
            };

            // Canais preferidos do paciente ∩ Matriz de Canais do tenant, com
            // fallback para o canal padrão do tenant (bot_config.default_notification_channel)
            // quando o paciente não tem preferência elegível. Sem canal elegível
            // nem sequer no padrão → lembretes NÃO são enfileirados (nunca cai
            // silenciosamente para WhatsApp com o canal desligado na matriz).
            const preferredChannels: ChannelInfo[] = channelMap[patientData.phone] ?? [];
            const channelMatrix = (botConfig.channel_automations ?? {}) as Record<string, any>;
            const channelsInfo = resolveEligibleChannels({
                preferredChannels,
                matrix:       channelMatrix,
                automationKey: "no_show",
                botConfig,
                patientPhone: patientData.phone,
                patientEmail: patientData.email,
            });

            if (channelsInfo.length === 0) {
                console.log(`[schedule-reminders] Appt ${appt.id}: nenhum canal elegível (preferência × matriz) — lembretes não enfileirados`);
                continue;
            }

            const queueBatch: any[] = [];

            if (botConfig.custom_reminders && Array.isArray(botConfig.custom_reminders)) {
                // Dynamic custom reminders scheduled via the new model
                botConfig.custom_reminders.forEach((r: any) => {
                    if (!r.enabled) return;

                    const offsetMinutes = r.offset_minutes;
                    let targetTime = apptTimestamp + (offsetMinutes * 60 * 1000);
                    let type = `reminder_custom_${offsetMinutes}`;

                    if (!isReminderTargetStillEligible(targetTime, now.getTime())) return;

                    const scheduledTime = getSafeScheduledTime(new Date(targetTime), type, timezone, {
                        anchoredToAppointment: isAppointmentAnchoredOffset(offsetMinutes),
                    });

                    // Cada offset custom gera um template_key único para não colidir
                    // no índice (tenant_id, patient_phone, template_key, reference_id).
                    // Offsets exatos dos templates legado mantêm a chave legada.
                    let templateKey = `appointment_reminder_custom_${Math.abs(offsetMinutes)}m`;
                    if (offsetMinutes === -2880) templateKey = "appointment_reminder_48h";
                    else if (offsetMinutes === -1440) templateKey = "appointment_reminder_24h";
                    else if (offsetMinutes === -120)  templateKey = "appointment_reminder_2h";
                    else if (offsetMinutes === -15)   templateKey = "appointment_reminder_15m";

                    for (const channelInfo of channelsInfo) {
                        // Vídeos de lembrete: apenas para WhatsApp
                        let media_url = null;
                        let media_type = null;
                        if (
                            channelInfo.channel === "whatsapp" &&
                            botConfig.reminder_videos_enabled &&
                            r.videoUrl
                        ) {
                            media_url = r.videoUrl;
                            media_type = "video";
                        }

                        let override_message = null;
                        if (r.caption) {
                            let captionText = "";
                            if (typeof r.caption === "string") {
                                captionText = r.caption;
                            } else if (r.caption && typeof r.caption === "object") {
                                captionText = r.caption[patientLocale] || r.caption["pt"] || r.caption["en"] || r.caption["es"] || "";
                            }
                            override_message = renderCustomCaption(captionText, vars);
                        }

                        queueBatch.push({
                            tenant_id:            appt.tenant_id,
                            patient_phone:        patientData.phone,
                            message_type:         type,
                            template_key:         templateKey,
                            template_vars:        { ...vars, override_message },
                            scheduled_at:         scheduledTime,
                            reference_id:         appt.id,
                            reference_type:       "appointment",
                            media_url,
                            media_type,
                            is_edited:            !!override_message,
                            status:               "pending",
                            notification_channel: channelInfo.channel,
                            channel_recipient_id: channelInfo.recipientId,
                        });
                    }
                });
            } else {
                // Fallback to legacy scheduling logic if custom_reminders is not present
                const addMessage = (type: string, targetAt: number, stageKey?: string) => {
                    if (!isReminderTargetStillEligible(targetAt, now.getTime())) return;

                    // Offset real derivado do próprio alvo (negativo = antes da
                    // consulta): o legado "2h" é ancorado; "24h"/"48h" não são.
                    const offsetMinutes = Math.round((targetAt - apptTimestamp) / 60000);
                    const scheduledTime = getSafeScheduledTime(new Date(targetAt), type, timezone, {
                        anchoredToAppointment: isAppointmentAnchoredOffset(offsetMinutes),
                    });

                    for (const channelInfo of channelsInfo) {
                        // Vídeos de lembrete: apenas para WhatsApp
                        let media_url  = null;
                        let media_type = null;
                        if (
                            channelInfo.channel === "whatsapp" &&
                            botConfig.reminder_videos_enabled &&
                            stageKey &&
                            botConfig.reminder_videos?.[stageKey]
                        ) {
                            media_url  = botConfig.reminder_videos[stageKey];
                            media_type = "video";
                        }

                        let override_message = null;
                        if (stageKey && botConfig.reminder_captions?.[stageKey]) {
                            const captionObj = botConfig.reminder_captions[stageKey];
                            if (typeof captionObj === "string") {
                                override_message = renderCustomCaption(captionObj, vars);
                            } else if (captionObj && typeof captionObj === "object") {
                                const msgTemplate = captionObj[patientLocale] || captionObj["pt"] || captionObj["en"] || captionObj["es"] || "";
                                override_message = renderCustomCaption(msgTemplate, vars);
                            }
                        }

                        queueBatch.push({
                            tenant_id:            appt.tenant_id,
                            patient_phone:        patientData.phone,
                            message_type:         type,
                            template_key:         type === "reminder_15m" ? "appointment_reminder_15m" : "appointment_" + type,
                            template_vars:        { ...vars, override_message },
                            scheduled_at:         scheduledTime,
                            reference_id:         appt.id,
                            reference_type:       "appointment",
                            media_url,
                            media_type,
                            is_edited:            !!override_message,
                            status:               "pending",
                            notification_channel: channelInfo.channel,
                            channel_recipient_id: channelInfo.recipientId,
                        });
                    }
                };

                if (botConfig.active_reminders?.["48h"] !== false) addMessage("reminder_48h", apptTimestamp - (48 * 60 * 60 * 1000), "48h");
                if (botConfig.active_reminders?.["24h"] !== false) addMessage("reminder_24h", apptTimestamp - (24 * 60 * 60 * 1000), "24h");
                if (botConfig.active_reminders?.["2h"]  !== false) addMessage("reminder_2h",  apptTimestamp - (2 * 60 * 60 * 1000),  "2h");

            }

            if (queueBatch.length > 0) {
                // outbound_enqueue_message_batch (pgmq): cada item passa pelo
                // mesmo dedup de sempre (mesmo índice único, agora como
                // UNIQUE constraint em outbound_reminder_registry) e vira uma
                // chamada pgmq.send() com o scheduled_at exato — a fila
                // pgmq cuida da entrega, sem reaper/claim escrito à mão.
                const { data: createdCount, error: rpcErr } = await supabase
                    .rpc("outbound_enqueue_message_batch", { p_items: queueBatch });

                if (rpcErr) {
                    console.error(`[schedule-reminders] Enqueue batch failed for Appt ${appt.id}:`, rpcErr.message);
                } else {
                    console.log(`[schedule-reminders] ${createdCount}/${queueBatch.length} reminders queued | Appt ${appt.id} | channels: ${channelsInfo.map(c => c.channel).join(", ")} | tz: ${timezone}`);
                    enqueuedCount += createdCount ?? 0;
                }
            }

            // ── LIMPEZA AUTO-CURÁVEL (Stale Queue & Anti-Duplicação) ───────────────
            // Remove quaisquer lembretes pendentes deste agendamento que NÃO constem
            // no lote válido recém-calculado (cobre alterações de configuração,
            // desativações e transição do modelo legado 'reminder_24h' para o novo 'reminder_custom_%').
            // outbound_cancel_stale_reminders opera LINHA POR LINHA (pgmq.delete de
            // um msg_id por vez, nunca um DELETE de tabela inteira) e nunca toca
            // lembrete com scheduled_at <= now() — era exatamente a falta desses
            // dois cuidados que apagava lembretes vencendo no minuto do envio.
            const validTypes = Array.from(new Set(queueBatch.map((item: any) => item.message_type)));
            const { error: cleanupErr } = await supabase.rpc("outbound_cancel_stale_reminders", {
                p_reference_id:   appt.id,
                p_reference_type: "appointment",
                p_valid_types:    validTypes,
            });
            if (cleanupErr) {
                console.error(`[schedule-reminders] Cleanup failed for Appt ${appt.id}:`, cleanupErr.message);
            }
        }

        // ── NPS BACKFILL: rede de segurança para agendamentos concluídos ─────────
        // O trigger Postgres é o mecanismo primário; este backfill cobre casos onde
        // o trigger falhou ou o agendamento foi concluído antes do trigger existir.
        const completedSince = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(); // últimas 25h

        const { data: completedAppts } = await supabase
            .from("appointments")
            .select(`
                id, tenant_id, patient_id,
                patients(phone, full_name, preferred_locale, email)
            `)
            .eq("status", "completed")
            .gte("completed_at", completedSince);

        for (const appt of completedAppts ?? []) {
            const patientData = Array.isArray(appt.patients) ? appt.patients[0] : appt.patients;
            if (!patientData?.phone) continue;

            const tenantInfo = tenantConfigMap[appt.tenant_id];
            if (!tenantInfo) continue;

            const { bot_config: botConfig, name: clinicName, timezone } = tenantInfo;
            const npsChannels = botConfig?.channel_automations ?? {};
            const npsEnabled = (
                npsChannels.whatsapp?.nps ||
                npsChannels.sms?.nps ||
                npsChannels.email?.nps
            );
            if (!npsEnabled) continue;

            const delayMinutes = botConfig?.nps_delay_minutes ?? 180;
            let targetTime = now.getTime() + delayMinutes * 60 * 1000;
            const scheduledTime = getSafeScheduledTime(new Date(targetTime), "nps", timezone);

            // Canais preferidos do paciente ∩ matriz do tenant (coluna NPS), com
            // fallback para o canal padrão do tenant. Sem canal elegível → NPS
            // não é enviado (nunca cai silenciosamente para WhatsApp).
            const channelsForPatient: ChannelInfo[] = channelMap[patientData.phone] ?? [];
            const eligibleNps = resolveEligibleChannels({
                preferredChannels: channelsForPatient,
                matrix:       npsChannels,
                automationKey: "nps",
                botConfig,
                patientPhone: patientData.phone,
                patientEmail: patientData.email,
            });

            const npsChannel = eligibleNps[0];
            if (!npsChannel) {
                console.log(`[schedule-reminders] NPS Appt ${appt.id}: nenhum canal elegível — não enviado`);
                continue;
            }

            const locale = (() => {
                const l = (botConfig?.notification_locale || patientData.preferred_locale || "pt").toLowerCase();
                if (l.startsWith("en")) return "en";
                if (l.startsWith("es")) return "es";
                return "pt";
            })();

            const { data: npsId, error: npsErr } = await supabase.rpc("outbound_enqueue_message", {
                p_tenant_id:            appt.tenant_id,
                p_patient_phone:        patientData.phone,
                p_message_type:         "nps_survey",
                p_template_key:         "nps_survey",
                p_template_vars: {
                    patient_name: patientData.full_name || "Paciente",
                    clinic_name:  clinicName,
                    locale,
                },
                p_scheduled_at:         scheduledTime,
                p_reference_id:         appt.id,
                p_reference_type:       "appointment",
                p_notification_channel: npsChannel.channel,
                p_channel_recipient_id: npsChannel.recipientId,
                p_is_edited:            false,
            });

            if (npsErr) {
                console.error(`[schedule-reminders] NPS backfill failed for Appt ${appt.id}:`, npsErr.message);
            } else if (npsId) {
                enqueuedCount++;
                console.log(`[schedule-reminders] NPS backfill | Appt ${appt.id} | ${npsChannel.channel}`);
            }
        }
        // ─────────────────────────────────────────────────────────────────────────

        return new Response(JSON.stringify({ scheduled: enqueuedCount, count: appointments.length }), {
            status:  200,
            headers: corsHeaders,
        });

    } catch (err: any) {
        console.error("[schedule-reminders] Critical Failure:", err.message);
        return new Response(JSON.stringify({ error: err.message }), {
            status:  500,
            headers: corsHeaders,
        });
    }
});
