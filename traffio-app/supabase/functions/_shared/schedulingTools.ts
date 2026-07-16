/**
 * schedulingTools — ferramentas de agenda do agente autônomo (F3).
 *
 * REGRA-MÃE: o modelo NUNCA gera horário, disponibilidade ou dado de agenda —
 * ele apenas narra o retorno destas ferramentas, que falam com os RPCs REAIS
 * de produção (validados contra o schema — ver memória do projeto):
 *
 *   find_next_available_dates(p_doctor_id, p_from_date, p_limit, p_duration_minutes)
 *     → [{date, location_id, location_name, slots: ["HH:MM"...], slot_count}]
 *   book_appointment(p_tenant_id, p_patient_id, p_doctor_id, p_location_id,
 *                    p_type_id, p_date, p_start_time, p_booked_by)
 *     → {success, appointment_id} | {success:false, reason:'slot_taken'|...}
 *
 * Os horários oferecidos viram BOTÕES CLICÁVEIS (id determinístico "slot|...")
 * — o clique é agendado sem passar pelo modelo (caminho 100% determinístico).
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import type { LlmTool, LlmToolCall } from "./llmProvider.ts";

// ─── Horário de atendimento humano do tenant ─────────────────────────────────

/**
 * bot_config.business_hours = { start: "08:00", end: "18:00", days: [1..6] }
 * (days: 0=domingo … 6=sábado, no fuso do tenant). Sem config → considera
 * expediente sempre (comportamento conservador: cancelamento vai para humano).
 */
export function isWithinBusinessHours(botConfig: any, timezone?: string): boolean {
    const bh = botConfig?.business_hours;
    if (!bh?.start || !bh?.end) return true;
    try {
        const tz = timezone || "America/Sao_Paulo";
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
        }).formatToParts(new Date());
        const hour = parseInt(parts.find(p => p.type === "hour")?.value ?? "12", 10);
        const minute = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
        const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const dow = wdMap[parts.find(p => p.type === "weekday")?.value ?? "Mon"] ?? 1;

        const days: number[] = Array.isArray(bh.days) && bh.days.length ? bh.days : [1, 2, 3, 4, 5];
        if (!days.includes(dow)) return false;

        const [sh, sm] = String(bh.start).split(":").map(Number);
        const [eh, em] = String(bh.end).split(":").map(Number);
        const cur = hour * 60 + minute;
        return cur >= sh * 60 + (sm || 0) && cur < eh * 60 + (em || 0);
    } catch {
        return true;
    }
}

/** Data de hoje (YYYY-MM-DD) no fuso do tenant — para o modelo resolver "amanhã". */
export function todayInTz(timezone?: string): string {
    try {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone || "America/Sao_Paulo",
            year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date());
    } catch {
        return new Date().toISOString().split("T")[0];
    }
}

// ─── Slots clicáveis ─────────────────────────────────────────────────────────

export interface SlotOption {
    id: string;      // slot|<doctor_id>|<location_id>|<type_id ou vazio>|<date>|<time>
    title: string;   // "16/07 · 09:00"
    description?: string;
    doctor_id: string;
    location_id: string;
    type_id: string | null;
    date: string;
    time: string;
}

const MAX_SLOT_OPTIONS = 6;

function slotId(s: Omit<SlotOption, "id" | "title" | "description">): string {
    return `slot|${s.doctor_id}|${s.location_id}|${s.type_id ?? ""}|${s.date}|${s.time}`;
}

/** Clique de botão chega como content = id do botão. Parse determinístico. */
export function parseSlotClick(content: string | null | undefined): Omit<SlotOption, "id" | "title" | "description"> | null {
    if (!content?.startsWith("slot|")) return null;
    const [, doctor_id, location_id, type_id, date, time] = content.trim().split("|");
    if (!doctor_id || !location_id || !date || !time) return null;
    return { doctor_id, location_id, type_id: type_id || null, date, time };
}

/**
 * Normaliza um slot vindo do RPC para "HH:MM". O schema de PRODUÇÃO diverge do
 * repo (memória do projeto): a migration retorna strings, mas a versão aplicada
 * pode retornar objetos ({time}/{slot_time}/{start_time}). Nunca confiar na forma.
 */
export function normalizeSlotTime(raw: unknown): string | null {
    let candidate = "";
    if (typeof raw === "string") candidate = raw;
    else if (raw && typeof raw === "object") {
        const o = raw as any;
        candidate = o.time ?? o.slot_time ?? o.start_time ?? o.hour ?? "";
    }
    const match = String(candidate).match(/^([01]?\d|2[0-3]):([0-5]\d)/);
    if (!match) return null;
    return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/** Payload interativo (≤3 slots = botões; mais = lista) — o dispatcher tem fallback texto. */
export function buildSlotInteractive(slots: SlotOption[]): any {
    if (slots.length <= 3) {
        return { type: "button", buttons: slots.map(s => ({ id: s.id, title: s.title })) };
    }
    return {
        type: "list",
        header: "Horários",
        buttonText: "Ver horários",
        sections: [{
            title: "Horários disponíveis",
            rows: slots.map(s => ({ id: s.id, title: s.title, description: s.description })),
        }],
    };
}

/**
 * Consulta o RPC find_next_available_dates e monta os SlotOption clicáveis.
 * Extraído do case 'ver_disponibilidade' para ser reutilizável fora do formato
 * de tool-call do LLM (usado também pelo F2 — respostas determinísticas de recovery).
 */
export async function fetchAvailableSlots(
    supabase: SupabaseClient,
    doctorId: string,
    fromDate: string | undefined,
    durationMinutes: number,
    typeId: string | null = null,
): Promise<{ slots: SlotOption[]; availableForModel: { date: string; location: string; slots: string[] }[]; error?: string }> {
    const { data, error } = await supabase.rpc("find_next_available_dates", {
        p_doctor_id: doctorId,
        p_from_date: fromDate,
        p_limit: 2,
        p_duration_minutes: durationMinutes,
    });
    if (error) return { slots: [], availableForModel: [], error: error.message };

    const dates = (Array.isArray(data) ? data : []) as any[];

    // Diagnóstico de forma: o RPC de produção pode retornar slots como
    // string OU objeto (schema drift documentado) — logar uma amostra crua
    const rawSample = dates[0]?.slots?.[0];
    if (rawSample !== undefined && typeof rawSample !== "string") {
        console.log(`[schedulingTools] slots do RPC vieram como objeto: ${JSON.stringify(rawSample).substring(0, 120)}`);
    }

    const slots: SlotOption[] = [];
    const availableForModel: { date: string; location: string; slots: string[] }[] = [];
    for (const d of dates) {
        const normalized = (d.slots || [])
            .map((s: unknown) => normalizeSlotTime(s))
            .filter((t: string | null): t is string => t !== null)
            .slice(0, 3);
        availableForModel.push({ date: d.date, location: d.location_name, slots: normalized });

        for (const time of normalized) {
            if (slots.length >= MAX_SLOT_OPTIONS) break;
            const base = {
                doctor_id: doctorId,
                location_id: d.location_id,
                type_id: typeId,
                date: d.date,
                time,
            };
            const [, m, day] = String(d.date).split("-");
            slots.push({
                ...base,
                id: slotId(base),
                title: `${day}/${m} · ${time}`,
                description: d.location_name || undefined,
            });
        }
    }

    return { slots, availableForModel };
}

// ─── Definições das ferramentas ──────────────────────────────────────────────

export const SCHEDULING_TOOLS: LlmTool[] = [
    {
        name: "listar_profissionais",
        description: "Lista os profissionais da clínica (id e nome). Use antes de consultar disponibilidade quando o paciente não indicou profissional.",
        input_schema: { type: "object", properties: {} },
    },
    {
        name: "ver_disponibilidade",
        description: "Consulta os horários REAIS disponíveis de um profissional a partir de uma data. Os horários retornados são enviados ao paciente como botões clicáveis automaticamente — apresente-os brevemente no texto.",
        input_schema: {
            type: "object",
            properties: {
                doctor_id: { type: "string", description: "ID do profissional (de listar_profissionais)" },
                from_date: { type: "string", description: "Data inicial YYYY-MM-DD (default: hoje)" },
                type_id: { type: "string", description: "ID do serviço, se conhecido (define a duração)" },
            },
            required: ["doctor_id"],
        },
    },
    {
        name: "buscar_meus_agendamentos",
        description: "Busca os agendamentos futuros do paciente desta conversa. Use para consultar ou antes de remarcar.",
        input_schema: { type: "object", properties: {} },
    },
    {
        name: "agendar",
        description: "Agenda uma consulta em um horário confirmado pelo paciente. SÓ use com doctor_id/location_id/date/start_time vindos de ver_disponibilidade — nunca invente valores.",
        input_schema: {
            type: "object",
            properties: {
                doctor_id: { type: "string" },
                location_id: { type: "string" },
                date: { type: "string", description: "YYYY-MM-DD" },
                start_time: { type: "string", description: "HH:MM" },
                type_id: { type: "string", description: "ID do serviço (opcional)" },
                patient_name: { type: "string", description: "Nome do paciente, se ele informou" },
            },
            required: ["doctor_id", "location_id", "date", "start_time"],
        },
    },
    {
        name: "remarcar",
        description: "Remarca um agendamento existente para novo horário confirmado pelo paciente. Use buscar_meus_agendamentos para obter o appointment_id e ver_disponibilidade para o novo horário.",
        input_schema: {
            type: "object",
            properties: {
                appointment_id: { type: "string" },
                doctor_id: { type: "string" },
                location_id: { type: "string" },
                date: { type: "string" },
                start_time: { type: "string" },
            },
            required: ["appointment_id", "doctor_id", "location_id", "date", "start_time"],
        },
    },
    {
        name: "encaminhar_cancelamento",
        description: "Use SEMPRE que o paciente quiser cancelar um agendamento. Você NUNCA cancela diretamente — esta ferramenta encaminha para a equipe conforme o horário de atendimento.",
        input_schema: { type: "object", properties: {} },
    },
];

// ─── Executor ────────────────────────────────────────────────────────────────

export interface ToolExecOutcome {
    /** Resultado devolvido ao modelo como tool_result */
    data: any;
    /** Slots estruturados (quando a ferramenta foi ver_disponibilidade) */
    slots?: SlotOption[];
}

export async function executeSchedulingTool(
    supabase: SupabaseClient,
    tenantId: string,
    phone: string,
    patientDisplayName: string | null,
    call: LlmToolCall,
): Promise<ToolExecOutcome> {
    const input = (call.input || {}) as any;

    switch (call.name) {
        case "listar_profissionais": {
            const { data, error } = await supabase
                .from("doctors")
                .select("id, full_name")
                .eq("tenant_id", tenantId)
                .limit(20);
            if (error) return { data: { error: error.message } };
            return { data: { professionals: data || [] } };
        }

        case "ver_disponibilidade": {
            // Duração vem do serviço quando conhecido; senão 30min
            let duration = 30;
            if (input.type_id) {
                const { data: svc } = await supabase
                    .from("appointment_types")
                    .select("duration_minutes")
                    .eq("id", input.type_id)
                    .maybeSingle();
                if (svc?.duration_minutes) duration = svc.duration_minutes;
            }

            const { slots, availableForModel, error } = await fetchAvailableSlots(
                supabase, input.doctor_id, input.from_date || undefined, duration, input.type_id || null,
            );
            if (error) return { data: { error } };

            return {
                data: {
                    available: availableForModel,
                    note: slots.length
                        ? "The time slots above will be sent to the patient as clickable buttons automatically — present them briefly and invite the patient to pick one. Reply in the PATIENT'S language."
                        : "No available time slots in this period.",
                },
                slots,
            };
        }

        case "buscar_meus_agendamentos": {
            const patient = await findPatient(supabase, tenantId, phone);
            if (!patient) return { data: { appointments: [], note: "Patient has no record at this clinic yet. Reply in the PATIENT'S language." } };

            const { data, error } = await supabase
                .from("appointments")
                .select("id, date, start_time, status, doctors:doctor_id(full_name), appointment_types:type_id(name), location_id")
                .eq("tenant_id", tenantId)
                .eq("patient_id", patient.id)
                .gte("date", todayInTz())
                .not("status", "in", '("canceled","cancelled","noshow","no_show")')
                .order("date", { ascending: true })
                .limit(5);
            if (error) return { data: { error: error.message } };
            return { data: { appointments: data || [] } };
        }

        case "agendar": {
            const patient = await ensurePatient(supabase, tenantId, phone, input.patient_name || patientDisplayName);
            if (!patient) return { data: { success: false, error: "patient_create_failed" } };

            const { data, error } = await supabase.rpc("book_appointment", {
                p_tenant_id: tenantId,
                p_patient_id: patient.id,
                p_doctor_id: input.doctor_id,
                p_location_id: input.location_id,
                p_type_id: input.type_id || null,
                p_date: input.date,
                p_start_time: input.start_time,
                p_booked_by: "ai_agent",
            });
            if (error) return { data: { success: false, error: error.message } };
            return { data };
        }

        case "remarcar": {
            const patient = await findPatient(supabase, tenantId, phone);
            if (!patient) return { data: { success: false, error: "patient_not_found" } };

            // Anti-double-booking primeiro: garante o novo horário antes de liberar o antigo
            const { data: booked, error: bookErr } = await supabase.rpc("book_appointment", {
                p_tenant_id: tenantId,
                p_patient_id: patient.id,
                p_doctor_id: input.doctor_id,
                p_location_id: input.location_id,
                p_type_id: null,
                p_date: input.date,
                p_start_time: input.start_time,
                p_booked_by: "ai_agent",
            });
            if (bookErr) return { data: { success: false, error: bookErr.message } };
            if (!(booked as any)?.success) return { data: booked };

            const { error: cancelErr } = await supabase
                .from("appointments")
                .update({ status: "canceled" })
                .eq("id", input.appointment_id)
                .eq("tenant_id", tenantId)
                .eq("patient_id", patient.id);
            if (cancelErr) console.warn(`[schedulingTools] remarcar: novo horário criado mas falha ao cancelar o antigo: ${cancelErr.message}`);

            return { data: { success: true, rescheduled: true, new_appointment: booked } };
        }

        default:
            return { data: { error: `unknown_tool:${call.name}` } };
    }
}

// ─── Paciente ────────────────────────────────────────────────────────────────

async function findPatient(supabase: SupabaseClient, tenantId: string, phone: string): Promise<{ id: string } | null> {
    const { data } = await supabase
        .from("patients")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone", phone)
        .maybeSingle();
    return data as any;
}

export async function ensurePatient(
    supabase: SupabaseClient,
    tenantId: string,
    phone: string,
    name?: string | null,
): Promise<{ id: string } | null> {
    const existing = await findPatient(supabase, tenantId, phone);
    if (existing) return existing;

    const { data, error } = await supabase
        .from("patients")
        .insert({ tenant_id: tenantId, phone, full_name: name?.trim() || "Paciente WhatsApp" })
        .select("id")
        .single();
    if (error) {
        console.error(`[schedulingTools] ensurePatient falhou: ${error.message}`);
        return null;
    }
    return data as any;
}

// ─── Mensagens determinísticas (caminho do clique — sem LLM) ─────────────────

export const SLOT_CONFIRM_MSG: Record<string, (date: string, time: string) => string> = {
    pt: (d, t) => `Prontinho! Sua consulta está agendada para ${d} às ${t}. ✅\nQualquer coisa até lá, é só chamar por aqui!`,
    en: (d, t) => `All set! Your appointment is booked for ${d} at ${t}. ✅\nIf you need anything before then, just message us here!`,
    es: (d, t) => `¡Listo! Su cita quedó agendada para el ${d} a las ${t}. ✅\n¡Cualquier cosa hasta entonces, escríbanos por aquí!`,
};

export const SLOT_TAKEN_MSG: Record<string, string> = {
    pt: "Poxa, esse horário acabou de ser preenchido! 😅 Me diga qual período prefere que eu já verifico outras opções para você.",
    en: "Oh no, that time slot was just taken! 😅 Let me know your preferred time of day and I'll check other options for you.",
    es: "¡Vaya, ese horario acaba de ocuparse! 😅 Dígame qué período prefiere y ya le busco otras opciones.",
};

/** Vaga de lista de espera confirmada por outro paciente antes desta resposta. */
export const WAITLIST_TAKEN_MSG: Record<string, string> = {
    pt: "Poxa, essa vaga acabou de ser confirmada por outra pessoa da fila! 😅 Nossa equipe já vai te avisar assim que surgir outra oportunidade.",
    en: "Oh no, that spot was just confirmed by someone else on the waitlist! 😅 Our team will let you know as soon as another opening comes up.",
    es: "¡Vaya, ese cupo acaba de ser confirmado por otra persona de la lista! 😅 Nuestro equipo le avisará en cuanto surja otra oportunidad.",
};

export const AFTER_HOURS_CANCEL_MSG: Record<string, string> = {
    pt: "Entendi! Como estamos fora do horário de atendimento, nossa equipe vai te retornar assim que possível para cuidar disso com você, tá bem? 💙",
    en: "Got it! Since we're outside business hours right now, our team will get back to you as soon as possible to take care of this for you. 💙",
    es: "¡Entendido! Como estamos fuera del horario de atención, nuestro equipo le responderá lo antes posible para resolverlo con usted. 💙",
};

/** Formata YYYY-MM-DD para exibição amigável por idioma. */
export function formatDateForPatient(date: string, language: string): string {
    const [y, m, d] = date.split("-");
    if (language === "en") return `${m}/${d}/${y}`;
    return `${d}/${m}/${y}`;
}
