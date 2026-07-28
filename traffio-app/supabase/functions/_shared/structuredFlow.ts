/**
 * structuredFlow — F2 do dial de autonomia (docs/ROADMAP_PRODUTO_2026.md).
 *
 * Pré-filtro DETERMINÍSTICO — zero chamada de modelo — que roda ANTES do
 * roteamento por dial em process-inbox, para QUALQUER active_agent (human,
 * copilot, ai_always). Reconhece quatro padrões de alto volume / baixa ambiguidade:
 *
 *   0. Resposta de NOME COMPLETO a um clique de horário pendente de cadastro
 *      (context.pending_booking_slot) — completa a reserva (E2, 2026-07-24).
 *   1. Clique em botão de horário (context.pending_slots) — agenda direto se
 *      já houver nome de agendamento confirmado; senão pede o nome (item 0).
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
import { sendWithFallback, resolveTurnLanguage } from "./copilot.ts";
import {
    parseSlotClick,
    resolveSlotIdByTitle,
    resolvePatientForBooking,
    plausiblePersonName,
    bookingGradeName,
    fetchAvailableSlots,
    buildSlotInteractive,
    formatDateForPatient,
    doctorDisplayName,
    validateSchedulingReferences,
    getTenantClock,
    SLOT_CONFIRM_MSG,
    SLOT_TAKEN_MSG,
    SLOT_TAKEN_RETRY_MSG,
    ASK_NAME_TO_BOOK_MSG,
    WAITLIST_TAKEN_MSG,
    BOOKING_REASON,
    isPendingSlotsFresh,
    findConflictAlternatives,
    assembleFullConfirmation,
    type SlotOption,
} from "./schedulingTools.ts";

const PENDING_BOOKING_SLOT_TTL_MS = 30 * 60 * 1000;

/** Executa o RPC de agendamento e resolve o guard de idempotência (P-10) — usado tanto pelo clique direto quanto pela retomada por nome (E2). */
async function attemptBooking(
    supabase: SupabaseClient,
    tenantId: string,
    patientId: string,
    slot: Omit<SlotOption, "id" | "title" | "description">,
): Promise<{ success: boolean; bookErrMessage?: string }> {
    const { data: booked, error: bookErr } = await supabase.rpc("book_appointment", {
        p_tenant_id: tenantId,
        p_patient_id: patientId,
        p_doctor_id: slot.doctor_id,
        p_location_id: slot.location_id,
        p_type_id: slot.type_id,
        p_date: slot.date,
        p_start_time: slot.time,
        p_booked_by: "ai_agent",
    });
    const ok = !bookErr && (booked as any)?.success;
    // P-10 (idempotência) — mesmo guard do caminho `agendar` via LLM
    // (schedulingTools.ts): um clique/retry duplicado pode colidir com o
    // AGENDAMENTO DO PRÓPRIO paciente (SLOT_CONFLICT), não uma vaga perdida.
    let alreadyOwnBooking = false;
    if (!ok && (booked as any)?.reason === BOOKING_REASON.SLOT_CONFLICT) {
        const { data: own } = await supabase
            .from("appointments")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("patient_id", patientId)
            .eq("doctor_id", slot.doctor_id)
            .eq("date", slot.date)
            .eq("start_time", slot.time)
            .not("status", "in", '("canceled","cancelled","noshow","no_show")')
            .limit(1);
        alreadyOwnBooking = !!(own as any[])?.length;
    }
    return { success: ok || alreadyOwnBooking, bookErrMessage: bookErr?.message || (!ok ? JSON.stringify(booked) : undefined) };
}

/**
 * Agenda o slot e envia a confirmação. Em caso de conflito (outra pessoa
 * levou a vaga entre a oferta e o clique), busca alternativas FRESCAS e
 * reoferta na MESMA mensagem — "esse horário foi preenchido" nunca fica sem
 * próximo passo (E4, 2026-07-24). Sem alternativa nenhuma: avisa e passa
 * para a fila humana em vez de encerrar em silêncio.
 */
async function bookSlotAndNotify(
    supabase: SupabaseClient,
    dispatcher: OutboxDispatcher,
    tenant: any,
    tenantId: string,
    sessionId: string,
    phone: string,
    sessionManager: any,
    patientId: string,
    slot: Omit<SlotOption, "id" | "title" | "description">,
    language: string,
    baseContext: any,
    channel: string = "whatsapp",
): Promise<"replied" | "transferred"> {
    const { success, bookErrMessage } = await attemptBooking(supabase, tenantId, patientId, slot);

    if (success) {
        // P3 (2026-07-24): confirmação RICA (saudação + bloco estruturado com
        // data/horário/profissional/local/maps) — igual ao caminho LLM, nunca
        // mais a mensagem curta de uma linha só.
        const professional = await doctorDisplayName(supabase, tenantId, slot.doctor_id);
        const msg = await assembleFullConfirmation(
            supabase, tenantId,
            { date: slot.date, start_time: slot.time, location_id: slot.location_id },
            professional, patientId, normalizeLanguage(language),
        );
        await sendWithFallback(dispatcher, tenant, tenantId, phone, msg, undefined, channel);
        await sessionManager.logMessage(sessionId, "assistant", msg);
        const ctx = { ...baseContext };
        delete ctx.pending_slots;
        delete ctx.pending_slot_titles;
        delete ctx.pending_slots_at;
        delete ctx.pending_booking_slot;
        delete ctx.pending_booking_slot_at;
        await supabase
            .from("conversation_sessions")
            .update({ context: ctx, omnichannel_status: "bot_active", human_handoff: false })
            .eq("id", sessionId);
        return "replied";
    }

    console.warn(`[structuredFlow] [${phone}] agendamento não confirmou: ${bookErrMessage}`);
    const clock = await getTenantClock(supabase, tenantId);
    const { slots: alternatives } = await findConflictAlternatives(
        supabase, tenantId, slot.doctor_id, slot.type_id, slot.date, slot.time, clock);

    const ctx = { ...baseContext };
    delete ctx.pending_booking_slot;
    delete ctx.pending_booking_slot_at;

    if (alternatives.length) {
        const msg = SLOT_TAKEN_RETRY_MSG[language] || SLOT_TAKEN_RETRY_MSG.pt;
        const interactive = buildSlotInteractive(alternatives, language);
        await sendWithFallback(dispatcher, tenant, tenantId, phone, msg, interactive, channel);
        await sessionManager.logMessage(sessionId, "assistant", msg);
        ctx.pending_slots = alternatives.map((s: SlotOption) => s.id);
        ctx.pending_slot_titles = alternatives.map((s: SlotOption) => s.title);
        ctx.pending_slots_at = new Date().toISOString();
        await supabase
            .from("conversation_sessions")
            .update({ context: ctx, omnichannel_status: "bot_active", human_handoff: false })
            .eq("id", sessionId);
        return "replied";
    }

    const msg = SLOT_TAKEN_MSG[language] || SLOT_TAKEN_MSG.pt;
    await sendWithFallback(dispatcher, tenant, tenantId, phone, msg, undefined, channel);
    await sessionManager.logMessage(sessionId, "assistant", msg);
    delete ctx.pending_slots;
    delete ctx.pending_slot_titles;
    delete ctx.pending_slots_at;
    await sessionManager.triggerHumanHandoff(sessionId, ctx, { reason: "tech", kind: "soft" });
    return "transferred";
}

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

type ConversationLanguage = "pt" | "en" | "es";

function normalizeLanguage(value: unknown): ConversationLanguage {
    const language = String(value || "").toLowerCase();
    if (language.startsWith("en")) return "en";
    if (language.startsWith("es")) return "es";
    return "pt";
}

function phoneDigits(value: unknown): string {
    return String(value || "").replace(/\D/g, "");
}

function phoneVariants(value: unknown): string[] {
    const digits = phoneDigits(value);
    return [...new Set([String(value || ""), digits, digits ? `+${digits}` : ""].filter(Boolean))];
}

/** Só trata uma resposta inequívoca a um lembrete já correlacionado. */
function isReminderConfirmation(content: string): boolean {
    const text = String(content || "").trim().toLowerCase();
    if (!text || text.includes("?")) return false;
    return /(?:^|\b)(?:confirm(?:ed|ing|o|ado|ada)?|yes|yeah|yep|sim|s[ií]|ok(?:ay)?|correct|that(?:'s| is) right)(?:\b|$)/i.test(text);
}

function languageForReminderConfirmation(content: string, fallback: ConversationLanguage): ConversationLanguage {
    const text = String(content || "").toLowerCase();
    if (/\b(?:yes|yeah|yep|confirmed|confirming|correct|okay)\b/.test(text)) return "en";
    if (/\b(?:s[ií]|reagendar)\b/.test(text)) return "es";
    if (/\b(?:sim|confirmado|confirmada|confirmo)\b/.test(text)) return "pt";
    return fallback;
}

interface ReminderConfirmationMarker {
    appointmentId: string;
    language: ConversationLanguage;
}

/**
 * O marker de sessão resolve o caminho comum. A fila "sent" é o fallback
 * durável após o cleanup de contexto e para telefones com/sem sinal de +.
 * Em caso de duas consultas distintas, não escolhemos uma por suposição.
 */
async function findReminderConfirmationMarker(
    supabase: SupabaseClient,
    tenantId: string,
    phone: string,
    context: any,
): Promise<{ marker: ReminderConfirmationMarker | null; queryFailed: boolean }> {
    const pending = context?.pending_appointment_confirmation;
    if (pending?.appointment_id) {
        return {
            marker: {
                appointmentId: String(pending.appointment_id),
                language: normalizeLanguage(pending.locale || context.language),
            },
            queryFailed: false,
        };
    }

    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const select = "reference_id, patient_phone, template_key, template_vars, sent_at";
    const variants = phoneVariants(phone);
    let data: any[] | null = null;

    const primary = await supabase
        .from("outbound_message_queue")
        .select(select)
        .eq("tenant_id", tenantId)
        .eq("status", "sent")
        .like("template_key", "appointment_reminder%")
        .gte("sent_at", cutoff)
        .in("patient_phone", variants)
        .order("sent_at", { ascending: false })
        .limit(12);
    if (primary.error) return { marker: null, queryFailed: true };
    data = primary.data || [];

    // Cadastros legados podem ter máscara. Só nesta janela pequena fazemos
    // fallback em memória, sem varrer pacientes ou agenda inteira.
    if (!data.length) {
        const fallback = await supabase
            .from("outbound_message_queue")
            .select(select)
            .eq("tenant_id", tenantId)
            .eq("status", "sent")
            .like("template_key", "appointment_reminder%")
            .gte("sent_at", cutoff)
            .order("sent_at", { ascending: false })
            .limit(80);
        if (fallback.error) return { marker: null, queryFailed: true };
        const canonical = phoneDigits(phone);
        data = (fallback.data || []).filter((row: any) => canonical && phoneDigits(row.patient_phone) === canonical);
    }

    const byAppointment = new Map<string, any>();
    for (const row of data || []) {
        if (row.reference_id && !byAppointment.has(String(row.reference_id))) {
            byAppointment.set(String(row.reference_id), row);
        }
    }
    if (byAppointment.size !== 1) return { marker: null, queryFailed: false };
    const row = [...byAppointment.values()][0];
    return {
        marker: {
            appointmentId: String(row.reference_id),
            language: normalizeLanguage(row.template_vars?.locale || context?.language),
        },
        queryFailed: false,
    };
}

const REMINDER_CONFIRMED_MSG: Record<ConversationLanguage, (name: string, date: string, time: string) => string> = {
    pt: (name, date, time) => `Perfeito${name ? `, ${name}` : ""}! Sua consulta em ${date} às ${time} está confirmada.`,
    en: (name, date, time) => `Thank you${name ? `, ${name}` : ""}! Your appointment on ${date} at ${time} is confirmed.`,
    es: (name, date, time) => `¡Perfecto${name ? `, ${name}` : ""}! Su cita del ${date} a las ${time} está confirmada.`,
};

export async function tryStructuredFlow(supabase: SupabaseClient, params: StructuredFlowParams): Promise<StructuredFlowResult> {
    const { tenantId, sessionId, phone, tenant, botConfig, sessionManager, timezone } = params;

    // Feature gate — kill-switch de segurança (default ligado)
    if (botConfig?.structured_flows_enabled === false) return { matched: false };

    try {
        const { data: session } = await supabase
            .from("conversation_sessions")
            .select("context, recent_messages, platform_display_name, channel")
            .eq("id", sessionId)
            .single();
        if (!session) return { matched: false };
        const channel = (session as any).channel || "whatsapp";

        const context = session.context || {};
        const searchPhone = (context as any)?.visitor_phone || phone;
        const history = (session.recent_messages || []).filter((m: any) => m.role !== "internal");
        const lastUserMsg = [...history].reverse().find((m: any) => m.role === "user");
        const rawContent: string = lastUserMsg?.content || "";
        const language = resolveTurnLanguage(rawContent, context.language);
        const dispatcher = new OutboxDispatcher(supabase);

        // Confirmação de lembrete: resposta curta e inequívoca nunca chega ao
        // LLM como se fosse a confirmação de um novo slot.
        if (isReminderConfirmation(rawContent)) {
            const correlation = await findReminderConfirmationMarker(supabase, tenantId, searchPhone, context);
            if (correlation.queryFailed) {
                console.error(`[structuredFlow] [${phone}] falha ao consultar correlação de lembrete`);
                return { matched: true, status: "failed" };
            }
            if (correlation.marker) {
                const { data: appointment, error: appointmentError } = await supabase
                    .from("appointments")
                    .select("id, date, start_time, status, confirmation_status, patients:patient_id(phone, full_name)")
                    .eq("tenant_id", tenantId)
                    .eq("id", correlation.marker.appointmentId)
                    .maybeSingle();
                if (appointmentError) {
                    console.error(`[structuredFlow] [${phone}] falha ao validar consulta do lembrete: ${appointmentError.message}`);
                    return { matched: true, status: "failed" };
                }

                const patient = Array.isArray((appointment as any)?.patients)
                    ? (appointment as any)?.patients[0]
                    : (appointment as any)?.patients;
                const ownsAppointment = Boolean(
                    appointment
                    && patient?.phone
                    && phoneDigits(patient.phone) === phoneDigits(phone)
                );
                const activeAppointment = ["scheduled", "confirmed"].includes(String((appointment as any)?.status || "").toLowerCase());

                if (ownsAppointment && activeAppointment) {
                    const confirmationLanguage = languageForReminderConfirmation(rawContent, correlation.marker.language);
                    const { error: updateError } = await supabase
                        .from("appointments")
                        .update({ confirmation_status: "confirmed" })
                        .eq("tenant_id", tenantId)
                        .eq("id", correlation.marker.appointmentId);
                    if (updateError) {
                        console.error(`[structuredFlow] [${phone}] falha ao confirmar presença: ${updateError.message}`);
                        return { matched: true, status: "failed" };
                    }

                    const ctx = { ...context };
                    delete ctx.pending_appointment_confirmation;
                    const date = formatDateForPatient(String((appointment as any).date), confirmationLanguage);
                    const time = String((appointment as any).start_time || "").substring(0, 5);
                    const msg = (REMINDER_CONFIRMED_MSG[confirmationLanguage] || REMINDER_CONFIRMED_MSG.pt)(patient?.full_name || "", date, time);
                    await sendWithFallback(dispatcher, tenant, tenantId, phone, msg, undefined, channel);
                    await sessionManager.logMessage(sessionId, "assistant", msg);
                    await supabase
                        .from("conversation_sessions")
                        .update({ context: ctx, omnichannel_status: "bot_active", human_handoff: false })
                        .eq("id", sessionId);
                    return { matched: true, status: "replied" };
                }

                // Referência expirada/cancelada ou de outro contato: limpa o
                // marker e permite o fallback seguro pedir esclarecimento.
                const ctx = { ...context };
                delete ctx.pending_appointment_confirmation;
                await supabase.from("conversation_sessions").update({ context: ctx }).eq("id", sessionId);
            }
        }

        // ── 0. Retomada de reserva pendente por NOME (E2, 2026-07-24) ──────────
        // O bloco 1 (clique de horário) só agenda quando já existe nome de
        // agendamento confirmado; sem isso, ele grava pending_booking_slot e
        // pede o nome (ASK_NAME_TO_BOOK_MSG). Esta mensagem seguinte é a
        // resposta a esse pedido — não um novo clique. Um clique NOVO
        // ("slot|...") ignora este bloco e segue direto para o bloco 1.
        const pendingBookingSlot = context.pending_booking_slot;
        if (pendingBookingSlot && !rawContent.trim().startsWith("slot|")) {
            const pendingAt = context.pending_booking_slot_at ? new Date(context.pending_booking_slot_at).getTime() : NaN;
            const expired = !Number.isFinite(pendingAt) || (Date.now() - pendingAt) > PENDING_BOOKING_SLOT_TTL_MS;

            if (expired) {
                const ctx = { ...context };
                delete ctx.pending_booking_slot;
                delete ctx.pending_booking_slot_at;
                await supabase.from("conversation_sessions").update({ context: ctx }).eq("id", sessionId);
                // segue para o roteamento normal abaixo (não intercepta esta mensagem)
            } else if (bookingGradeName(rawContent)) {
                const pendingSlotClick = parseSlotClick(pendingBookingSlot);
                const scopeError = pendingSlotClick
                    ? await validateSchedulingReferences(supabase, tenantId, pendingSlotClick.doctor_id, pendingSlotClick.location_id, pendingSlotClick.type_id)
                    : "invalid_pending_slot";
                if (pendingSlotClick && !scopeError) {
                    // Titular do telefone: identifica/atualiza pela ficha existente com
                    // o nome agora confirmado (resolvePatientForBooking cria OU
                    // atualiza em vez de duplicar — ver schedulingTools.ts).
                    const resolved = await resolvePatientForBooking(supabase, tenantId, searchPhone, null, rawContent.trim());
                    if (resolved.patient) {
                        return {
                            matched: true,
                            status: await bookSlotAndNotify(supabase, dispatcher, tenant, tenantId, sessionId, phone, sessionManager, resolved.patient.id, pendingSlotClick, language, context, channel),
                        };
                    }
                }
                console.error(`[structuredFlow] [${phone}] slot pendente inválido ao retomar por nome: ${scopeError || "resolvePatientForBooking falhou"}`);
                const ctx = { ...context };
                delete ctx.pending_booking_slot;
                delete ctx.pending_booking_slot_at;
                await supabase.from("conversation_sessions").update({ context: ctx }).eq("id", sessionId);
                return { matched: true, status: "failed" };
            } else {
                // Ainda não parece nome completo — deixa o LLM conduzir (o hint de
                // fluxo em copilot.ts explica o que falta); marker preservado.
                return { matched: false };
            }
        }

        // ── 1. Clique em botão de horário / fallback numérico (sem LLM) ────────
        // TTL (E3): dígito/título só casam contra pending_slots FRESCOS — depois
        // disso a lista pode conter horários já ocupados por outra pessoa. Um
        // clique CRU em "slot|..." ignora este TTL: vai direto para
        // parseSlotClick/RPC, que é atômico e sempre revalida contra o banco.
        let clickContent = rawContent;
        const pendingSlotsFresh = isPendingSlotsFresh(context.pending_slots_at);
        const digitMatch = rawContent.trim().match(/^([1-9])[.)]?$/);
        if (pendingSlotsFresh && digitMatch && Array.isArray(context.pending_slots) && context.pending_slots.length > 0) {
            const idx = parseInt(digitMatch[1], 10) - 1;
            if (idx < context.pending_slots.length) clickContent = context.pending_slots[idx];
        }
        if (!clickContent.startsWith("slot|") && pendingSlotsFresh) {
            const byTitle = resolveSlotIdByTitle(rawContent, context.pending_slots, context.pending_slot_titles);
            if (byTitle) clickContent = byTitle;
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
            const resolved = await resolvePatientForBooking(
                supabase, tenantId, searchPhone,
                plausiblePersonName(forWhom) ? forWhom : null,
                session.platform_display_name);

            // E2 (2026-07-24): sem nome de AGENDAMENTO (nome completo) confirmado,
            // NUNCA cria "Paciente WhatsApp" nem agenda — guarda o clique e pede o
            // nome. resolvePatientForBooking só devolve reason:"name_required"
            // quando não achou ficha existente E não tem nome confiável para criar uma.
            if (!resolved.patient && resolved.reason === "name_required") {
                const msg = ASK_NAME_TO_BOOK_MSG[language] || ASK_NAME_TO_BOOK_MSG.pt;
                await sendWithFallback(dispatcher, tenant, tenantId, phone, msg, undefined, channel);
                await sessionManager.logMessage(sessionId, "assistant", msg);
                const ctx = { ...context };
                ctx.pending_booking_slot = clickContent;
                ctx.pending_booking_slot_at = new Date().toISOString();
                await supabase
                    .from("conversation_sessions")
                    .update({ context: ctx, omnichannel_status: "bot_active", human_handoff: false })
                    .eq("id", sessionId);
                return { matched: true, status: "replied" };
            }
            if (!resolved.patient) return { matched: true, status: "failed" };

            return {
                matched: true,
                status: await bookSlotAndNotify(supabase, dispatcher, tenant, tenantId, sessionId, phone, sessionManager, resolved.patient.id, slotClick, language, context, channel),
            };
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
                // P3 (2026-07-24): confirmação rica também na vaga de lista de espera.
                const professional = await doctorDisplayName(supabase, tenantId, pendingWaitlist.doctor_id);
                const msg = await assembleFullConfirmation(
                    supabase, tenantId,
                    { date: pendingWaitlist.date, start_time: pendingWaitlist.start_time, location_id: pendingWaitlist.location_id },
                    professional, pendingWaitlist.patient_id, normalizeLanguage(language),
                );
                await sendWithFallback(dispatcher, tenant, tenantId, phone, msg, undefined, channel);
                await sessionManager.logMessage(sessionId, "assistant", msg);
                await supabase.from("waitlist").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("id", pendingWaitlist.waitlist_id);
                await supabase.from("conversation_sessions")
                    .update({ context: ctx, omnichannel_status: "bot_active", human_handoff: false })
                    .eq("id", sessionId);
                return { matched: true, status: "replied" };
            }

            console.warn(`[structuredFlow] [${phone}] waitlist não confirmou: ${bookErr?.message || JSON.stringify(booked)}`);
            await supabase.from("waitlist").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", pendingWaitlist.waitlist_id);

            // E4 (2026-07-24): a vaga fechou de novo entre a notificação e a
            // confirmação — busca alternativas FRESCAS antes de desistir e
            // passar para humano (mesmo profissional/procedimento da lista).
            const clock = await getTenantClock(supabase, tenantId);
            const { slots: alternatives } = await findConflictAlternatives(
                supabase, tenantId, pendingWaitlist.doctor_id, pendingWaitlist.type_id ?? null, pendingWaitlist.date, pendingWaitlist.start_time, clock);

            if (alternatives.length) {
                const retryMsg = SLOT_TAKEN_RETRY_MSG[language] || SLOT_TAKEN_RETRY_MSG.pt;
                const interactive = buildSlotInteractive(alternatives, language);
                await sendWithFallback(dispatcher, tenant, tenantId, phone, retryMsg, interactive, channel);
                await sessionManager.logMessage(sessionId, "assistant", retryMsg);
                ctx.pending_slots = alternatives.map((s: SlotOption) => s.id);
                ctx.pending_slot_titles = alternatives.map((s: SlotOption) => s.title);
                ctx.pending_slots_at = new Date().toISOString();
                await supabase.from("conversation_sessions")
                    .update({ context: ctx, omnichannel_status: "bot_active", human_handoff: false })
                    .eq("id", sessionId);
                return { matched: true, status: "replied" };
            }

            const msg = WAITLIST_TAKEN_MSG[language] || WAITLIST_TAKEN_MSG.pt;
            await sendWithFallback(dispatcher, tenant, tenantId, phone, msg, undefined, channel);
            await sessionManager.logMessage(sessionId, "assistant", msg);
            await sessionManager.triggerHumanHandoff(sessionId, ctx, { reason: "tech", kind: "soft" });
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
                await sendWithFallback(dispatcher, tenant, tenantId, phone, msg, undefined, channel);
                await sessionManager.logMessage(sessionId, "assistant", msg);
                await sessionManager.triggerHumanHandoff(sessionId, ctx, { reason: "tech", kind: "soft" });
                return { matched: true, status: "transferred" };
            }

            const msg = RECOVERY_OFFER_MSG[language] || RECOVERY_OFFER_MSG.pt;
            const interactive = buildSlotInteractive(slots, language);
            await sendWithFallback(dispatcher, tenant, tenantId, phone, msg, interactive, channel);
            await sessionManager.logMessage(sessionId, "assistant", msg);
            ctx.pending_slots = slots.map((s: SlotOption) => s.id);
            ctx.pending_slot_titles = slots.map((s: SlotOption) => s.title);
            ctx.pending_slots_at = new Date().toISOString();
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
