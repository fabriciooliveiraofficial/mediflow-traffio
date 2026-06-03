/**
 * schedule-reminders — Edge Function (Supabase Cron)
 * Final Production Version v3.0 — Multi-timezone support
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

console.log("schedule-reminders v3.0 (multi-timezone) initialized");

/**
 * Returns the UTC offset string (e.g. "-03:00", "+05:30") for an IANA timezone
 * at the given date, accounting for DST transitions.
 */
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

/**
 * Returns the local hour (0–23) in the given IANA timezone.
 */
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

/**
 * Shifts delivery time to avoid the quiet hours (22:00–08:00) in the tenant's local timezone.
 * Replaces the previous hardcoded Brazil-only version.
 */
function getSafeScheduledTime(target: Date, type: string, timezone: string): string {
    const localHour = getLocalHour(target, timezone);
    const isQuiet = localHour >= 22 || localHour < 8;
    if (!isQuiet) return target.toISOString();

    // Extract local date parts in tenant timezone
    const localParts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(target);
    const localYear  = parseInt(localParts.find((p) => p.type === "year")!.value, 10);
    const localMonth = parseInt(localParts.find((p) => p.type === "month")!.value, 10) - 1;
    const localDay   = parseInt(localParts.find((p) => p.type === "day")!.value, 10);

    let targetHour = 8;
    let dayOffset  = 0;

    if (type.startsWith("reminder")) {
        if (localHour < 8) {
            // Early morning: send previous evening at 21:00
            targetHour = 21;
            dayOffset  = -1;
        } else {
            // Late night: send same-day at 21:00
            targetHour = 21;
        }
    } else {
        if (localHour >= 22) {
            // Late night confirmation: shift to next-day 08:00
            targetHour = 8;
            dayOffset  = 1;
        } else {
            // Early morning confirmation: shift to 08:00 same day
            targetHour = 8;
        }
    }

    // Build a UTC Date that represents targetHour:00 local time on the shifted day.
    // We construct a candidate ISO string and adjust using the real UTC offset at that instant.
    const shiftedDate = new Date(Date.UTC(localYear, localMonth, localDay + dayOffset, targetHour, 0, 0));
    const offset = getUTCOffsetString(timezone, shiftedDate);
    // offset is e.g. "-03:00"; parse hours+minutes and apply
    const sign    = offset[0] === "-" ? 1 : -1; // invert: if local is UTC-3, add 3h to get UTC
    const [offH, offM] = offset.slice(1).split(":").map(Number);
    const offsetMs = sign * (offH * 60 + offM) * 60 * 1000;
    return new Date(shiftedDate.getTime() + offsetMs).toISOString();
}

/** Replaces variables in string with patient/appointment data */
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

serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase           = createClient(supabaseUrl, supabaseServiceKey);

    try {
        const now     = new Date();
        const today   = now.toISOString().split("T")[0];
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

        // 1. Fetch appointments with procedural and location details
        const { data: appointments, error: fetchErr } = await supabase
            .from("appointments")
            .select(`
                id, tenant_id, date, start_time, status, created_at, booked_by,
                patients(phone, full_name),
                doctors(full_name),
                locations(name, address, google_maps_url, latitude, longitude),
                appointment_types(name)
            `)
            .or("date.gte." + today + ",created_at.gte." + yesterday)
            .in("status", ["scheduled", "confirmed"])
            .order("date", { ascending: true });

        if (fetchErr) throw fetchErr;
        if (!appointments || appointments.length === 0) {
            return new Response(JSON.stringify({ scheduled: 0, count: 0 }), { headers: corsHeaders });
        }

        // 2. Fetch configurations — now includes timezone
        const tenantIds = [...new Set(appointments.map((a: any) => a.tenant_id))];
        const { data: tenants } = await supabase
            .from("tenants")
            .select("id, name, bot_config, timezone")
            .in("id", tenantIds);

        const tenantConfigMap: Record<string, any> = Object.fromEntries(
            (tenants ?? []).map((t: any) => [
                t.id,
                {
                    bot_config: t.bot_config ?? {},
                    name:       t.name,
                    timezone:   t.timezone || "America/Sao_Paulo",
                },
            ])
        );

        let enqueuedCount = 0;

        for (const appt of appointments) {
            const patientData = Array.isArray(appt.patients) ? appt.patients[0] : appt.patients;
            if (!patientData?.phone) continue;

            const { bot_config: botConfig, name: clinicName, timezone } =
                tenantConfigMap[appt.tenant_id] ?? { bot_config: {}, name: "Clínica", timezone: "America/Sao_Paulo" };

            if (!botConfig.no_show_prevention && !botConfig.test_mode_15m) continue;

            // Build appointment UTC timestamp using the tenant's actual timezone offset
            const apptRefDate = new Date(`${appt.date}T${appt.start_time}Z`);
            const utcOffset   = getUTCOffsetString(timezone, apptRefDate);
            const apptTimestamp = new Date(`${appt.date}T${appt.start_time}:00${utcOffset}`).getTime();

            const doctorData   = Array.isArray(appt.doctors)           ? appt.doctors[0]           : appt.doctors;
            const locationData = Array.isArray(appt.locations)         ? appt.locations[0]         : appt.locations;
            const typeData     = Array.isArray(appt.appointment_types) ? appt.appointment_types[0] : appt.appointment_types;

            const doctorName    = doctorData?.full_name   || "Especialista";
            const locationName  = locationData?.name      || "Clínica";
            const addressText   = locationData?.address   || "";
            const procedureName = typeData?.name          || "Consulta";

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

            const queueBatch: any[] = [];

            const addMessage = (type: string, targetAt: number, stageKey?: string) => {
                if (targetAt < now.getTime()) return;

                // Use tenant's timezone for quiet-hours check
                const scheduledTime = getSafeScheduledTime(new Date(targetAt), type, timezone);

                let media_url  = null;
                let media_type = null;
                const finalStageKey = stageKey ?? null;

                if (botConfig.reminder_videos_enabled && finalStageKey && botConfig.reminder_videos?.[finalStageKey]) {
                    media_url  = botConfig.reminder_videos[finalStageKey];
                    media_type = "video";
                }

                let override_message = null;
                if (finalStageKey && botConfig.reminder_captions?.[finalStageKey]) {
                    override_message = renderCustomCaption(botConfig.reminder_captions[finalStageKey], vars);
                }

                queueBatch.push({
                    tenant_id:      appt.tenant_id,
                    patient_phone:  patientData.phone,
                    message_type:   type,
                    template_key:   type === "reminder_15m" ? "appointment_reminder_15m" : "appointment_" + type,
                    template_vars:  { ...vars, override_message },
                    scheduled_at:   scheduledTime,
                    reference_id:   appt.id,
                    reference_type: "appointment",
                    media_url,
                    media_type,
                    is_edited:      !!override_message,
                    status:         "pending",
                });
            };

            if (botConfig.active_reminders?.["48h"] !== false) {
                addMessage("reminder_48h", apptTimestamp - (48 * 60 * 60 * 1000), "48h");
            }
            if (botConfig.active_reminders?.["24h"] !== false) {
                addMessage("reminder_24h", apptTimestamp - (24 * 60 * 60 * 1000), "24h");
            }
            if (botConfig.active_reminders?.["2h"] !== false) {
                addMessage("reminder_2h",  apptTimestamp - (2 * 60 * 60 * 1000),  "2h");
            }
            if (botConfig.test_mode_15m && botConfig.active_reminders?.["15m"] !== false) {
                addMessage("reminder_15m", apptTimestamp - (5 * 60 * 1000), "15m");
            }

            if (queueBatch.length > 0) {
                const { error: upsertErr } = await supabase
                    .from("outbound_message_queue")
                    .upsert(queueBatch, {
                        onConflict:      "tenant_id,patient_phone,template_key,reference_id",
                        ignoreDuplicates: true,
                    });

                if (upsertErr) {
                    console.error(`[schedule-reminders] Upsert failed for Appt ${appt.id}:`, upsertErr.message);
                } else {
                    console.log(`[schedule-reminders] ${queueBatch.length} reminders queued for Appt ${appt.id} (tz: ${timezone})`);
                    enqueuedCount += queueBatch.length;
                }
            }
        }

        return new Response(JSON.stringify({ scheduled: enqueuedCount, count: appointments.length }), {
            status:  200,
            headers: corsHeaders,
        });

    } catch (err: any) {
        console.error("Critical Failure:", err.message);
        return new Response(JSON.stringify({ error: err.message }), {
            status:  500,
            headers: corsHeaders,
        });
    }
});
