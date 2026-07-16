/**
 * todayService — snapshot agregado da tela Hoje (centro de comando do atendente).
 *
 * Princípio (ver docs/SPEC_TELA_HOJE.md): agregador, não duplicador. Este módulo
 * apenas conta, prioriza e seleciona previews das superfícies que já existem
 * (Inbox, Agenda, CRM/WorkQueue, Waitlist). Nenhuma regra de negócio nova aqui —
 * a estratificação do CRM vem de lib/workQueueStrata (mesma fonte do WorkQueue).
 *
 * Todas as janelas "hoje/amanhã/mês" são calculadas no fuso do TENANT.
 */
import { supabase } from '../lib/supabase';
import { formatPhone } from '../lib/formatPhone';
import {
    getTenantTodayString,
    addDaysToDateString,
    localDateTimeToUTC,
} from '../lib/timezoneUtils';
import { stratifyJourneys, type StratifiableJourney } from '../lib/workQueueStrata';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface QueuePreviewItem {
    id: string;
    /** Nome resolvido do paciente/lead */
    title: string;
    /** Contexto curto (horário, telefone, estágio) — já formatado */
    subtitle: string;
    /** Timestamp de referência para tempo relativo (F1: espera na fila) */
    referenceAt?: string;
}

export interface QueueSnapshot {
    count: number;
    items: QueuePreviewItem[];
}

export interface GoalProgress {
    current: number;
    target: number;
}

export interface TodaySnapshot {
    queues: {
        humanQueue: QueueSnapshot;
        confirmations: QueueSnapshot;
        recovery: QueueSnapshot;
        followUps: QueueSnapshot;
        waitlist: QueueSnapshot;
    };
    todayAgenda: {
        total: number;
        done: number;
        next: QueuePreviewItem[];
    };
    goals: {
        /** Agendamentos do mês corrente (fuso do tenant) */
        appointments?: GoalProgress;
        /** Comparecimento: completed / (completed + no_show), em % */
        showRate?: GoalProgress;
    };
    pulse: {
        appointmentsToday: number;
        showsToday: number;
        newLeadsToday: number;
        resolvedToday: number;
    };
}

export interface MonthlyGoals {
    appointments?: number;
    show_rate?: number;
}

/** Statuses de agendamento cancelado/falta variam no banco — cobrir todos. */
const CANCELLED_STATUSES = ['canceled', 'cancelled'];
const NO_SHOW_STATUSES = ['noshow', 'no_show'];

// Campos mínimos de jornada para estratificar + resolver nome (sem carregar o board inteiro)
const JOURNEY_SELECT =
    'id, stage_id, needs_action, next_action_at, priority_score, no_show_count, last_event_at, lead_phone, '
    + 'patients(full_name, phone), crm_journey_identities(display_name), '
    + 'conversation_sessions(platform_display_name, patient_phone)';

interface JourneyRow extends StratifiableJourney {
    id: string;
    no_show_count: number;
    lead_phone: string | null;
    patients: { full_name: string | null; phone: string | null } | null;
    crm_journey_identities: { display_name: string | null }[] | null;
    conversation_sessions: { platform_display_name: string | null; patient_phone: string | null } | null;
}

/** Cascata de resolução de nome (mesma ordem do FollowUpBoard, sem i18n). */
function journeyName(j: JourneyRow): string {
    if (j.patients?.full_name) return j.patients.full_name;
    const identity = (j.crm_journey_identities || []).find(i => i.display_name)?.display_name;
    if (identity) return identity;
    if (j.conversation_sessions?.platform_display_name) return j.conversation_sessions.platform_display_name;
    const phone = j.lead_phone || j.patients?.phone || j.conversation_sessions?.patient_phone || '';
    return formatPhone(phone);
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export async function getTodaySnapshot(tenantId: string, timezone?: string): Promise<TodaySnapshot> {
    const tz = timezone || 'America/Sao_Paulo';
    const todayStr = getTenantTodayString(tz);
    const tomorrowStr = addDaysToDateString(todayStr, 1);
    const monthStartStr = `${todayStr.slice(0, 7)}-01`;

    const startOfToday = localDateTimeToUTC(todayStr, '00:00', tz).toISOString();
    const nowTimeStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date());

    const [
        queuedSessions,
        todayAppointments,
        confirmations,
        journeys,
        waitlistEntries,
        monthTotal,
        monthCompleted,
        monthNoShow,
        newLeadsToday,
        resolvedToday,
    ] = await Promise.all([
        // F1 — conversas aguardando humano (mais antiga primeiro)
        supabase
            .from('conversation_sessions')
            .select('id, patient_phone, updated_at, channel, platform_display_name', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .eq('omnichannel_status', 'queued')
            .order('updated_at', { ascending: true })
            .limit(3),
        // F6 + pulso — agenda de hoje (status derivados client-side)
        supabase
            .from('appointments')
            .select('id, start_time, status, patients(full_name)')
            .eq('tenant_id', tenantId)
            .eq('date', todayStr)
            .order('start_time', { ascending: true })
            .limit(300),
        // F2 — agendados sem confirmação (hoje + amanhã)
        supabase
            .from('appointments')
            .select('id, start_time, status, patients(full_name)', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .eq('status', 'scheduled')
            .gte('date', todayStr)
            .lte('date', tomorrowStr)
            .order('start_time', { ascending: true })
            .limit(3),
        // F3/F4 — jornadas abertas, estratificadas pela mesma lib do WorkQueue
        supabase
            .from('crm_journeys')
            .select(JOURNEY_SELECT)
            .eq('tenant_id', tenantId)
            .not('stage_id', 'in', '("won","lost")')
            .limit(500),
        // F5 — lista de espera ativa
        supabase
            .from('waitlist')
            .select('id, status, doctor_id, patients:patient_id(full_name, phone), doctors:doctor_id(full_name)', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .eq('status', 'waiting')
            .order('created_at', { ascending: true })
            .limit(3),
        // Metas — agendamentos do mês (exclui cancelados)
        supabase
            .from('appointments')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .gte('date', monthStartStr)
            .not('status', 'in', `("${CANCELLED_STATUSES.join('","')}")`),
        supabase
            .from('appointments')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .gte('date', monthStartStr)
            .lte('date', todayStr)
            .eq('status', 'completed'),
        supabase
            .from('appointments')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .gte('date', monthStartStr)
            .lte('date', todayStr)
            .in('status', NO_SHOW_STATUSES),
        // Pulso — novos leads hoje
        supabase
            .from('crm_journeys')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .gte('created_at', startOfToday),
        // Pulso — conversas encerradas hoje (proxy: fechadas com atividade hoje)
        supabase
            .from('conversation_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('omnichannel_status', 'closed')
            .gte('updated_at', startOfToday),
    ]);

    // Erros individuais não derrubam a tela inteira — cada fila degrada para vazio
    const logError = (label: string, error: unknown) => {
        if (error) console.error(`[todayService] ${label}:`, error);
    };
    logError('humanQueue', queuedSessions.error);
    logError('todayAppointments', todayAppointments.error);
    logError('confirmations', confirmations.error);
    logError('journeys', journeys.error);
    logError('waitlist', waitlistEntries.error);

    // F3/F4 — estratificação compartilhada (fonte única com o WorkQueue)
    const journeyRows = (journeys.data as unknown as JourneyRow[]) || [];
    const { due } = stratifyJourneys(journeyRows);
    const recoveryDue = due.filter(j => j.stage_id === 'recovery');
    const followUpsDue = due.filter(j => j.stage_id !== 'recovery');

    // F6 + pulso — derivados da agenda de hoje
    const todayRows = (todayAppointments.data as any[]) || [];
    const activeToday = todayRows.filter(a => !CANCELLED_STATUSES.includes(a.status));
    const doneToday = activeToday.filter(a => a.status === 'completed');
    const upcomingToday = activeToday.filter(a =>
        !NO_SHOW_STATUSES.includes(a.status) && a.status !== 'completed' && a.start_time >= nowTimeStr);

    const apptItem = (a: any): QueuePreviewItem => ({
        id: a.id,
        title: a.patients?.full_name || formatPhone(''),
        subtitle: a.start_time,
        referenceAt: a.start_time,
    });

    return {
        queues: {
            humanQueue: {
                count: queuedSessions.count ?? 0,
                items: ((queuedSessions.data as any[]) || []).map(s => ({
                    id: s.id,
                    title: s.platform_display_name || formatPhone(s.patient_phone || ''),
                    subtitle: s.channel || 'whatsapp',
                    referenceAt: s.updated_at,
                })),
            },
            confirmations: {
                count: confirmations.count ?? 0,
                items: ((confirmations.data as any[]) || []).map(apptItem),
            },
            recovery: {
                count: recoveryDue.length,
                items: recoveryDue.slice(0, 3).map(j => ({
                    id: j.id,
                    title: journeyName(j),
                    subtitle: String(j.no_show_count),
                })),
            },
            followUps: {
                count: followUpsDue.length,
                items: followUpsDue.slice(0, 3).map(j => ({
                    id: j.id,
                    title: journeyName(j),
                    subtitle: String(j.priority_score),
                })),
            },
            waitlist: {
                count: waitlistEntries.count ?? 0,
                items: ((waitlistEntries.data as any[]) || []).map(w => ({
                    id: w.id,
                    title: w.patients?.full_name || formatPhone(w.patients?.phone || ''),
                    subtitle: w.doctors?.full_name || '',
                })),
            },
        },
        todayAgenda: {
            total: activeToday.length,
            done: doneToday.length,
            next: upcomingToday.slice(0, 3).map(apptItem),
        },
        goals: {
            appointments: { current: monthTotal.count ?? 0, target: 0 },
            showRate: {
                current: (() => {
                    const completed = monthCompleted.count ?? 0;
                    const noShow = monthNoShow.count ?? 0;
                    const denom = completed + noShow;
                    return denom > 0 ? Math.round((completed / denom) * 100) : 0;
                })(),
                target: 0,
            },
        },
        pulse: {
            appointmentsToday: activeToday.length,
            showsToday: doneToday.length,
            newLeadsToday: newLeadsToday.count ?? 0,
            resolvedToday: resolvedToday.count ?? 0,
        },
    };
}
