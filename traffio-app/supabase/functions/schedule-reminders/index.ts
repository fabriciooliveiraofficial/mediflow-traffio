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

console.log("schedule-reminders v4.0 (multi-canal + multi-timezone) initialized");

function getUTCOffsetString(timezone: string, refDate: Date): string {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            timeZoneName: "shortOffset",
        }).formatToParts(refDate);
        const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
        const match = tzName.match(/GMT([+-]\d+(?::\d+)?)?/);
        if (!match || !match[1]) return "+00:00";
        const raw = match[1];
        const [hourPart, minPart = "00"] = raw.split(":");
        const sign = hourPart[0];
        const absHours = Math.abs(parseInt(hourPart, 10));
        return `${sign}${String(absHours).padStart(2, "0")}:${minPart.padStart(2, "0")}`;
    } catch {
        return "-03:00";
    }
}

function getLocalHour(date: Date, timezone: string): number {
    try {
        return parseInt(
            new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(date),
            10
        );
    } catch {
        return date.getUTCHours();
    }
}

function getSafeScheduledTime(target: Date, type: string, timezone: string): string {
    const localHour = getLocalHour(target, timezone);
    const isQuiet = localHour >= 22 || localHour < 8;
    if (!isQuiet) return target.toISOString();

    const localParts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(target);
    const localYear  = parseInt(localParts.find((p) => p.type === "year")!.value, 10);
    const localMonth = parseInt(localParts.find((p) => p.type === "month")!.value, 10) - 1;
    const localDay   = parseInt(localParts.find((p) => p.type === "day")!.value, 10);

    let targetHour = 8;
    let dayOffset  = 0;

    if (type.startsWith("reminder")) {
        targetHour = localHour < 8 ? 21 : 21;
        dayOffset  = localHour < 8 ? -1 : 0;
    } else {
        targetHour = 8;
        dayOffset  = localHour >= 22 ? 1 : 0;
    }

    const shiftedDate = new Date(Date.UTC(localYear, localMonth, localDay + dayOffset, targetHour, 0, 0));
    const offset = getUTCOffsetString(timezone, shiftedDate);
    const sign    = offset[0] === "-" ? 1 : -1;
    const [offH, offM] = offset.slice(1).split(":").map(Number);
    const offsetMs = sign * (offH * 60 + offM) * 60 * 1000;
    return new Date(shiftedDate.getTime() + offsetMs).toISOString();
}

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

interface ChannelInfo {
    channel:     "whatsapp" | "instagram" | "facebook" | "sms" | "email" | "mms";
    recipientId: string;   // phone/email para whatsapp/sms/email; IGSID/PSID para instagram/facebook
}

// ─── Handler principal ───────────────────────────────────────────────────────

serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase           = createClient(supabaseUrl, supabaseServiceKey);

    try {
        const now       = new Date();
        const today     = now.toISOString().split("T")[0];
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

        const { data: appointments, error: fetchErr } = await supabase
            .from("appointments")
            .select(`
                id, tenant_id, date, start_time, status, created_at, booked_by,
                patients(phone, full_name, preferred_locale),
                doctors(full_name),
                locations(name, address, google_maps_url, latitude, longitude),
                appointment_types(name)
            `)
            .or("date.gte." + today + ",created_at.gte." + yesterday)
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
            .select("id, name, bot_config, timezone")
            .in("id", tenantIds);

        const tenantConfigMap: Record<string, any> = Object.fromEntries(
            (tenants ?? []).map((t: any) => [t.id, {
                bot_config: t.bot_config ?? {},
                name:       t.name,
                timezone:   t.timezone || "America/Sao_Paulo",
            }])
        );

        // 3. ── NOVO: Buscar preferências de canal dos pacientes ────────────────
        const patientPhones = [
            ...new Set(
                appointments
                    .map((a: any) => (Array.isArray(a.patients) ? a.patients[0] : a.patients)?.phone)
                    .filter(Boolean)
            )
        ];

        const channelMap: Record<string, ChannelInfo[]> = {};

        if (patientPhones.length > 0) {
            // 3a. Preferências explícitas salvas
            const { data: prefs } = await supabase
                .from("patient_channel_preferences")
                .select("patient_phone, preferred_channel, instagram_user_id, facebook_user_id, sms_phone, whatsapp_phone")
                .in("patient_phone", patientPhones);

            for (const pref of prefs ?? []) {
                const channels = (pref.preferred_channel || "whatsapp").split(",");
                const list: ChannelInfo[] = [];

                for (const ch of channels) {
                    let recipientId = pref.whatsapp_phone ?? pref.patient_phone;
                    if (ch === "instagram") recipientId = pref.instagram_user_id ?? pref.patient_phone;
                    if (ch === "facebook")  recipientId = pref.facebook_user_id  ?? pref.patient_phone;
                    if (ch === "sms" || ch === "mms")       recipientId = pref.sms_phone         ?? pref.patient_phone;
                    
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
                    // livechat não tem canal de notificação — fallback para whatsapp
                    const ch = (s.channel === "livechat" || !s.channel) ? "whatsapp" : s.channel;
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

            const { bot_config: botConfig, name: clinicName, timezone } =
                tenantConfigMap[appt.tenant_id] ?? { bot_config: {}, name: "Clínica", timezone: "America/Sao_Paulo" };

            if (!botConfig.no_show_prevention && !botConfig.test_mode_15m) continue;

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

            const dateFormatted = appt.date.split("-").reverse().join("/");
            const timeShort     = appt.start_time.substring(0, 5);
            const publicUrl     = Deno.env.get("PUBLIC_APP_URL") || "https://" + appt.tenant_id + ".traffio.app";

            const vars = {
                patient_name:      patientData.full_name || "Paciente",
                date:              dateFormatted,
                time:              timeShort,
                doctor_name:       doctorName,
                procedure_name:    procedureName,
                location_name:     locationName,
                location_link:     locationLink,
                clinic_name:       clinicName,
                waiting_room_link: publicUrl + "/waiting-room?tenant=" + appt.tenant_id + "&apt=" + appt.id,
                checkin_link:      publicUrl + "/checkin?apt=" + appt.id,
            };

            // Canal preferido deste paciente (ou fallback whatsapp)
            const channelsInfo: ChannelInfo[] = channelMap[patientData.phone] ?? [{
                channel:     "whatsapp",
                recipientId: patientData.phone,
            }];

            const queueBatch: any[] = [];

            if (botConfig.custom_reminders && Array.isArray(botConfig.custom_reminders)) {
                // Dynamic custom reminders scheduled via the new model
                botConfig.custom_reminders.forEach((r: any) => {
                    if (!r.enabled) return;

                    const offsetMinutes = r.offset_minutes;
                    let targetTime = apptTimestamp + (offsetMinutes * 60 * 1000);
                    let type = `reminder_custom_${offsetMinutes}`;

                    // Match legacy test mode behavior for 15m offset
                    if (botConfig.test_mode_15m && offsetMinutes === -15) {
                        targetTime = apptTimestamp - (5 * 60 * 1000);
                    }

                    if (targetTime < now.getTime()) return;

                    const scheduledTime = getSafeScheduledTime(new Date(targetTime), type, timezone);

                    let templateKey = "appointment_reminder_2h";
                    if (offsetMinutes === -2880) templateKey = "appointment_reminder_48h";
                    else if (offsetMinutes === -1440) templateKey = "appointment_reminder_24h";
                    else if (offsetMinutes === -120) templateKey = "appointment_reminder_2h";
                    else if (offsetMinutes === -15) templateKey = "appointment_reminder_15m";

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
                                let locale = (patientData?.preferred_locale || "pt").toLowerCase();
                                if (locale.startsWith("en")) locale = "en";
                                else if (locale.startsWith("es")) locale = "es";
                                else locale = "pt";
                                captionText = r.caption[locale] || r.caption["pt"] || r.caption["en"] || "";
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
                    if (targetAt < now.getTime()) return;

                    const scheduledTime = getSafeScheduledTime(new Date(targetAt), type, timezone);

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
                                let locale = (patientData?.preferred_locale || "pt").toLowerCase();
                                if (locale.startsWith("en")) locale = "en";
                                else if (locale.startsWith("es")) locale = "es";
                                else locale = "pt";
                                const msgTemplate = captionObj[locale] || captionObj["pt"] || captionObj["en"] || "";
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
                if (botConfig.test_mode_15m && botConfig.active_reminders?.["15m"] !== false) {
                    addMessage("reminder_15m", apptTimestamp - (5 * 60 * 1000), "15m");
                }
            }

            if (queueBatch.length > 0) {
                const { error: upsertErr } = await supabase
                    .from("outbound_message_queue")
                    .upsert(queueBatch, {
                        onConflict:       "tenant_id,patient_phone,message_type,reference_id,notification_channel",
                        ignoreDuplicates: true,
                    });

                if (upsertErr) {
                    console.error(`[schedule-reminders] Upsert failed for Appt ${appt.id}:`, upsertErr.message);
                } else {
                    console.log(`[schedule-reminders] ${queueBatch.length} reminders queued | Appt ${appt.id} | channels: ${channelsInfo.map(c => c.channel).join(", ")} | tz: ${timezone}`);
                    enqueuedCount += queueBatch.length;
                }
            }
        }

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
