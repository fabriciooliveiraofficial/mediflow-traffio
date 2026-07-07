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

function getLocalTime(date: Date, timezone: string): { hour: number; minute: number } {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            hour:     "numeric",
            minute:   "2-digit",
            hour12:   false,
        }).formatToParts(date);
        return {
            hour:   parseInt(parts.find((p) => p.type === "hour")!.value,   10),
            minute: parseInt(parts.find((p) => p.type === "minute")!.value, 10),
        };
    } catch {
        return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
    }
}

function getSafeScheduledTime(target: Date, type: string, timezone: string): string {
    const { hour: localHour, minute: localMinute } = getLocalTime(target, timezone);
    const isQuiet = localHour >= 22 || localHour < 8;
    if (!isQuiet) return target.toISOString();

    const localParts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(target);
    const localYear  = parseInt(localParts.find((p) => p.type === "year")!.value, 10);
    const localMonth = parseInt(localParts.find((p) => p.type === "month")!.value, 10) - 1;
    const localDay   = parseInt(localParts.find((p) => p.type === "day")!.value, 10);

    let targetHour   = 8;
    let targetMinute = 0;
    let dayOffset    = 0;

    if (type.startsWith("reminder")) {
        if (localHour < 8) {
            // Distribuição proporcional: preserva o espaçamento relativo entre lembretes.
            // minutesBefore8 = distância (min) entre o horário do lembrete e o início da janela segura (8h).
            // Subtraímos essa distância de 21:00 da véspera → spread natural na tarde/noite anterior.
            const minutesBefore8    = (8 * 60) - (localHour * 60 + localMinute);
            const remappedTotalMins = Math.max(8 * 60, 21 * 60 - minutesBefore8);
            targetHour   = Math.floor(remappedTotalMins / 60);
            targetMinute = remappedTotalMins % 60;
            dayOffset    = -1;
        } else {
            // Lembrete cai após 22h: empurra para 21h do mesmo dia (logo antes do silêncio).
            targetHour   = 21;
            targetMinute = 0;
            dayOffset    = 0;
        }
    } else {
        targetHour   = 8;
        targetMinute = 0;
        dayOffset    = localHour >= 22 ? 1 : 0;
    }

    const shiftedDate = new Date(Date.UTC(localYear, localMonth, localDay + dayOffset, targetHour, targetMinute, 0));
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

// Interseção: preferência do paciente × Matriz de Canais do tenant.
// - Canais fora da matriz (instagram/facebook) seguem a preferência do paciente;
// - Canais presentes na matriz exigem a automação explicitamente habilitada;
// - E-mail sem endereço válido é descartado.
// NUNCA faz fallback silencioso para WhatsApp: sem canal elegível → não envia.
function filterChannelsByMatrix(
    channels: ChannelInfo[],
    matrix: Record<string, any>,
    automationKey: string,
): ChannelInfo[] {
    return channels.filter((c) => {
        if (c.channel === "email" && !(c.recipientId || "").includes("@")) return false;
        const row = matrix?.[c.channel];
        if (row === undefined) return true;
        return row?.[automationKey] === true;
    });
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
            .or("date.gte." + today + ",created_at.gte." + yesterday)
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
            .select("id, name, slug, bot_config, timezone")
            .in("id", tenantIds);

        const tenantConfigMap: Record<string, any> = Object.fromEntries(
            (tenants ?? []).map((t: any) => [t.id, {
                bot_config: t.bot_config ?? {},
                name:       t.name,
                slug:       t.slug,
                timezone:   t.timezone || "America/Sao_Paulo",
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

            const tenantConfig  = tenantConfigMap[appt.tenant_id] ?? { bot_config: {}, name: "Clínica", timezone: "America/Sao_Paulo", slug: null };
            const { bot_config: botConfig, name: clinicName, timezone } = tenantConfig;

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
            
            const customAppUrl  = botConfig.app_url;
            const appUrlEnv     = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL") || "https://app.traffio.com.br";
            const fallbackUrl   = tenantConfig?.slug ? "https://" + tenantConfig.slug + ".com" : appUrlEnv;
            const publicUrl     = customAppUrl || fallbackUrl;

            // Fonte de verdade do idioma: bot_config.notification_locale (definido pelo
            // tenant na página Inteligência). Não há cadastro de idioma por paciente —
            // o fallback em preferred_locale só cobre tenants que nunca configuraram isso.
            const patientLocale = (() => {
                const l = (botConfig.notification_locale || patientData.preferred_locale || "pt").toLowerCase();
                if (l.startsWith("en")) return "en";
                if (l.startsWith("es")) return "es";
                return "pt";
            })();

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

            // Canais preferidos do paciente ∩ Matriz de Canais do tenant.
            // Sem canal elegível → lembretes NÃO são enfileirados (nunca cair
            // silenciosamente para WhatsApp com o canal desligado na matriz).
            const preferredChannels: ChannelInfo[] = channelMap[patientData.phone] ?? [{
                channel:     "whatsapp",
                recipientId: patientData.phone,
            }];
            const channelMatrix = (botConfig.channel_automations ?? {}) as Record<string, any>;
            let channelsInfo = filterChannelsByMatrix(preferredChannels, channelMatrix, "no_show");

            // Matriz só-e-mail + paciente sem preferência salva: usar o e-mail do cadastro
            if (
                channelsInfo.length === 0 &&
                channelMatrix.email?.no_show === true &&
                (patientData.email || "").includes("@")
            ) {
                channelsInfo = [{ channel: "email", recipientId: patientData.email }];
            }

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

                    // Match legacy test mode behavior for 15m offset
                    if (botConfig.test_mode_15m && offsetMinutes === -15) {
                        targetTime = apptTimestamp - (5 * 60 * 1000);
                    }

                    if (targetTime < now.getTime()) return;

                    const scheduledTime = getSafeScheduledTime(new Date(targetTime), type, timezone);

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
                // CRITICAL: onConflict must match the actual unique index:
                // idx_outbound_queue_unique_msg ON (tenant_id, patient_phone, template_key, reference_id)
                const { error: upsertErr } = await supabase
                    .from("outbound_message_queue")
                    .upsert(queueBatch, {
                        onConflict:       "tenant_id,patient_phone,template_key,reference_id",
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

            // Canais preferidos do paciente ∩ matriz do tenant (coluna NPS).
            // Sem canal elegível → NPS não é enviado (sem fallback para WhatsApp).
            const channelsForPatient: ChannelInfo[] = channelMap[patientData.phone] ?? [{
                channel:     "whatsapp",
                recipientId: patientData.phone,
            }];

            const eligibleNps = filterChannelsByMatrix(channelsForPatient, npsChannels, "nps");

            let npsChannel = eligibleNps[0];
            // Matriz só-e-mail + paciente sem preferência salva: e-mail do cadastro
            if (!npsChannel && npsChannels.email?.nps === true && (patientData.email || "").includes("@")) {
                npsChannel = { channel: "email", recipientId: patientData.email };
            }
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

            const { error: npsErr } = await supabase
                .from("outbound_message_queue")
                .upsert({
                    tenant_id:            appt.tenant_id,
                    patient_phone:        patientData.phone,
                    message_type:         "nps_survey",
                    template_key:         "nps_survey",
                    template_vars:        {
                        patient_name: patientData.full_name || "Paciente",
                        clinic_name:  clinicName,
                        locale,
                    },
                    scheduled_at:         scheduledTime,
                    reference_id:         appt.id,
                    reference_type:       "appointment",
                    status:               "pending",
                    notification_channel: npsChannel.channel,
                    channel_recipient_id: npsChannel.recipientId,
                    is_edited:            false,
                }, {
                    onConflict:       "tenant_id,patient_phone,template_key,reference_id",
                    ignoreDuplicates: true,
                });

            if (npsErr) {
                console.error(`[schedule-reminders] NPS backfill failed for Appt ${appt.id}:`, npsErr.message);
            } else {
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
