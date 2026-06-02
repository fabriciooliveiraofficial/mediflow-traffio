/**
 * schedule-reminders — Edge Function (Supabase Cron)
 * Final Production Version v2.6
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

console.log("schedule-reminders v2.6 initialized");

/**
 * Shifts delivery time to avoid 22:00–08:00 (Brazil Time).
 */
function getSafeScheduledTime(target: Date, type: string): string {
    const brDate = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false
    }).format(target);
    const hour = parseInt(brDate, 10);

    const isQuiet = hour >= 22 || hour < 8;
    if (!isQuiet) return target.toISOString();

    const shifted = new Date(target);
    if (type.startsWith('reminder')) {
        // Pre-appointment reminders: Shift to 21:00 the PREVIOUS evening
        if (hour < 8) {
            shifted.setDate(shifted.getDate() - 1);
        }
        shifted.setHours(21, 0, 0, 0); 
    } else {
        // Immediate confirmations: Shift to 08:00 the NEXT available morning
        if (hour >= 22) {
            shifted.setDate(shifted.getDate() + 1);
        }
        shifted.setHours(8, 0, 0, 0);
    }

    // Convert back to UTC (Brazil is usually UTC-3)
    const tzOffset = 3; 
    shifted.setHours(shifted.getHours() + tzOffset);
    return shifted.toISOString();
}

/** Replaces variables in string with patient/appointment data */
function renderCustomCaption(template: string, vars: any): string {
    if (!template) return "";
    let rendered = template;
    const map: Record<string, string> = {
        '{{nome_paciente}}':       vars.patient_name || "",
        '{{data_agendamento}}':    vars.date || "",
        '{{horario_agendamento}}': vars.time || "",
        '{{slot_agendado}}':       vars.time || "",
        '{{nome_doutor}}':         vars.doctor_name || "",
        '{{nome_do_profissional}}': vars.doctor_name || "",
        '{{nome_procedimento}}':   vars.procedure_name || "",
        '{{nome_local}}':          vars.location_name || "",
        '{{link_endereco}}':       vars.location_link || "",
        '{{link_sala_espera}}':    vars.waiting_room_link || "",
        '{{sala_de_espera}}':      vars.waiting_room_link || "",
        '{{link_checkin}}':        vars.checkin_link || "",
        '{{nome_clinica}}':        vars.clinic_name || "Nossa Clínica"
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
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // 1. Fetch appointments with procedural and location details
    const { data: appointments, error: fetchErr } = await supabase
        .from('appointments')
        .select(`
            id, tenant_id, date, start_time, status, created_at, booked_by,
            patients(phone, full_name),
            doctors(full_name),
            locations(name, address, google_maps_url, latitude, longitude),
            appointment_types(name)
        `)
        .or('date.gte.' + today + ',created_at.gte.' + yesterday)
        .in('status', ['scheduled', 'confirmed'])
        .order('date', { ascending: true });

    if (fetchErr) throw fetchErr;
    if (!appointments || appointments.length === 0) {
        return new Response(JSON.stringify({ scheduled: 0, count: 0 }), { headers: corsHeaders });
    }

    // 2. Fetch configurations
    const tenantIds = [...new Set(appointments.map((a: any) => a.tenant_id))];
    const { data: tenants } = await supabase
        .from('tenants')
        .select('id, name, bot_config')
        .in('id', tenantIds);
    const tenantConfigMap: Record<string, any> = Object.fromEntries(
        (tenants ?? []).map((t: any) => [t.id, { bot_config: t.bot_config ?? {}, name: t.name }])
    );

    let enqueuedCount = 0;

    for (const appt of appointments) {
        const patientData = Array.isArray(appt.patients) ? appt.patients[0] : appt.patients;
        if (!patientData?.phone) continue;

        const { bot_config: botConfig, name: clinicName } = tenantConfigMap[appt.tenant_id] ?? { bot_config: {}, name: "Clínica" };
        if (!botConfig.no_show_prevention && !botConfig.test_mode_15m) continue;

        const apptTimestamp = new Date(appt.date + 'T' + appt.start_time + '-03:00').getTime();

        const doctorData = Array.isArray(appt.doctors) ? appt.doctors[0] : appt.doctors;
        const doctorName = doctorData?.full_name || 'Especialista';

        const locationData = Array.isArray(appt.locations) ? appt.locations[0] : appt.locations;
        const locationName = locationData?.name || 'Clínica';
        const addressText = locationData?.address || '';
        
        // Generate Location Link
        let locationLink = locationData?.google_maps_url || "";
        if (!locationLink && addressText) {
            locationLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`;
        }

        const typeData = Array.isArray(appt.appointment_types) ? appt.appointment_types[0] : appt.appointment_types;
        const procedureName = typeData?.name || 'Consulta';

        const dateFormatted = appt.date.split('-').reverse().join('/');
        const timeShort     = appt.start_time.substring(0, 5);
        const publicUrl    = Deno.env.get("PUBLIC_APP_URL") || "https://" + appt.tenant_id + ".traffio.app";

        const vars = {
            patient_name: patientData.full_name || 'Paciente',
            date: dateFormatted,
            time: timeShort,
            doctor_name: doctorName,
            procedure_name: procedureName,
            location_name: locationName,
            location_link: locationLink,
            clinic_name: clinicName,
            waiting_room_link: publicUrl + "/waiting-room?tenant=" + appt.tenant_id + "&apt=" + appt.id,
            checkin_link: publicUrl + "/checkin?apt=" + appt.id
        };

        const queueBatch: any[] = [];

        const addMessage = (type: string, targetAt: number, stageKey?: string) => {
            // Safety: Skip past-due reminders — they're no longer useful
            if (targetAt < now.getTime()) return;

            const scheduledTime = getSafeScheduledTime(new Date(targetAt), type);

            let media_url = null;
            let media_type = null;
            const finalStageKey = stageKey ?? null;

            if (botConfig.reminder_videos_enabled && finalStageKey && botConfig.reminder_videos?.[finalStageKey]) {
                media_url = botConfig.reminder_videos[finalStageKey];
                media_type = 'video';
                console.log(`[schedule-reminders] Matched video for ${finalStageKey}: ${media_url}`);
            } else if (botConfig.reminder_videos_enabled && finalStageKey) {
                console.log(`[schedule-reminders] No video found for active stage ${finalStageKey} (URL: ${botConfig.reminder_videos?.[finalStageKey]})`);
            }

            let override_message = null;
            if (finalStageKey && botConfig.reminder_captions?.[finalStageKey]) {
                override_message = renderCustomCaption(botConfig.reminder_captions[finalStageKey], vars);
            }

            queueBatch.push({
                tenant_id: appt.tenant_id,
                patient_phone: patientData.phone,
                message_type: type,
                template_key: type === 'reminder_15m' ? 'appointment_reminder_15m' : "appointment_" + type,
                template_vars: { ...vars, override_message },
                scheduled_at: scheduledTime,
                reference_id: appt.id,
                reference_type: 'appointment',
                media_url,
                media_type,
                is_edited: !!override_message,
                status: 'pending'
            });
        };



        // Rule: 48h Confirmation (only if enabled)
        if (botConfig.active_reminders?.['48h'] !== false) {
            addMessage('reminder_48h', apptTimestamp - (48 * 60 * 60 * 1000), '48h');
        }

        // Rule: 24h Confirmation (only if enabled)
        if (botConfig.active_reminders?.['24h'] !== false) {
            addMessage('reminder_24h', apptTimestamp - (24 * 60 * 60 * 1000), '24h');
        }

        // Rule: 2h Confirmation (only if enabled)
        if (botConfig.active_reminders?.['2h'] !== false) {
            addMessage('reminder_2h',  apptTimestamp - (2 * 60 * 60 * 1000),  '2h');
        }

        // Rule: Test Mode Reminder (5 minutes)
        if (botConfig.test_mode_15m && botConfig.active_reminders?.['15m'] !== false) {
            addMessage('reminder_15m', apptTimestamp - (5 * 60 * 1000), '15m');
        }

        if (queueBatch.length > 0) {
            // Using UPSERT to avoid duplicates based on unique constraint (tenant_id, patient_phone, template_key, reference_id)
            const { error: upsertErr } = await supabase
                .from('outbound_message_queue')
                .upsert(queueBatch, { 
                    onConflict: 'tenant_id,patient_phone,template_key,reference_id', 
                    ignoreDuplicates: true 
                });

            if (upsertErr) {
                console.error(`[schedule-reminders] Upsert failed for Appt ${appt.id}:`, upsertErr.message);
            } else {
                console.log(`[schedule-reminders] Successfully processed ${queueBatch.length} reminders for Appt ${appt.id}`);
                enqueuedCount += queueBatch.length;
            }
        } else {
            console.log(`[schedule-reminders] No active reminders for Appt ${appt.id}`);
        }
    }

    return new Response(JSON.stringify({ scheduled: enqueuedCount, count: appointments.length }), { 
        status: 200, 
        headers: corsHeaders 
    });

  } catch (err: any) {
    console.error("Critical Failure:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: corsHeaders 
    });
  }
});

