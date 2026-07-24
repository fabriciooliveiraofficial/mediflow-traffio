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
 *     → {success, appointment_id} | {success:false, reason:BOOKING_REASON.*}
 *
 * Os horários oferecidos viram BOTÕES CLICÁVEIS (id determinístico "slot|...")
 * — o clique é agendado sem passar pelo modelo (caminho 100% determinístico).
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import type { LlmTool, LlmToolCall } from "./llmProvider.ts";

/** P-04: ponto único para SELECTs de tabelas multi-tenant. */
function scopedQuery(supabase: SupabaseClient, table: string, tenantId: string, columns: string): any {
    return supabase.from(table).select(columns).eq("tenant_id", tenantId);
}

/** Autorização explícita para mutações; mídia marcada nunca autoriza por si só. */
export function isAffirmativeChoice(lastPatientMessage: string): boolean {
    const text = (lastPatientMessage || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    if (!text || text.startsWith("[conteudo de midia do paciente")) return false;
    if (/\b(talvez|acho que|pode ser que|vou ver|depois (eu )?confirmo|maybe|i(?:'|’)ll see|quizas|quiza|voy a ver|luego confirmo)\b/i.test(text)) return false;
    return /^(?:sim|yes|si|confirmo|confirm|fechado|combinado|book it|pode ser(?:\s+(?:as?\s*)?\d|\s+(?:esse|essa|este|esta))?|esse|essa|este|esta|o das?\s+\d{1,2}(?::\d{2})?|(?:as?\s*)?\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|h))?|[1-9][.)]?)\b/i.test(text);
}

// ─── Horário de atendimento humano do tenant ─────────────────────────────────

export type ConversationLanguage = "pt" | "en" | "es";

export interface SlotPresentationOptions {
    clock: TenantClock;
    language: ConversationLanguage;
}

export function formatSlotTimeForPatient(time: string, timeFormat: TenantTimeFormat): string {
    if (timeFormat !== "12h") return time;
    const [hStr, mStr] = time.split(":");
    let h = parseInt(hStr, 10);
    if (isNaN(h)) return time;
    const suffix = h >= 12 ? "pm" : "am";
    h = h % 12;
    if (h === 0) h = 12;
    const hFormatted = String(h).padStart(2, "0");
    return `${hFormatted}:${mStr} ${suffix}`;
}

function getRelativeDayLabel(dateStr: string, todayStr: string, language: ConversationLanguage): string | null {
    if (!dateStr || !todayStr) return null;
    const d = new Date(dateStr + "T00:00:00Z");
    const t = new Date(todayStr + "T00:00:00Z");
    if (isNaN(d.getTime()) || isNaN(t.getTime())) return null;
    const diffMs = d.getTime() - t.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        if (language === "en") return "today";
        if (language === "es") return "hoy";
        return "hoje";
    }
    if (diffDays === 1) {
        if (language === "en") return "tomorrow";
        if (language === "es") return "mañana";
        return "amanhã";
    }
    if (diffDays >= 2 && diffDays <= 6) {
        const dayIndex = d.getUTCDay();
        const daysOfWeek: Record<ConversationLanguage, string[]> = {
            en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
            pt: ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"],
            es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
        };
        return daysOfWeek[language]?.[dayIndex] || null;
    }
    return null;
}

/**
 * Formata a disponibilidade para o paciente, pronta para o modelo COPIAR no texto.
 * Nunca inventa horário: recebe exatamente o que veio de fetchAvailableSlotsMulti.
 */
export function formatSlotsForPatient(
    available: { date: string; location: string; professional: string; slots: { time: string; slot_id: string }[] }[],
    opts: SlotPresentationOptions,
): string {
    if (!available || available.length === 0) return "";

    const dayBlocks: string[] = [];

    for (const group of available) {
        if (!group.slots || group.slots.length === 0) continue;
        const relativeLabel = getRelativeDayLabel(group.date, opts.clock.today, opts.language);
        const formattedDate = formatDateForPatient(group.date, opts.language);
        const header = relativeLabel
            ? `${relativeLabel} 📅 ${formattedDate}`
            : `📅 ${formattedDate}`;

        const slotLines = group.slots.map(
            s => `🕛${formatSlotTimeForPatient(s.time, opts.clock.timeFormat)}`
        );

        dayBlocks.push(`${header}\n${slotLines.join("\n")}`);
    }

    return dayBlocks.join("\n\n");
}

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

/** Hora atual (HH:MM) no fuso do tenant. */
export function nowInTz(timezone?: string): string {
    try {
        return new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone || "America/Sao_Paulo",
            hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(new Date());
    } catch {
        return new Date().toISOString().substring(11, 16);
    }
}

// ─── Relógio local da clínica ────────────────────────────────────────────────
// Bug de produção (2026-07-16, tenant Pacific/Auckland): sem o relógio LOCAL,
// o RPC filtrava "passado" pela data UTC do servidor e oferecia horários que já
// tinham passado na clínica. TODA consulta de disponibilidade passa por aqui.

export type TenantTimeFormat = "12h" | "24h";

const COUNTRY_DISPLAY_DEFAULTS: Record<string, { locale: string; timeFormat: TenantTimeFormat }> = {
    BR: { locale: "pt-BR", timeFormat: "24h" },
    US: { locale: "en-US", timeFormat: "12h" },
    NZ: { locale: "en-NZ", timeFormat: "12h" },
    MX: { locale: "es-MX", timeFormat: "24h" },
};

/** Locale de apresentacao do tenant, com fallback igual ao painel web. */
export function resolveTenantLocale(locale?: string | null, country?: string | null): string {
    const configured = String(locale || "").trim();
    if (configured) return configured;
    return COUNTRY_DISPLAY_DEFAULTS[String(country || "").toUpperCase()]?.locale || "pt-BR";
}

/** Retorna o formato configurado ou o padrao de exibicao do pais do tenant. */
export function resolveTenantTimeFormat(
    timeFormat?: string | null,
    country?: string | null,
    locale?: string | null,
): TenantTimeFormat {
    if (timeFormat === "12h" || timeFormat === "24h") return timeFormat;

    const countryDefault = COUNTRY_DISPLAY_DEFAULTS[String(country || "").toUpperCase()];
    if (countryDefault) return countryDefault.timeFormat;

    const normalizedLocale = String(locale || "").toLowerCase();
    return /^(en-us|en-nz)(?:-|$)/.test(normalizedLocale) ? "12h" : "24h";
}

export interface TenantClock {
    timezone: string;
    timeFormat: TenantTimeFormat;
    locale: string;
    /** "Hoje" no fuso da clínica (YYYY-MM-DD) */
    today: string;
    /** Agora no fuso da clínica (HH:MM) */
    nowHHMM: string;
    /** Antecedência mínima de agendamento (Settings > Clínicas) */
    bufferMinutes: number;
}

export async function getTenantClock(supabase: SupabaseClient, tenantId: string): Promise<TenantClock> {
    // Exceção intencional: tenants é a própria raiz do escopo e não possui tenant_id.
    const { data } = await supabase
        .from("tenants")
        .select("timezone, booking_min_lead_minutes, time_format, locale, country")
        .eq("id", tenantId)
        .maybeSingle();
    const timezone = String((data as any)?.timezone || "America/Sao_Paulo");
    const locale = resolveTenantLocale((data as any)?.locale, (data as any)?.country);
    const timeFormat = resolveTenantTimeFormat((data as any)?.time_format, (data as any)?.country, locale);
    return {
        timezone,
        timeFormat,
        locale,
        today: todayInTz(timezone),
        nowHHMM: nowInTz(timezone),
        bufferMinutes: (data as any)?.booking_min_lead_minutes ?? 30,
    };
}

/** Nunca consultar datas no passado local — o modelo pode enviar uma data velha. */
export function effectiveFromDate(requested: string | null | undefined, today: string): string {
    return requested && requested >= today ? requested : today;
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

/**
 * Motivos que o RPC book_appointment devolve em `reason` quando `success:false`
 * (migrations/20260626120000_book_appointment_hardening.sql, versão consolidada
 * e única em produção). Ponto único: qualquer consumidor do RPC (agendar,
 * remarcar, clique determinístico em structuredFlow.ts) compara contra ESTA
 * constante — nunca contra uma string solta hardcoded.
 *
 * Bug de produção (2026-07-23): a checagem de idempotência abaixo comparava
 * `reason === "slot_taken"`, uma string de uma versão ANTIGA da função
 * (migration 05). A versão consolidada nunca devolve isso — devolve
 * 'SLOT_CONFLICT'/'OUTSIDE_AVAILABILITY' — então a checagem nunca disparava:
 * um "confirmo" duplicado (retry, doble clique) do PRÓPRIO paciente virava
 * "esse horário acabou de ser preenchido" mesmo quando a vaga já era dele,
 * gerando confusão e a percepção de sistema quebrado que o paciente reportava.
 */
export const BOOKING_REASON = {
    SLOT_CONFLICT: "SLOT_CONFLICT",
    OUTSIDE_AVAILABILITY: "OUTSIDE_AVAILABILITY",
} as const;

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

/**
 * true a menos que o RPC marque explicitamente o slot como ocupado.
 * Bug de produção (2026-07-23): find_next_available_dates já calcula a
 * ocupação real (overlap contra `appointments`) e devolve `available:false`
 * por slot dentro do array `slots` — o HAVING da query só garante que a DATA
 * tenha ao menos 1 horário livre, não que TODOS os slots do array estejam
 * livres. O consumidor lia apenas o horário (normalizeSlotTime) e ignorava a
 * flag, oferecendo horários OCUPADOS como botão clicável para o paciente —
 * a raiz da cascata de falhas de agendamento. Formas antigas (string pura,
 * sem a flag) continuam tratadas como disponíveis por retrocompatibilidade.
 */
export function isSlotAvailable(raw: unknown): boolean {
    if (raw && typeof raw === "object") {
        const o = raw as any;
        if (o.available === false) return false;
    }
    return true;
}

/**
 * TTL dos botões de horário oferecidos (E3, 2026-07-24). Evidência de
 * produção: sessão achada com `pending_slots` de mais de 1h contendo
 * EXATAMENTE os horários que, nesse meio-tempo, outra pessoa já havia
 * reservado — um dígito ("1") ou título tardio casaria contra uma lista
 * morta. Sem timestamp (sessão de antes deste deploy) conta como vencido —
 * mais seguro deixar o LLM reconduzir do que casar por índice às cegas.
 * Só afeta o casamento por DÍGITO/TÍTULO: um clique CRU em "slot|..." sempre
 * revalida no RPC atômico, TTL ou não.
 */
export const PENDING_SLOTS_TTL_MS = 60 * 60 * 1000;

export function isPendingSlotsFresh(pendingSlotsAt: string | null | undefined): boolean {
    if (!pendingSlotsAt) return false;
    const t = new Date(pendingSlotsAt).getTime();
    return Number.isFinite(t) && (Date.now() - t) <= PENDING_SLOTS_TTL_MS;
}

// Rótulos do payload interativo por idioma da CONVERSA (não do tenant) —
// "Ver horários" num chat em inglês é deriva de idioma tão grave quanto no texto.
const SLOT_UI_LABELS: Record<string, { header: string; buttonText: string; sectionTitle: string }> = {
    pt: { header: "Horários", buttonText: "Ver horários", sectionTitle: "Horários disponíveis" },
    en: { header: "Time slots", buttonText: "See times", sectionTitle: "Available times" },
    es: { header: "Horarios", buttonText: "Ver horarios", sectionTitle: "Horarios disponibles" },
};

/** Payload interativo (≤3 slots = botões; mais = lista) — o dispatcher tem fallback texto. */
export function buildSlotInteractive(slots: SlotOption[], language: string = "pt"): any {
    if (slots.length <= 3) {
        return { type: "button", buttons: slots.map(s => ({ id: s.id, title: s.title })) };
    }
    const labels = SLOT_UI_LABELS[language] || SLOT_UI_LABELS.pt;
    return {
        type: "list",
        header: labels.header,
        buttonText: labels.buttonText,
        sections: [{
            title: labels.sectionTitle,
            rows: slots.map(s => ({ id: s.id, title: s.title, description: s.description })),
        }],
    };
}

/**
 * Normaliza string para comparação de títulos: trim, lowercase, remove acentos,
 * colapsa espaços múltiplos e substitui separadores comuns (·, -, |) por espaço.
 * Se o texto contiver quebras de linha ("titulo\ndescricao"), considera apenas a 1ª linha.
 */
function normalizeTitleString(str: string): string {
    const firstLine = str.split(/\r?\n/)[0] || "";
    return firstLine
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[·\-\|]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Deriva um título visual padrão ("DD/MM · HH:MM") a partir do slot_id ("slot|doctor|loc|type|YYYY-MM-DD|HH:MM").
 */
function deriveTitleFromSlotId(slotIdStr: string): string | null {
    const parsed = parseSlotClick(slotIdStr);
    if (!parsed) return null;
    const parts = parsed.date.split("-");
    if (parts.length !== 3) return null;
    const [, month, day] = parts;
    return `${day}/${month} · ${parsed.time}`;
}

/**
 * Casa o rótulo visível do slot ("22/07 · 08:30") com o slot_id oferecido.
 */
export function resolveSlotIdByTitle(
    text: string | null | undefined,
    pendingSlots: string[] | undefined,
    pendingTitles: string[] | undefined,
): string | null {
    if (!text || !Array.isArray(pendingSlots) || pendingSlots.length === 0) {
        return null;
    }

    const normText = normalizeTitleString(text);
    if (!normText) return null;

    for (let i = 0; i < pendingSlots.length; i++) {
        const slotIdStr = pendingSlots[i];
        let titleToMatch = pendingTitles && pendingTitles[i] ? pendingTitles[i] : null;
        if (!titleToMatch) {
            titleToMatch = deriveTitleFromSlotId(slotIdStr);
        }
        if (titleToMatch) {
            const normTitle = normalizeTitleString(titleToMatch);
            if (normTitle === normText) {
                return slotIdStr;
            }
        }
    }

    return null;
}

/**
 * Consulta o RPC find_next_available_dates e monta os SlotOption clicáveis.
 * Extraído do case 'ver_disponibilidade' para ser reutilizável fora do formato
 * de tool-call do LLM (usado também pelo F2 — respostas determinísticas de recovery).
 */
export async function fetchAvailableSlots(
    supabase: SupabaseClient,
    tenantId: string,
    doctorId: string,
    fromDate: string | undefined,
    durationMinutes: number,
    typeId: string | null = null,
    clock: TenantClock | null = null,
): Promise<{ slots: SlotOption[]; availableForModel: { date: string; location: string; slots: string[] }[]; error?: string }> {
    // O RPC não recebe tenant_id: doctor_id só o alcança após reautorização.
    const { data: scopedDoctor } = await scopedQuery(supabase, "doctors", tenantId, "id")
        .eq("id", doctorId).eq("is_active", true).limit(1);
    if (!(scopedDoctor as any[])?.length) return { slots: [], availableForModel: [], error: "doctor_outside_tenant" };
    // Relógio LOCAL da clínica: nunca oferecer passado, respeitar antecedência mínima
    const fromEff = clock ? effectiveFromDate(fromDate, clock.today) : fromDate;
    const { data, error } = await supabase.rpc("find_next_available_dates", {
        p_doctor_id: doctorId,
        p_from_date: fromEff,
        p_limit: 2,
        p_duration_minutes: durationMinutes,
        ...(clock ? {
            p_current_time: fromEff === clock.today ? clock.nowHHMM : null,
            p_buffer_minutes: clock.bufferMinutes,
        } : {}),
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
            .filter((s: unknown) => isSlotAvailable(s))
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

// ─── Procedure-first: o paciente compra o PROCEDIMENTO, o sistema resolve o
// profissional ─────────────────────────────────────────────────────────────────
// Regra de produto (2026-07-16): nunca perguntar "qual profissional?" a quem não
// pediu — o paciente não conhece a equipe. O agente resolve procedimento →
// profissionais habilitados (doctor_services) → disponibilidade agregada.

export type DayPeriod = "morning" | "afternoon" | "evening";

/** Filtro de período no fuso do paciente: manhã <12h, tarde 12-18h, noite ≥18h. */
export function timeMatchesPeriod(time: string, period?: DayPeriod | null): boolean {
    if (!period) return true;
    const hour = parseInt(time.split(":")[0], 10);
    if (period === "morning") return hour < 12;
    if (period === "afternoon") return hour >= 12 && hour < 18;
    return hour >= 18;
}

/** Resolve um serviço pelo nome como o paciente falou (match parcial, case-insensitive). */
export async function resolveServiceByName(
    supabase: SupabaseClient,
    tenantId: string,
    procedure: string,
): Promise<{ id: string; name: string; duration_minutes: number | null } | null> {
    const term = procedure?.trim();
    if (!term) return null;
    const { data } = await scopedQuery(supabase, "appointment_types", tenantId, "id, name, duration_minutes")
        .eq("is_active", true)
        .ilike("name", `%${term}%`)
        .limit(1);
    if (data?.length) return data[0] as any;
    // Fallback: primeira palavra significativa (ex.: "dental implant" → "implant")
    const words = term.split(/\s+/).filter(w => w.length >= 4);
    for (const w of words) {
        const { data: d2 } = await scopedQuery(supabase, "appointment_types", tenantId, "id, name, duration_minutes")
            .eq("is_active", true)
            .ilike("name", `%${w}%`)
            .limit(1);
        if (d2?.length) return d2[0] as any;
    }
    return null;
}

/** Profissionais ativos que realizam o serviço (doctor_services). Vazio = sem vínculo cadastrado. */
export async function doctorsForService(
    supabase: SupabaseClient,
    tenantId: string,
    serviceId: string,
): Promise<{ id: string; full_name: string }[]> {
    const { data } = await scopedQuery(supabase, "doctor_services", tenantId, "doctor_id, doctors:doctor_id(id, full_name, is_active)")
        .eq("service_id", serviceId);
    return (data || [])
        .map((r: any) => r.doctors)
        .filter((d: any) => d && d.is_active !== false)
        .map((d: any) => ({ id: d.id, full_name: d.full_name }));
}

async function activeDoctors(supabase: SupabaseClient, tenantId: string): Promise<{ id: string; full_name: string }[]> {
    const { data } = await scopedQuery(supabase, "doctors", tenantId, "id, full_name")
        .eq("is_active", true)
        .limit(20);
    return (data || []) as any;
}

/**
 * Disponibilidade agregada de vários profissionais, com filtro de período.
 * Mescla por data+hora (mais cedo primeiro), dedupe do mesmo horário entre
 * profissionais, e devolve o nome do profissional por slot para o modelo —
 * que só o menciona se o paciente perguntar (a confirmação sempre menciona).
 */
export async function fetchAvailableSlotsMulti(
    supabase: SupabaseClient,
    tenantId: string,
    doctors: { id: string; full_name: string }[],
    fromDate: string | undefined,
    durationMinutes: number,
    typeId: string | null,
    period?: DayPeriod | null,
    clock: TenantClock | null = null,
): Promise<{ slots: SlotOption[]; availableForModel: { date: string; location: string; professional: string; slots: { time: string; slot_id: string }[] }[]; errors: string[] }> {
    const results = await Promise.all(
        doctors.map(d => fetchAvailableSlots(supabase, tenantId, d.id, fromDate, durationMinutes, typeId, clock)
            .then(r => ({ doctor: d, ...r }))
            .catch((e: any) => ({ doctor: d, slots: [] as SlotOption[], availableForModel: [], error: String(e?.message || e) }))),
    );

    const errors = results.map(r => (r as any).error).filter(Boolean);
    const merged = results
        .flatMap(r => r.slots.map(s => ({ slot: s, doctor: r.doctor })))
        .filter(x => timeMatchesPeriod(x.slot.time, period))
        .sort((a, b) => (a.slot.date + a.slot.time).localeCompare(b.slot.date + b.slot.time));

    const seen = new Set<string>();
    const picked: { slot: SlotOption; doctor: { id: string; full_name: string } }[] = [];
    for (const x of merged) {
        const key = `${x.slot.date}|${x.slot.time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        picked.push(x);
        if (picked.length >= MAX_SLOT_OPTIONS) break;
    }

    // slot_id incluído POR HORÁRIO: é a referência que o modelo copia para
    // `agendar` quando o paciente escolhe por TEXTO em vez de clicar no botão.
    // Sem isso o modelo não tem doctor_id/location_id e trava sem conseguir
    // agendar (visto em produção 2026-07-16: 4 rounds estourados → handoff).
    const availableForModel: { date: string; location: string; professional: string; slots: { time: string; slot_id: string }[] }[] = [];
    for (const x of picked) {
        const loc = x.slot.description || "";
        let group = availableForModel.find(g => g.date === x.slot.date && g.professional === x.doctor.full_name);
        if (!group) {
            group = { date: x.slot.date, location: loc, professional: x.doctor.full_name, slots: [] };
            availableForModel.push(group);
        }
        group.slots.push({ time: x.slot.time, slot_id: x.slot.id });
    }

    return { slots: picked.map(x => x.slot), availableForModel, errors };
}

/**
 * Alternativas FRESCAS para reofertar quando um agendamento colide com outro
 * paciente (E4, 2026-07-24) — "esse horário foi preenchido" nunca fica sem
 * próximo passo. Primeiro tenta o MESMO profissional a partir da data
 * conflitada; se vazio e o procedimento é conhecido (type_id), expande para
 * outros profissionais que realizam o mesmo serviço. Sempre via
 * fetchAvailableSlotsMulti — mesmo caminho de `ver_disponibilidade` — mesmo
 * para 1 profissional só, porque é a única forma cujo `availableForModel`
 * bate com `formatSlotsForPatient` (a forma de `fetchAvailableSlots` sozinha,
 * por profissional único, tem shape diferente e não alimenta texto ao paciente
 * em nenhum outro lugar do código).
 */
export async function findConflictAlternatives(
    supabase: SupabaseClient,
    tenantId: string,
    doctorId: string,
    typeId: string | null,
    conflictedDate: string,
    conflictedTime: string,
    clock: TenantClock,
): Promise<{ slots: SlotOption[]; availableForModel: { date: string; location: string; professional: string; slots: { time: string; slot_id: string }[] }[] }> {
    let duration = 30;
    if (typeId) {
        const { data: svc } = await scopedQuery(supabase, "appointment_types", tenantId, "duration_minutes").eq("id", typeId).maybeSingle();
        if ((svc as any)?.duration_minutes) duration = (svc as any).duration_minutes;
    }

    // Defensivo: a busca já roda DEPOIS do conflito (a vaga tomada já está no
    // banco), então o RPC normalmente já a exclui sozinho — mas nunca confiar
    // só nisso para o horário que acabou de falhar.
    const excludeConflicted = (s: SlotOption) => !(s.date === conflictedDate && s.time === conflictedTime && s.doctor_id === doctorId);
    const pruneAvailableForModel = (rows: { date: string; location: string; professional: string; slots: { time: string; slot_id: string }[] }[]) =>
        rows
            .map(g => (g.date === conflictedDate ? { ...g, slots: g.slots.filter(s => s.time !== conflictedTime) } : g))
            .filter(g => g.slots.length > 0);

    const { data: doc } = await scopedQuery(supabase, "doctors", tenantId, "id, full_name").eq("id", doctorId).maybeSingle();
    const primaryDoctors = doc ? [doc as any] : [];
    let result = primaryDoctors.length
        ? await fetchAvailableSlotsMulti(supabase, tenantId, primaryDoctors, conflictedDate, duration, typeId, null, clock)
        : { slots: [] as SlotOption[], availableForModel: [] as { date: string; location: string; professional: string; slots: { time: string; slot_id: string }[] }[], errors: [] as string[] };
    let slots = result.slots.filter(excludeConflicted);
    let availableForModel = pruneAvailableForModel(result.availableForModel);

    if (!slots.length && typeId) {
        const performers = await doctorsForService(supabase, tenantId, typeId);
        if (performers.length) {
            result = await fetchAvailableSlotsMulti(supabase, tenantId, performers, conflictedDate, duration, typeId, null, clock);
            slots = result.slots.filter(excludeConflicted);
            availableForModel = pruneAvailableForModel(result.availableForModel);
        }
    }

    return { slots, availableForModel };
}

// ─── Definições das ferramentas ──────────────────────────────────────────────

export const SCHEDULING_TOOLS: LlmTool[] = [
    {
        name: "listar_profissionais",
        description: "Lista os profissionais da clínica e quais procedimentos cada um realiza. NÃO é necessária para consultar disponibilidade (ver_disponibilidade resolve o profissional sozinha). Use apenas quando o paciente perguntar quem atende ou pedir um profissional específico pelo nome.",
        input_schema: { type: "object", properties: {} },
    },
    {
        name: "atualizar_cadastro_paciente",
        description: "Cria ou atualiza a ficha do paciente desta conversa. Use assim que souber o nome completo — SEMPRE antes de agendar. O telefone já é conhecido pelo sistema; nunca peça telefone, CPF, RG ou documento.",
        input_schema: {
            type: "object",
            properties: {
                full_name: { type: "string", description: "Nome completo de quem será atendido, como o paciente informou." },
                email:     { type: "string", description: "E-mail, se o paciente informar espontaneamente ou aceitar dar. Opcional." },
                birth_date:{ type: "string", description: "Data de nascimento YYYY-MM-DD, se informada. Opcional." },
                notes:     { type: "string", description: "Observação clínica/contextual relevante dita pelo paciente (ex.: 'tem medo de dentista', 'dente quebrou ontem'). Opcional." },
            },
            required: ["full_name"],
        },
    },
    {
        name: "adicionar_lista_espera",
        description: "Coloca o paciente na lista de espera para ser avisado assim que abrir um horário. Use SEMPRE que não houver horário disponível, ou quando nenhum dos horários oferecidos servir para o paciente — nunca encerre a conversa sem oferecer esta alternativa.",
        input_schema: {
            type: "object",
            properties: {
                procedure:        { type: "string", description: "Procedimento desejado, como o paciente falou." },
                preferred_period: { type: "string", enum: ["morning", "afternoon", "evening", "any"], description: "Período preferido do paciente." },
                notes:            { type: "string", description: "Restrição relevante dita pelo paciente (ex.: 'só consigo sexta', 'depois das 17h'). Opcional." },
            },
            required: [],
        },
    },
    {
        name: "ver_disponibilidade",
        description: "Consulta os horários REAIS disponíveis. Informe o PROCEDIMENTO que o paciente deseja — o sistema encontra automaticamente os profissionais que o realizam e agrega a disponibilidade. NÃO pergunte ao paciente qual profissional ele prefere; só passe doctor_id se o paciente pediu alguém específico pelo nome. Os horários retornados viram botões clicáveis automaticamente — apresente-os brevemente no texto.",
        input_schema: {
            type: "object",
            properties: {
                procedure: { type: "string", description: "Procedimento desejado, como o paciente falou (ex.: 'implante', 'limpeza', 'clareamento')" },
                period: { type: "string", enum: ["morning", "afternoon", "evening"], description: "Período preferido pelo paciente, se ele indicou" },
                doctor_id: { type: "string", description: "SOMENTE se o paciente pediu um profissional específico pelo nome (id de listar_profissionais)" },
                from_date: { type: "string", description: "Data inicial YYYY-MM-DD (default: hoje)" },
                type_id: { type: "string", description: "ID do serviço, se já conhecido" },
            },
            required: [],
        },
    },
    {
        name: "buscar_meus_agendamentos",
        description: "Busca os agendamentos futuros do paciente desta conversa. Use para consultar ou antes de remarcar.",
        input_schema: { type: "object", properties: {} },
    },
    {
        name: "agendar",
        description: "Agenda uma consulta em um horário confirmado pelo paciente. Caminho preferido: passe o slot_id EXATO retornado por ver_disponibilidade (copie a string inteira). Alternativa: doctor_id + location_id + date + start_time, também vindos de ferramenta — nunca invente valores.",
        input_schema: {
            type: "object",
            properties: {
                slot_id: { type: "string", description: "slot_id exato de ver_disponibilidade (formato 'slot|...') — contém tudo que o agendamento precisa" },
                doctor_id: { type: "string" },
                location_id: { type: "string" },
                date: { type: "string", description: "YYYY-MM-DD" },
                start_time: { type: "string", description: "HH:MM" },
                type_id: { type: "string", description: "ID do serviço (opcional)" },
                patient_name: { type: "string", description: "Nome de quem SERÁ ATENDIDO. OBRIGATÓRIO quando a consulta é para outra pessoa (filho, cônjuge, parente — pergunte o nome completo antes) ou quando houver mais de um paciente neste número. Passe o NOME PRÓPRIO, nunca o parentesco ('minha filha' não é nome)." },
            },
            required: [],
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
    lastPatientMessage: string = "",
    language: ConversationLanguage = "pt",
): Promise<ToolExecOutcome> {
    const input = (call.input || {}) as any;

    switch (call.name) {
        case "listar_profissionais": {
            const { data, error } = await scopedQuery(supabase, "doctors", tenantId, "id, full_name, specialty, doctor_services(appointment_types:service_id(name))")
                .eq("is_active", true)
                .limit(20);
            if (error) return { data: { error: error.message } };
            const professionals = (data || []).map((d: any) => ({
                id: d.id,
                full_name: d.full_name,
                specialty: d.specialty || undefined,
                performs: (d.doctor_services || [])
                    .map((s: any) => s.appointment_types?.name)
                    .filter(Boolean),
            }));
            return { data: { professionals } };
        }

        case "atualizar_cadastro_paciente": {
            const fullName = String(input.full_name || "").trim();
            if (!plausiblePersonName(fullName)) {
                return {
                    data: {
                        success: false,
                        error: "invalid_name",
                        note: "Ask for the person's actual full name.",
                    },
                };
            }

            const canonicalPhone = canonicalizePhone(phone) || phone;
            const existing = await findPatient(supabase, tenantId, phone);

            if (existing) {
                const updateData: Record<string, any> = { full_name: fullName };
                if (input.email?.trim()) updateData.email = input.email.trim();
                if (input.birth_date?.trim()) updateData.birth_date = input.birth_date.trim();
                if (input.notes?.trim()) updateData.notes = input.notes.trim();

                const { error } = await supabase
                    .from("patients")
                    .update(updateData)
                    .eq("id", existing.id)
                    .eq("tenant_id", tenantId);

                if (error) return { data: { success: false, error: error.message } };
                return { data: { success: true, patient_id: existing.id, created: false } };
            } else {
                const insertData: Record<string, any> = {
                    tenant_id: tenantId,
                    phone: canonicalPhone,
                    full_name: fullName,
                };
                if (input.email?.trim()) insertData.email = input.email.trim();
                if (input.birth_date?.trim()) insertData.birth_date = input.birth_date.trim();
                if (input.notes?.trim()) insertData.notes = input.notes.trim();

                const { data: created, error } = await supabase
                    .from("patients")
                    .insert(insertData)
                    .select("id")
                    .single();

                if (error) return { data: { success: false, error: error.message } };
                return { data: { success: true, patient_id: (created as any)?.id, created: true } };
            }
        }

        case "adicionar_lista_espera": {
            const patient = await findPatient(supabase, tenantId, phone);
            let patName = "";
            if (patient) {
                const { data: patData } = await scopedQuery(supabase, "patients", tenantId, "full_name")
                    .eq("id", patient.id)
                    .maybeSingle();
                patName = (patData as any)?.full_name?.trim() || "";
            }
            if (!patient || !patName || patName === "Paciente WhatsApp" || !bookingGradeName(patName)) {
                return {
                    data: {
                        success: false,
                        error: "patient_not_registered",
                        note: "Before adding to waitlist, ask the patient's FULL name (first + last) in a natural, warm way and call atualizar_cadastro_paciente. Then call adicionar_lista_espera again.",
                    },
                };
            }

            let doctorId: string | null = null;
            let service: { id: string; name: string } | null = null;
            if (input.procedure) {
                service = await resolveServiceByName(supabase, tenantId, input.procedure);
                if (service) {
                    const doctors = await doctorsForService(supabase, tenantId, service.id);
                    if (doctors.length > 0) doctorId = doctors[0].id;
                }
            }

            // Não tenta fallback para médico arbitrário (evita cadastrar médico errado).
            // Se doctorId não for resolvido a partir do procedimento, retorna erro.
            if (!doctorId) {
                return {
                    data: {
                        success: false,
                        error: "no_doctor_available",
                        note: "Could not resolve a professional for this procedure. Offer to transfer to human.",
                    },
                };
            }

            // Schema real da tabela waitlist (lido por process-waitlist/index.ts):
            // tenant_id, patient_id, doctor_id, type_id, preferred_days (null = qualquer dia), status ('waiting')
            const { data: createdWaitlist, error: waitlistErr } = await supabase
                .from("waitlist")
                .insert({
                    tenant_id: tenantId,
                    patient_id: patient.id,
                    doctor_id: doctorId,
                    type_id: service?.id ?? null,
                    preferred_days: null,
                    status: "waiting",
                })
                .select("id")
                .single();

            if (waitlistErr) return { data: { success: false, error: waitlistErr.message } };

            return {
                data: {
                    success: true,
                    waitlist_id: (createdWaitlist as any)?.id,
                    note: "Confirm warmly that the patient is on the waitlist and will be notified as soon as a slot opens. Reply in the PATIENT'S language.",
                },
            };
        }

        case "ver_disponibilidade": {
            // Guard N1: Verificar se já sabemos o nome do lead antes de ofertar horários
            const existingPatient = await findPatient(supabase, tenantId, phone);
            let knownName: string | null = null;
            if (existingPatient) {
                const { data: patData } = await scopedQuery(supabase, "patients", tenantId, "full_name")
                    .eq("id", existingPatient.id)
                    .maybeSingle();
                if ((patData as any)?.full_name) {
                    knownName = (patData as any).full_name;
                }
            }
            if (!knownName && patientDisplayName && bookingGradeName(patientDisplayName)) {
                knownName = patientDisplayName;
            }
            if (!knownName || !bookingGradeName(knownName)) {
                return {
                    data: {
                        needs_patient_name: true,
                        note: "You do NOT know the lead's FULL name yet. Ask warmly for their FULL name (first and last name, e.g., 'Como posso te chamar?' / 'Qual é o seu nome completo?') BEFORE checking or offering available time slots. Reply in the PATIENT'S language.",
                    },
                };
            }

            // 1. Resolver o serviço (procedimento) — define a duração e os profissionais habilitados
            let service: { id: string; name: string; duration_minutes: number | null } | null = null;
            if (input.type_id) {
                const { data: svc } = await scopedQuery(supabase, "appointment_types", tenantId, "id, name, duration_minutes")
                    .eq("id", input.type_id)
                    .maybeSingle();
                service = svc as any;
            } else if (input.procedure) {
                service = await resolveServiceByName(supabase, tenantId, input.procedure);
            }

            // P2 (2026-07-24): QUALIFICAÇÃO — não ofertar horário às cegas. Se o
            // agente não sabe o procedimento (nem type_id, nem procedure que
            // resolva um serviço) e NÃO pediram um profissional específico, e a
            // clínica tem MAIS DE UM procedimento ativo, devolve um nudge para o
            // agente descobrir a necessidade antes — em vez de escolher um
            // profissional arbitrário (activeDoctors) e ofertar horário sem saber
            // o que o paciente precisa. Clínica com 1 só procedimento segue sem
            // perguntar; 0 procedimentos cadastrados mantém o fallback antigo.
            if (!service && !input.doctor_id) {
                const { data: activeTypes } = await scopedQuery(supabase, "appointment_types", tenantId, "id, name, duration_minutes")
                    .eq("is_active", true)
                    .limit(6);
                const types = (activeTypes || []) as { id: string; name: string; duration_minutes: number | null }[];
                if (types.length > 1) {
                    return {
                        data: {
                            needs_procedure: true,
                            procedures_offered: types.map(t => t.name),
                            note: "You do NOT know yet which procedure the patient needs — do not offer times blindly. Ask warmly what brings them in / what they are looking for (you may hint a couple of options from procedures_offered) BEFORE checking availability. Never pick a procedure yourself. Reply in the PATIENT'S language.",
                        },
                    };
                }
                if (types.length === 1) service = types[0];
            }

            const duration = service?.duration_minutes || 30;
            const period = (["morning", "afternoon", "evening"].includes(input.period) ? input.period : null) as DayPeriod | null;

            // 2. Resolver os profissionais — o sistema escolhe, nunca o paciente
            let doctors: { id: string; full_name: string }[];
            const performers = service ? await doctorsForService(supabase, tenantId, service.id) : [];
            if (input.doctor_id) {
                // Paciente pediu alguém específico: respeitar, mas validar que realiza o procedimento
                if (service && performers.length && !performers.some(p => p.id === input.doctor_id)) {
                    return {
                        data: {
                            requested_professional_does_not_perform: service.name,
                            professionals_who_perform: performers.map(p => ({ id: p.id, name: p.full_name })),
                            note: "Gently inform the patient that the requested professional does not perform this procedure and offer the ones who do. Reply in the PATIENT'S language.",
                        },
                    };
                }
                const { data: doc } = await scopedQuery(supabase, "doctors", tenantId, "id, full_name").eq("id", input.doctor_id).maybeSingle();
                doctors = doc ? [doc as any] : [];
            } else {
                doctors = performers.length ? performers : await activeDoctors(supabase, tenantId);
            }
            if (!doctors.length) return { data: { error: "no_professionals_available" } };

            // 3. Disponibilidade agregada, filtrada por período — SEMPRE no relógio
            // local da clínica (nunca passado, com antecedência mínima configurada)
            const clock = await getTenantClock(supabase, tenantId);
            const { slots, availableForModel, errors } = await fetchAvailableSlotsMulti(
                supabase, tenantId, doctors, input.from_date || undefined, duration, service?.id ?? input.type_id ?? null, period, clock,
            );
            if (!slots.length && errors.length) return { data: { error: errors[0] } };

            const slotsFormatted = formatSlotsForPatient(availableForModel, { clock, language });

            return {
                data: {
                    service: service?.name,
                    available: availableForModel,
                    slots_formatted: slotsFormatted,
                    note: slots.length
                        ? "Write the message to the patient INCLUDING the `slots_formatted` block EXACTLY as provided (copy it verbatim, keep the emoji and line breaks), then close with ONE short question asking which time works best. The same slots also go as clickable buttons automatically. If the patient picks a time by TEXT, call `agendar` immediately with that option's exact slot_id. Do NOT mention professional names unless the patient asked. Reply in the PATIENT'S language."
                        : (period
                            ? "No available time slots in that period. Offer to check other periods or days — do not invent times."
                            : "No available time slots in this period."),
                },
                slots,
            };
        }

        case "buscar_meus_agendamentos": {
            const patient = await findPatient(supabase, tenantId, phone);
            if (!patient) return { data: { appointments: [], note: "Patient has no record at this clinic yet. Reply in the PATIENT'S language." } };

            // Bug de produção (2026-07-21): sem o relógio LOCAL da clínica, "hoje"
            // caía no default America/Sao_Paulo — perto da virada do dia, tenants
            // em fusos distantes (ex.: Pacific/Auckland) podiam ganhar/perder
            // agendamentos de hoje neste filtro (mesma lição do bug de disponibilidade).
            const clock = await getTenantClock(supabase, tenantId);
            const { data, error } = await scopedQuery(supabase, "appointments", tenantId, "id, date, start_time, status, doctor_id, type_id, location_id, doctors:doctor_id(full_name), appointment_types:type_id(name)")
                .eq("patient_id", patient.id)
                .gte("date", clock.today)
                .not("status", "in", '("canceled","cancelled","noshow","no_show")')
                .order("date", { ascending: true })
                .limit(5);
            if (error) return { data: { error: error.message } };
            return { data: { appointments: data || [] } };
        }

        case "agendar": {
            if (!isAffirmativeChoice(lastPatientMessage)) {
                return { data: { success: false, error: "no_explicit_confirmation", note: "Ask a short, direct confirmation question before booking. Reply in the PATIENT'S language." } };
            }
            // slot_id (de ver_disponibilidade) carrega doctor/location/type/date/time —
            // caminho preferido quando o paciente escolhe por texto em vez de clicar
            const fromSlot = input.slot_id ? parseSlotClick(String(input.slot_id)) : null;
            const booking = {
                doctor_id: fromSlot?.doctor_id ?? input.doctor_id,
                location_id: fromSlot?.location_id ?? input.location_id,
                type_id: fromSlot?.type_id ?? input.type_id ?? null,
                date: fromSlot?.date ?? input.date,
                start_time: fromSlot?.time ?? input.start_time,
            };
            if (!booking.doctor_id || !booking.location_id || !booking.date || !booking.start_time) {
                return { data: { success: false, error: "missing_booking_fields", note: "Pass the exact slot_id from ver_disponibilidade (or all of doctor_id/location_id/date/start_time from tool results)." } };
            }
            const referenceError = await validateSchedulingReferences(supabase, tenantId, booking.doctor_id, booking.location_id, booking.type_id);
            if (referenceError) return { data: { success: false, error: referenceError } };

            // Ficha de quem SERÁ ATENDIDO (terceiros: cria dependente no mesmo telefone)
            const resolved = await resolvePatientForBooking(supabase, tenantId, phone, input.patient_name || null, patientDisplayName);
            if (!resolved.patient) return { data: { success: false, error: "patient_create_failed" } };
            if (resolved.ambiguous && !input.patient_name) {
                return { data: { success: false, error: "multiple_patients_on_this_phone", patients: resolved.ambiguous, note: "Ask naturally for whom the appointment is and call agendar again with patient_name. Reply in the PATIENT'S language." } };
            }
            const patient = resolved.patient;

            // Guard C3: do not allow booking if full_name is missing, generic "Paciente WhatsApp", or not plausible
            const { data: patDetails } = await scopedQuery(supabase, "patients", tenantId, "full_name")
                .eq("id", patient.id)
                .maybeSingle();

            const patName = (patDetails as any)?.full_name?.trim();
            if (!patName || patName === "Paciente WhatsApp" || !bookingGradeName(patName)) {
                return {
                    data: {
                        success: false,
                        error: "patient_not_registered",
                        note: "Before booking, ask the patient's FULL name (first + last, not just a first name) in a natural, warm way and call atualizar_cadastro_paciente. Then call agendar again.",
                    },
                };
            }

            const { data, error } = await supabase.rpc("book_appointment", {
                p_tenant_id: tenantId,
                p_patient_id: patient.id,
                p_doctor_id: booking.doctor_id,
                p_location_id: booking.location_id,
                p_type_id: booking.type_id,
                p_date: booking.date,
                p_start_time: booking.start_time,
                p_booked_by: "ai_agent",
            });
            if (error) return { data: { success: false, error: error.message } };
            if ((data as any)?.success) {
                const professional = await doctorDisplayName(supabase, tenantId, booking.doctor_id);
                const confirmation_formatted = await assembleConfirmation(supabase, tenantId, booking as any, professional, language);
                return { data: { ...(data as any), professional, confirmation_formatted, note: "Send the confirmation. Open with a short warm line (e.g. 'All set!' / 'Prontinho!' + ✅), then INCLUDE the `confirmation_formatted` block EXACTLY as provided (copy it verbatim — keep every emoji, label, bold and line break), and close with ONE warm line inviting them to message here if they need anything before the visit. Reply in the PATIENT'S language." } };
            }
            // P-10 (idempotência): "confirmo" duplicado/retry não pode virar
            // "horário indisponível" quando quem ocupa o slot é o PRÓPRIO paciente.
            if ((data as any)?.reason === BOOKING_REASON.SLOT_CONFLICT) {
                const { data: own } = await scopedQuery(supabase, "appointments", tenantId, "id")
                    .eq("patient_id", patient.id)
                    .eq("doctor_id", booking.doctor_id)
                    .eq("date", booking.date)
                    .eq("start_time", booking.start_time)
                    .not("status", "in", '("canceled","cancelled","noshow","no_show")')
                    .limit(1);
                if ((own as any[])?.length) {
                    const professional = await doctorDisplayName(supabase, tenantId, booking.doctor_id);
                    const confirmation_formatted = await assembleConfirmation(supabase, tenantId, booking as any, professional, language);
                    return { data: { success: true, already_booked: true, professional, confirmation_formatted, note: "This appointment ALREADY EXISTS for this patient (duplicate confirmation). Reassure the patient it is confirmed — do not offer new slots. INCLUDE the `confirmation_formatted` block EXACTLY as provided (copy it verbatim). Reply in the PATIENT'S language." } };
                }
                // E4 (2026-07-24): conflito REAL (não é o próprio paciente) nunca fica
                // sem próximo passo — busca alternativas FRESCAS e devolve prontas
                // para o modelo apresentar como bloco verbatim + botões, no mesmo turno.
                const clock = await getTenantClock(supabase, tenantId);
                const { slots: alternatives, availableForModel } = await findConflictAlternatives(
                    supabase, tenantId, booking.doctor_id, booking.type_id, booking.date, booking.start_time, clock);
                if (alternatives.length) {
                    const slots_formatted = formatSlotsForPatient(availableForModel, { clock, language });
                    return {
                        data: {
                            ...(data as any),
                            alternatives: availableForModel,
                            slots_formatted,
                            note: "This exact time was JUST taken by someone else. In ONE short warm line, tell the patient that time slot just filled up, then INCLUDE the `slots_formatted` block EXACTLY as provided (copy it verbatim, keep the emoji and line breaks), and close with ONE short question asking which of these works instead. The same alternatives also go as clickable buttons automatically. If the patient picks one by TEXT, call `agendar` again with that option's exact slot_id. Reply in the PATIENT'S language.",
                        },
                        slots: alternatives,
                    };
                }
            }
            return { data };
        }

        case "remarcar": {
            if (!isAffirmativeChoice(lastPatientMessage)) {
                return { data: { success: false, error: "no_explicit_confirmation", note: "Ask a short, direct confirmation question before booking. Reply in the PATIENT'S language." } };
            }
            const patient = await findPatient(supabase, tenantId, phone);
            if (!patient) return { data: { success: false, error: "patient_not_found" } };
            const referenceError = await validateSchedulingReferences(supabase, tenantId, input.doctor_id, input.location_id, null);
            if (referenceError) return { data: { success: false, error: referenceError } };

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
            if (!(booked as any)?.success) {
                // E4 (2026-07-24): mesmo tratamento de `agendar` — conflito nunca
                // fica sem próximo passo. Remarcação não carrega type_id específico.
                if ((booked as any)?.reason === BOOKING_REASON.SLOT_CONFLICT) {
                    const clock = await getTenantClock(supabase, tenantId);
                    const { slots: alternatives, availableForModel } = await findConflictAlternatives(
                        supabase, tenantId, input.doctor_id, null, input.date, input.start_time, clock);
                    if (alternatives.length) {
                        const slots_formatted = formatSlotsForPatient(availableForModel, { clock, language });
                        return {
                            data: {
                                ...(booked as any),
                                alternatives: availableForModel,
                                slots_formatted,
                                note: "This exact time was JUST taken by someone else. In ONE short warm line, tell the patient that time slot just filled up, then INCLUDE the `slots_formatted` block EXACTLY as provided (copy it verbatim), and close with ONE short question asking which of these works instead. If the patient picks one by TEXT, call `remarcar` again with that option's exact date/start_time (keep the same appointment_id). Reply in the PATIENT'S language.",
                            },
                            slots: alternatives,
                        };
                    }
                }
                return { data: booked };
            }

            const { data: canceled, error: cancelErr } = await supabase
                .from("appointments")
                .update({ status: "canceled" })
                .eq("id", input.appointment_id)
                .eq("tenant_id", tenantId)
                .eq("patient_id", patient.id)
                .select("id");
            // PostgREST não retorna erro quando o filtro atualiza zero linhas;
            // isso também é falha de cancelamento e exige reconciliação.
            if (cancelErr || !(canceled as any[])?.length) {
                console.error(`[RECONCILE] remarcar: novo horário criado, mas falha ao cancelar ${input.appointment_id}: ${cancelErr?.message || "appointment_not_in_tenant_or_patient"}`);
                return { data: { success: true, rescheduled: true, new_appointment: booked, reconciliation_needed: true, note: "New time confirmed, but the old appointment could not be cancelled automatically. Tell the patient the new time is confirmed and the team will remove the duplicate. Reply in the PATIENT'S language." } };
            }

            return { data: { success: true, rescheduled: true, new_appointment: booked } };
        }

        default:
            return { data: { error: `unknown_tool:${call.name}` } };
    }
}

// ─── Paciente ────────────────────────────────────────────────────────────────

// ─── Agendamento para terceiros (dependentes no mesmo telefone) ──────────────
// Modelo da recepcionista: quem liga é o responsável (posse do canal); a ficha
// é de quem SERÁ ATENDIDO (filho, cônjuge, parente) — vinculada ao mesmo
// telefone. Nunca agendar o dependente na ficha do titular.

// Bug de produção (2026-07-21): dois cadastros do mesmo paciente com formatos
// de telefone divergentes ("554198933579" vs "+554198933579") — o agente
// buscava por igualdade exata, achava o cadastro ERRADO (sem agendamento) e
// alucinava "não encontrei nada". patients.phone não tem constraint de
// formato; toda leitura/escrita por telefone passa por aqui.
export function canonicalizePhone(phone: string | null | undefined): string {
    return String(phone ?? "").replace(/\D/g, "");
}

/** Candidatos de formato para casar cadastros legados até a reconciliação de dados. */
function phoneLookupCandidates(phone: string): string[] {
    const digits = canonicalizePhone(phone);
    return digits ? [digits, `+${digits}`] : [phone];
}

const NORM = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Match tolerante de nomes ("Sofia" ↔ "Sofia Prado"), sem acento/caixa. */
export function namesMatch(a: string, b: string): boolean {
    const na = NORM(a), nb = NORM(b);
    if (!na || !nb) return false;
    return na.includes(nb) || nb.includes(na);
}

// Palavras de parentesco ou placeholders — "minha filha" e "Paciente WhatsApp" NÃO são nomes válidos
const NON_PLAUSIBLE_NAME_WORDS = /\b(filh[oa]|esposa|esposo|marido|mulher|m[aã]e|pai|irm[aão]|av[oóô]|tio|tia|sobrinh[oa]|neto|neta|son|daughter|wife|husband|mother|father|brother|sister|hijo|hija|esposa?|madre|padre|herman[oa]|paciente(?:\s+whatsapp)?|patient)\b/i;

/** true se o texto parece um NOME próprio (e não "minha filha" / "meu marido" / "Paciente WhatsApp"). */
export function plausiblePersonName(s: string | null | undefined): boolean {
    const t = (s || "").trim();
    if (t.length < 3 || NON_PLAUSIBLE_NAME_WORDS.test(t)) return false;
    return /^[\p{L}][\p{L}\s'.-]+$/u.test(t);
}

/**
 * Nome "grau de agendamento": além de parecer um nome próprio, precisa ter
 * nome + sobrenome (≥2 palavras). Usado SÓ nos guards de AGENDAMENTO — na
 * conversa comum (Etapa 1), o primeiro nome já basta. Bug de produção
 * (2026-07-24, teste com 4 leads simultâneos): o guard C3 original aceitava
 * qualquer `plausiblePersonName` (1 palavra passa, ex. "Sofia") e o caminho
 * do CLIQUE em botão de horário nem chamava o guard — agendava direto e
 * criava a ficha como "Paciente WhatsApp".
 */
export function bookingGradeName(s: string | null | undefined): boolean {
    if (!plausiblePersonName(s)) return false;
    const words = (s as string).trim().split(/\s+/).filter(Boolean);
    return words.length >= 2;
}

export async function resolvePatientForBooking(
    supabase: SupabaseClient,
    tenantId: string,
    phone: string,
    forName: string | null | undefined,
    fallbackDisplayName?: string | null,
): Promise<{ patient: { id: string } | null; ambiguous?: string[]; created?: boolean; reason?: "name_required" }> {
    const { data } = await scopedQuery(supabase, "patients", tenantId, "id, full_name")
        .in("phone", phoneLookupCandidates(phone))
        .order("created_at", { ascending: true })
        .limit(5);
    const existing = (data || []) as { id: string; full_name: string | null }[];
    const canonicalPhone = canonicalizePhone(phone) || phone;

    // Terceiro (forName explícito: filho, cônjuge, parente) — casa por nome
    // entre os cadastros do MESMO telefone; sem match, cria dependente. Exige
    // nome de agendamento (E2): sem isso, quem chamou decide como pedir o nome.
    if (forName?.trim()) {
        const match = existing.find(p => p.full_name && namesMatch(p.full_name, forName));
        if (match) return { patient: match };
        if (!bookingGradeName(forName)) return { patient: null, reason: "name_required" };
        const { data: created, error } = await supabase
            .from("patients")
            .insert({ tenant_id: tenantId, phone: canonicalPhone, full_name: forName.trim() })
            .select("id")
            .single();
        if (error) { console.error(`[schedulingTools] criar dependente falhou: ${error.message}`); return { patient: null }; }
        return { patient: created as any, created: true };
    }

    // Titular do telefone: identifica pela ficha existente. `fallbackDisplayName`
    // só é usado quando já é, ele próprio, um nome de agendamento válido —
    // nunca mais um placeholder truthy qualquer vira "Paciente WhatsApp" (E2).
    const trustedName = bookingGradeName(fallbackDisplayName) ? (fallbackDisplayName as string).trim() : null;

    if (existing.length === 1) {
        const current = existing[0];
        // Ficha existente ainda sem nome de agendamento (ex.: placeholder
        // legado) + temos agora um nome confiável em mãos: atualiza em vez de
        // deixar o cadastro travado como "Paciente WhatsApp" para sempre.
        if (!bookingGradeName(current.full_name)) {
            if (trustedName) {
                const { error } = await supabase.from("patients").update({ full_name: trustedName }).eq("id", current.id).eq("tenant_id", tenantId);
                if (error) { console.error(`[schedulingTools] atualizar nome do titular falhou: ${error.message}`); return { patient: current }; }
                return { patient: { id: current.id } };
            }
            return { patient: null, reason: "name_required" };
        }
        return { patient: current };
    }
    if (existing.length > 1) return { patient: existing[0], ambiguous: existing.map(p => p.full_name || "sem nome") };

    // Sem ficha nenhuma: só cria com nome confiável — "Paciente WhatsApp"
    // nunca mais nasce aqui (E2, teste real 2026-07-24).
    if (!trustedName) return { patient: null, reason: "name_required" };
    const { data: created, error } = await supabase
        .from("patients")
        .insert({ tenant_id: tenantId, phone: canonicalPhone, full_name: trustedName })
        .select("id")
        .single();
    if (error) { console.error(`[schedulingTools] ensure paciente falhou: ${error.message}`); return { patient: null }; }
    return { patient: created as any, created: true };
}

async function findPatient(supabase: SupabaseClient, tenantId: string, phone: string): Promise<{ id: string } | null> {
    // Telefone compartilhado (família) é legítimo — maybeSingle() quebraria com
    // 2+ cadastros e o ensurePatient criaria um duplicado. Determinístico: o
    // cadastro mais antigo (titular do número). `.in()` com os dois formatos
    // casa cadastros legados com/sem "+" até a reconciliação de dados.
    const { data } = await scopedQuery(supabase, "patients", tenantId, "id")
        .in("phone", phoneLookupCandidates(phone))
        .order("created_at", { ascending: true })
        .limit(1);
    return (data as any[])?.[0] ?? null;
}

/** Reautoriza todos os IDs que podem chegar do modelo ou de um slot serializado. */
export async function validateSchedulingReferences(
    supabase: SupabaseClient, tenantId: string, doctorId: string, locationId: string, typeId?: string | null,
): Promise<string | null> {
    const [doctor, location, type] = await Promise.all([
        scopedQuery(supabase, "doctors", tenantId, "id").eq("id", doctorId).limit(1),
        scopedQuery(supabase, "locations", tenantId, "id").eq("id", locationId).limit(1),
        typeId ? scopedQuery(supabase, "appointment_types", tenantId, "id").eq("id", typeId).limit(1) : Promise.resolve({ data: [{}] }),
    ]);
    if (!(doctor.data as any[])?.length) return "doctor_outside_tenant";
    if (!(location.data as any[])?.length) return "location_outside_tenant";
    if (!(type.data as any[])?.length) return "appointment_type_outside_tenant";
    return null;
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
        .insert({ tenant_id: tenantId, phone: canonicalizePhone(phone) || phone, full_name: name?.trim() || "Paciente WhatsApp" })
        .select("id")
        .single();
    if (error) {
        console.error(`[schedulingTools] ensurePatient falhou: ${error.message}`);
        return null;
    }
    return data as any;
}

// ─── Mensagens determinísticas (caminho do clique — sem LLM) ─────────────────

// Regra de produto: o nome do profissional aparece NA CONFIRMAÇÃO (o paciente
// compra o procedimento; o profissional é informação de logística).
export const SLOT_CONFIRM_MSG: Record<string, (date: string, time: string, professional?: string | null) => string> = {
    pt: (d, t, p) => `Prontinho! Sua consulta está agendada para ${d} às ${t}${p ? ` com ${p}` : ""}. ✅\nQualquer coisa até lá, é só chamar por aqui!`,
    en: (d, t, p) => `All set! Your appointment is booked for ${d} at ${t}${p ? ` with ${p}` : ""}. ✅\nIf you need anything before then, just message us here!`,
    es: (d, t, p) => `¡Listo! Su cita quedó agendada para el ${d} a las ${t}${p ? ` con ${p}` : ""}. ✅\n¡Cualquier cosa hasta entonces, escríbanos por aquí!`,
};

/** Nome do profissional para mensagens de confirmação (null se não encontrado). */
export async function doctorDisplayName(supabase: SupabaseClient, tenantId: string, doctorId: string | null | undefined): Promise<string | null> {
    if (!doctorId) return null;
    const { data } = await scopedQuery(supabase, "doctors", tenantId, "full_name").eq("id", doctorId).maybeSingle();
    return (data as any)?.full_name || null;
}

export const SLOT_TAKEN_MSG: Record<string, string> = {
    pt: "Poxa, esse horário acabou de ser preenchido! 😅 Me diga qual período prefere que eu já verifico outras opções para você.",
    en: "Oh no, that time slot was just taken! 😅 Let me know your preferred time of day and I'll check other options for you.",
    es: "¡Vaya, ese horario acaba de ocuparse! 😅 Dígame qué período prefiere y ya le busco otras opciones.",
};

/**
 * Conflito de horário COM alternativa fresca em mãos (E4, 2026-07-24): nunca
 * deixar o paciente sem saber se digita um horário ou espera — a mensagem já
 * vem com as opções que ainda estão livres, como botões, na mesma resposta.
 */
export const SLOT_TAKEN_RETRY_MSG: Record<string, string> = {
    pt: "Poxa, esse horário acabou de ser preenchido! 😅 Mas ainda tenho estas opções pertinho dele — é só escolher:",
    en: "Oh no, that time slot was just taken! 😅 But I still have these nearby options — just pick one:",
    es: "¡Vaya, ese horario acaba de ocuparse! 😅 Pero todavía tengo estas opciones cercanas — solo elija una:",
};

/**
 * Clique em botão de horário sem nome de agendamento confirmado (E2,
 * 2026-07-24): reserva o horário no contexto (pending_booking_slot) e pede o
 * nome completo antes de finalizar — nunca cria "Paciente WhatsApp".
 */
export const ASK_NAME_TO_BOOK_MSG: Record<string, string> = {
    pt: "Perfeito! Esse horário está livre 😊 Para eu finalizar a reserva, qual é o seu nome completo?",
    en: "Perfect! That time is available 😊 To finish the booking, what's your full name?",
    es: "¡Perfecto! Ese horario está disponible 😊 Para finalizar la reserva, ¿cuál es su nombre completo?",
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

// ── Confirmação de agendamento — bloco estruturado que o agente COPIA verbatim ──
// Pedido do usuário (2026-07-23): a confirmação vinha incompleta. Sempre incluir
// título do profissional (Dr.), contato, local e link do Google Maps, num formato
// amigável com emojis. Igual ao slots_formatted da disponibilidade, a ferramenta
// entrega o bloco pronto para o agente não inventar nem omitir dados.

/** Prefixa "Dr. " se o nome ainda não vier com título (Dr./Dra.). */
export function confirmationDoctorTitle(fullName: string | null | undefined): string {
    const n = (fullName || "").trim();
    if (!n) return n;
    if (/^dr[a]?\b\.?/i.test(n)) return n; // já tem Dr./Dra.
    return `Dr. ${n}`;
}

/** Link do Maps: usa o google_maps_url do local; senão constrói uma busca pelo endereço. */
export function confirmationMapsUrl(loc: any): string | null {
    const saved = loc?.google_maps_url?.trim?.();
    if (saved) return saved;
    const addr = [loc?.address, loc?.address_number, loc?.address_neighborhood, loc?.address_zip_code]
        .filter((p: any) => p && String(p).trim()).join(", ");
    if (addr) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
    return null;
}

const CONFIRMATION_LABELS: Record<ConversationLanguage, Record<string, string>> = {
    en: { header: "Appointment Details", date: "Date", time: "Time", doctor: "Doctor", contact: "Contact", location: "Location", directions: "Get Directions" },
    pt: { header: "Detalhes do Agendamento", date: "Data", time: "Horário", doctor: "Profissional", contact: "Contato", location: "Local", directions: "Como Chegar" },
    es: { header: "Detalles de la Cita", date: "Fecha", time: "Hora", doctor: "Profesional", contact: "Contacto", location: "Ubicación", directions: "Cómo Llegar" },
};

/** Monta o bloco de confirmação estruturado, só com as linhas cujos dados existem. */
export function buildConfirmationBlock(opts: {
    date: string;
    time: string;
    doctorName: string | null;
    location: any;
    contact: string | null;
    clock: TenantClock;
    language: ConversationLanguage;
}): string {
    const L = CONFIRMATION_LABELS[opts.language] || CONFIRMATION_LABELS.pt;
    const lines: string[] = [`📝 *${L.header}:*`];
    lines.push(`📅 *${L.date}:* ${formatDateForPatient(opts.date, opts.language)}`);
    lines.push(`🕒 *${L.time}:* ${formatSlotTimeForPatient(opts.time, opts.clock.timeFormat)}`);
    if (opts.doctorName?.trim()) lines.push(`👨‍⚕️ *${L.doctor}:* ${confirmationDoctorTitle(opts.doctorName)}`);
    if (opts.contact?.trim()) lines.push(`☎️ *${L.contact}:* ${opts.contact.trim()}`);
    if (opts.location?.name?.trim?.()) lines.push(`📍 *${L.location}:* ${opts.location.name.trim()}`);
    const maps = confirmationMapsUrl(opts.location);
    if (maps) lines.push(`🗺️ *${L.directions}:* ${maps}`);
    return lines.join("\n");
}

/** Busca os dados de local + contato e monta o bloco de confirmação para o turno. */
export async function assembleConfirmation(
    supabase: SupabaseClient,
    tenantId: string,
    booking: { date: string; start_time: string; location_id: string },
    professional: string | null,
    language: ConversationLanguage,
): Promise<string> {
    const clock = await getTenantClock(supabase, tenantId);
    const { data: loc } = await scopedQuery(
        supabase, "locations", tenantId,
        "name, phone, address, address_number, address_neighborhood, address_zip_code, google_maps_url",
    ).eq("id", booking.location_id).maybeSingle();
    // Contato: telefone do local; fallback para o WhatsApp do tenant (o número que ele já usa).
    let contact = (loc as any)?.phone?.trim?.() || null;
    if (!contact) {
        const { data: t } = await supabase.from("tenants").select("whatsapp_phone").eq("id", tenantId).maybeSingle();
        contact = (t as any)?.whatsapp_phone?.trim?.() || null;
    }
    return buildConfirmationBlock({
        date: booking.date, time: booking.start_time, doctorName: professional,
        location: loc, contact, clock, language,
    });
}

// ── Confirmação COMPLETA (saudação + "agendado!" + bloco rico) ───────────────
// P3 (2026-07-24): o caminho do clique mandava só a SLOT_CONFIRM_MSG curta,
// enquanto o LLM mandava o bloco rico. Agora TODOS os caminhos usam esta função
// para entregar a mesma confirmação estruturada (data, horário, profissional,
// local, maps) com uma saudação calorosa pelo primeiro nome.

/** Saudação + linha "agendado com sucesso", por idioma. Nome opcional. */
export const CONFIRMATION_GREETING: Record<ConversationLanguage, (firstName: string | null) => string> = {
    en: (n) => `Hi${n ? ` ${n}` : ""}! 😊\nYour appointment has been successfully booked!`,
    pt: (n) => `Prontinho${n ? `, ${n}` : ""}! 😊\nSeu agendamento foi confirmado com sucesso!`,
    es: (n) => `¡Listo${n ? `, ${n}` : ""}! 😊\n¡Su cita quedó confirmada con éxito!`,
};

/** Primeiro nome plausível do paciente (para a saudação da confirmação). null se placeholder/ausente. */
export async function patientFirstName(supabase: SupabaseClient, tenantId: string, patientId: string): Promise<string | null> {
    const { data } = await scopedQuery(supabase, "patients", tenantId, "full_name").eq("id", patientId).maybeSingle();
    const full = (data as any)?.full_name?.trim();
    if (!full || !plausiblePersonName(full)) return null;
    return full.split(/\s+/)[0];
}

/**
 * Confirmação COMPLETA pronta para enviar ao paciente: saudação pelo primeiro
 * nome + "agendado com sucesso" + o bloco estruturado (Data/Horário/
 * Profissional/Local/Maps). Fonte única usada pelo clique, lista de espera e
 * recovery — para que a experiência seja idêntica ao caminho LLM.
 */
export async function assembleFullConfirmation(
    supabase: SupabaseClient,
    tenantId: string,
    booking: { date: string; start_time: string; location_id: string },
    professional: string | null,
    patientId: string | null,
    language: ConversationLanguage,
): Promise<string> {
    const [block, firstName] = await Promise.all([
        assembleConfirmation(supabase, tenantId, booking, professional, language),
        patientId ? patientFirstName(supabase, tenantId, patientId) : Promise.resolve(null),
    ]);
    const greeting = (CONFIRMATION_GREETING[language] || CONFIRMATION_GREETING.pt)(firstName);
    return `${greeting}\n\n${block}`;
}
