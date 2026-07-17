/**
 * structuredFlow — F2 do dial de autonomia (docs/ROADMAP_PRODUTO_2026.md).
 *
 * Pré-filtro DETERMINÍSTICO — zero chamada de modelo — que roda ANTES do
 * roteamento por dial em process-inbox, para QUALQUER active_agent (human,
 * copilot, ai_always). Reconhece três padrões de alto volume / baixa ambiguidade:
 *
 *   1. Clique em botão de horário (context.pending_slots) — agenda direto.
 *   2. Resposta a uma notificação de vaga de lista de espera (context.pending_waitlist).
 *   3. Resposta a uma mensagem de recuperação de falta (context.pending_recovery).
 *
 * Se nada casar, retorna { matched: false } e o chamador segue o roteamento
 * normal (LLM em ai_always, fila humana nos demais) sem nenhuma mudança de
 * comportamento — este módulo só ADICIONA um atalho, nunca substitui o fallback.
 *
 * Fail-safe: qualquer ambiguidade (marcador presente mas resposta não bate,
 * agendamento de referência não encontrado, etc.) NÃO é tratada aqui — cai no
 * roteamento normal em vez de adivinhar.
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { OutboxDispatcher } from "./outboxDispatcher.ts";
import { sendWithFallback } from "./copilot.ts";
import {
    parseSlotClick,
    resolvePatientForBooking,
    plausiblePersonName,
    fetchAvailableSlots,
    buildSlotInteractive,
    formatDateForPatient,
    doctorDisplayName,
    validateSchedulingReferences,
    getTenantClock,
    SLOT_CONFIRM_MSG,
    SLOT_TAKEN_MSG,
    WAITLIST_TAKEN_MSG,
    type SlotOption,
} from "./schedulingTools.ts";

export type StructuredFlowResult =
    | { matched: false }
    | { matched: true; status: "replied" | "transferred" | "failed" };

interface StructuredFlowParams {
    tenantId: string;
    sessionId: string;
    phone: string;
    /** Linha completa do tenant (credenciais de envio) */
    tenant: any;
    botConfig: any;
    sessionManager: any;
    timezone?: string | null;
}

const NO_SHOW_STATUSES = ["noshow", "no_show"];
const CANCELLED_STATUSES = ["canceled", "cancelled"];

/** Palavra-chave canônica esperada por template de recovery + idioma (messageTemplates.ts). */
const RECOVERY_KEYWORDS: Record<string, Record<string, string>> = {
    recovery_immediate: { pt: "remarcar", en: "reschedule", es: "reagendar" },
    recovery_48h: { pt: "remarcar", en: "reschedule", es: "reagendar" },
    recovery_7d: { pt: "remarcar", en: "reschedule", es: "reagendar" },
};

/** Afirmativos aceitos para a resposta "Sim" da lista de espera — pergunta fechada, mais permissivo. */
const WAITLIST_YES = new Set(["sim", "s", "yes", "y", "sí", "si", "ok", "confirmo"]);

const RECOVERY_OFFER_MSG: Record<string, string> = {
    pt: "Encontrei esses horários para você, escolha um:",
    en: "I found these times for you, please pick one:",
    es: "Encontré estos horarios para usted, elija uno:",
};

const NO_SLOTS_MSG: Record<string, string> = {
    pt: "Vou verificar com a equipe os próximos horários disponíveis e já te retorno por aqui!",
    en: "I'll check with the team for the next available times and get back to you right here!",
    es: "Voy a verificar con el equipo los próximos horarios disponibles y le aviso por aquí.",
};

export async function tryStructuredFlow(supabase: SupabaseClient, params: StructuredFlowParams): Promise<StructuredFlowResult> {
    const { tenantId, sessionId, phone, tenant, botConfig, sessionManager, timezone } = params;

    // Feature gate — kill-switch de segurança (default ligado)
    if (botConfig?.structured_flows_enabled === false) return { matched: false };

    try {
        const { data: session } = await supabase
            .from("conversation_sessions")
            .select("context, recent_messages, platform_display_name")
            .eq("id", sessionId)
            .single();
        if (!session) return { matched: false };

        const context = session.context || {};
        const language = context.language || "pt";
        const history = (session.recent_messages || []).filter((m: any) => m.role !== "internal");
        const lastUserMsg = [...history].reverse().find((m: any) => m.role === "user");
        const rawContent: string = lastUserMsg?.content || "";
        const dispatcher = new OutboxDispatcher(supabase);

        // ── 1. Clique em botão de horário / fallback numérico (sem LLM) ────────
        let clickContent = rawContent;
        const digitMatch = rawContent.trim().match(/^([1-9])[.)]?$/);
        if (digitMatch && Array.isArray(context.pending_slots) && context.pending_slots.length > 0) {
            const idx = parseInt(digitMatch[1], 10) - 1;
            if (idx < context.pending_slots.length) clickContent = context.pending_slots[idx];
        }
        const slotClick = parseSlotClick(clickContent);
        if (slotClick) {
            // slot_id é texto controlável pelo cliente: reautorizar antes do RPC.
            if (await validateSchedulingReferences(supabase, tenantId, slotClick.doctor_id, slotClick.location_id, slotClick.type_id)) {
                console.error(`[structuredFlow] [${phone}] slot recusado por escopo de tenant`);
                return { matched: true, status: "failed" };
            }
            // Se a conversa era para um terceiro (intake.for_whom = nome plausível),
            // o clique agenda na ficha do terceiro — nunca na do titular do telefone
            const forWhom = context?.intake?.for_whom;
            const { patient } = await resolvePatientForBooking(
                supabase, tenantId, phone,
                plausiblePersonName(forWhom) ? forWhom : null,
                session.platform_display_name);
            if (!patient) return { matched: true, status: "failed" };

            const { data: booked, error: bookErr } = await supabase.rpc("book_appointment", {
                p_tenant_id: tenantId,
                p_patient_id: patient.id,
                p_doctor_id: slotClick.doctor_id,
                p_location_id: slotClick.location_id,
                p_type_id: slotClick.type_id,
                p_date: slotClick.date,
                p_start_time: slotClick.time,
                p_booked_by: "ai_agent",
            });

            const ok = !bookErr && (booked as any)?.success;
            const msg = ok
                ? (SLOT_CONFIRM_MSG[language] || SLOT_CONFIRM_MSG.pt)(
                    formatDateForPatient(slotClick.date, language), slotClick.time,
                    await doctorDisplayName(supabase, tenantId, slotClick.doctor_id))
                : (SLOT_TAKEN_MSG[language] || SLOT_TAKEN_MSG.pt);
            if (!ok) console.warn(`[structuredFlow] [${phone}] slot click não agendou: ${bookErr?.message || JSON.stringify(booked)}`);

            await sendWithFallback(dispatcher, tenant, tenantId, phone, msg);
            await sessionManager.logMessage(sessionId, "assistant", msg);
            const ctx = { ...context };
            delete ctx.pending_slots;
            await supabase
                .from("conversation_sessions")
                .update({ context: ctx, omnichannel_status: "bot_active", human_handoff: false })
                .eq("id", sessionId);
            return { matched: true, status: "replied" };
        }

        // ── 2. Resposta a oferta de vaga de lista de espera ─────────────────────
        const pendingWaitlist = context.pending_waitlist;
        if (pendingWaitlist) {
            const normalized = rawContent.trim().toLowerCase();
            if (!WAITLIST_YES.has(normalized)) return { matched: false };

            const { data: booked, error: bookErr } = await supabase.rpc("book_appointment", {
                p_tenant_id: tenantId,
                p_patient_id: pendingWaitlist.patient_id,
                p_doctor_id: pendingWaitlist.doctor_id,
                p_location_id: pendingWaitlist.location_id,
                p_type_id: pendingWaitlist.type_id,
                p_date: pendingWaitlist.date,
                p_start_time: pendingWaitlist.start_time,
                p_booked_by: "ai_agent",
            });

            const ok = !bookErr && (booked as any)?.success;
            const ctx = { ...context };
            delete ctx.pending_waitlist;

            if (ok) {
                const msg = (SLOT_CONFIRM_MSG[language] || SLOT_CONFIRM_MSG.pt)(
                    formatDateForPatient(pendingWaitlist.date, language), pendingWaitlist.start_time,
                    await doctorDisplayName(supabase, tenantId, pendingWaitlist.doctor_id));
                await sendWithFallback(dispatcher, tenant, tenantId, phone, msg);
                await sessionManager.logMessage(sessionId, "assistant", msg);
                await supabase.from("waitlist").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("id", pendingWaitlist.waitlist_id);
                await supabase.from("conversation_sessions")
                    .update({ context: ctx, omnichannel_status: "bot_active", human_handoff: false })
                    .eq("id", sessionId);
                return { matched: true, status: "replied" };
            }

            console.warn(`[structuredFlow] [${phone}] waitlist não confirmou: ${bookErr?.message || JSON.stringify(booked)}`);
            const msg = WAITLIST_TAKEN_MSG[language] || WAITLIST_TAKEN_MSG.pt;
            await sendWithFallback(dispatcher, tenant, tenantId, phone, msg);
            await sessionManager.logMessage(sessionId, "assistant", msg);
            await supabase.from("waitlist").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", pendingWaitlist.waitlist_id);
            await sessionManager.triggerHumanHandoff(sessionId, ctx);
            return { matched: true, status: "transferred" };
        }

        // ── 3. Resposta a mensagem de recuperação de falta (REMARCAR/RESCHEDULE/REAGENDAR) ──
        const pendingRecovery = context.pending_recovery;
        if (pendingRecovery) {
            const keywords = RECOVERY_KEYWORDS[pendingRecovery.template_key];
            const expected = keywords?.[language] || keywords?.pt;
            const normalized = rawContent.trim().toLowerCase();
            if (!expected || normalized !== expected) return { matched: false };

            // Médico do recovery vem do agendamento faltado/cancelado mais recente do paciente
            const { data: lastAppt } = await supabase
                .from("appointments")
                .select("doctor_id, type_id")
                .eq("tenant_id", tenantId)
                .eq("patient_id", pendingRecovery.patient_id)
                .in("status", [...NO_SHOW_STATUSES, ...CANCELLED_STATUSES])
                .order("date", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!lastAppt?.doctor_id) return { matched: false };

            let duration = 30;
            if (lastAppt.type_id) {
                const { data: svc } = await supabase
                    .from("appointment_types")
                    .select("duration_minutes")
                    .eq("tenant_id", tenantId)
                    .eq("id", lastAppt.type_id)
                    .maybeSingle();
                if (svc?.duration_minutes) duration = svc.duration_minutes;
            }

            const { slots } = await fetchAvailableSlots(
                supabase, tenantId, lastAppt.doctor_id, undefined, duration, lastAppt.type_id || null,
                await getTenantClock(supabase, tenantId));

            const ctx = { ...context };
            delete ctx.pending_recovery;

            if (!slots.length) {
                const msg = NO_SLOTS_MSG[language] || NO_SLOTS_MSG.pt;
                await sendWithFallback(dispatcher, tenant, tenantId, phone, msg);
                await sessionManager.logMessage(sessionId, "assistant", msg);
                await sessionManager.triggerHumanHandoff(sessionId, ctx);
                return { matched: true, status: "transferred" };
            }

            const msg = RECOVERY_OFFER_MSG[language] || RECOVERY_OFFER_MSG.pt;
            const interactive = buildSlotInteractive(slots, language);
            await sendWithFallback(dispatcher, tenant, tenantId, phone, msg, interactive);
            await sessionManager.logMessage(sessionId, "assistant", msg);
            ctx.pending_slots = slots.map((s: SlotOption) => s.id);
            await supabase.from("conversation_sessions")
                .update({ context: ctx, omnichannel_status: "bot_active", human_handoff: false })
                .eq("id", sessionId);
            return { matched: true, status: "replied" };
        }

        return { matched: false };
    } catch (err: any) {
        console.error(`[structuredFlow] [${phone}] falha isolada: ${err?.message}`);
        return { matched: false };
    }
}
