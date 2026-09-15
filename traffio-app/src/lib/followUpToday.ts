/**
 * followUpToday — regras da lista "Hoje" do Follow-up.
 *
 * Decide, para cada card aberto: em qual grupo ele fica (Responder agora /
 * Ainda hoje / Em dia), a frase curta que explica o porquê e qual é a ação
 * principal (o único botão com texto da linha). Funções puras, sem React.
 *
 * O critério de "vencido" continua vindo de workQueueStrata (fonte única,
 * compartilhada com a tela Hoje do Atendimento).
 */
import { isJourneyDue } from './workQueueStrata';
import type { CrmStageId } from './crmStages';

export type TodayGroup = 'now' | 'today' | 'ok';

export type PrimaryAction = 'reply' | 'reschedule' | 'proposal' | 'confirm' | 'review' | 'open';

export interface JourneyActivity {
    lastType: string | null;
    lastPreview: string | null;
    lastActor: string | null;
    lastAt: string | null;
    patientMsgAt: string | null;
    teamMsgAt: string | null;
}

export interface TodayJourneyInput {
    stage_id: CrmStageId;
    needs_action: boolean;
    next_action_at: string | null;
    priority_score: number;
    last_event_at: string;
    stage_entered_at: string;
    next_appointment_at: string | null;
    no_show_count: number;
}

export type ReasonKey =
    | 'blocked' | 'waitingReply' | 'staleReply' | 'noShow' | 'recallDue'
    | 'cameNoProposal' | 'proposalWaiting' | 'newNoReply' | 'talkingQuiet'
    | 'confirmAppointment' | 'returnsAt' | 'appointmentAt' | 'upToDate';

export interface TodayReason {
    key: ReasonKey;
    /** Instante de referência para "há X" (ISO) */
    since?: string | null;
    /** Data de referência para "em DATA" (ISO) */
    at?: string | null;
}

export interface TodayClassification {
    group: TodayGroup;
    reason: TodayReason;
    action: PrimaryAction;
}

/** Paciente escreveu por último e ninguém respondeu depois. */
export function isWaitingReply(a: JourneyActivity | undefined): boolean {
    if (!a?.patientMsgAt) return false;
    if (!a.teamMsgAt) return true;
    return new Date(a.patientMsgAt).getTime() > new Date(a.teamMsgAt).getTime();
}

/** Janela em que uma mensagem sem resposta ainda é "responder agora". */
export const FRESH_REPLY_WINDOW_MS = 72 * 3600_000;

export function classifyJourney(j: TodayJourneyInput, a: JourneyActivity | undefined, nowMs: number): TodayClassification {
    const due = isJourneyDue(j, nowMs);
    const waiting = isWaitingReply(a);
    const freshWaiting = waiting && !!a?.patientMsgAt && nowMs - new Date(a.patientMsgAt).getTime() <= FRESH_REPLY_WINDOW_MS;

    if (a?.lastType === 'sync_blocked') {
        return { group: 'now', reason: { key: 'blocked', since: a.lastAt }, action: 'review' };
    }
    if (freshWaiting) {
        return { group: 'now', reason: { key: 'waitingReply', since: a!.patientMsgAt }, action: 'reply' };
    }
    if (j.stage_id === 'recovery' && due) {
        return { group: 'now', reason: { key: 'noShow', since: j.stage_entered_at }, action: 'reschedule' };
    }

    if (due) {
        switch (j.stage_id) {
            case 'recall_due':
                return { group: 'today', reason: { key: 'recallDue' }, action: 'reschedule' };
            case 'showed_up':
                return { group: 'today', reason: { key: 'cameNoProposal', since: j.stage_entered_at }, action: 'proposal' };
            case 'proposal':
                return { group: 'today', reason: { key: 'proposalWaiting', since: j.stage_entered_at }, action: 'reply' };
            case 'scheduled':
                return { group: 'today', reason: { key: 'confirmAppointment', at: j.next_appointment_at }, action: 'confirm' };
            case 'new_lead':
                return waiting
                    ? { group: 'today', reason: { key: 'staleReply', since: a!.patientMsgAt }, action: 'reply' }
                    : { group: 'today', reason: { key: 'newNoReply', since: j.stage_entered_at }, action: 'reply' };
            default:
                return waiting
                    ? { group: 'today', reason: { key: 'staleReply', since: a!.patientMsgAt }, action: 'reply' }
                    : { group: 'today', reason: { key: 'talkingQuiet', since: a?.lastAt || j.last_event_at }, action: 'reply' };
        }
    }

    if (j.next_appointment_at && new Date(j.next_appointment_at).getTime() > nowMs) {
        return { group: 'ok', reason: { key: 'appointmentAt', at: j.next_appointment_at }, action: 'open' };
    }
    if (j.next_action_at) {
        return { group: 'ok', reason: { key: 'returnsAt', at: j.next_action_at }, action: 'open' };
    }
    return { group: 'ok', reason: { key: 'upToDate' }, action: 'open' };
}

/** "12 min", "6 h", "3 d" — curto e igual nos três idiomas. */
export function shortElapsed(sinceIso: string | null | undefined, nowMs: number): string {
    if (!sinceIso) return '';
    const diff = Math.max(0, nowMs - new Date(sinceIso).getTime());
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 60) return `${Math.max(1, minutes)} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours} h`;
    return `${Math.floor(hours / 24)} d`;
}

/** Ordem dentro de cada grupo: quem espera há mais tempo primeiro; empate pela prioridade. */
export function compareWithinGroup(
    a: { c: TodayClassification; j: TodayJourneyInput },
    b: { c: TodayClassification; j: TodayJourneyInput },
): number {
    if (a.c.group === 'ok') {
        const ta = a.c.reason.at ? new Date(a.c.reason.at).getTime() : Infinity;
        const tb = b.c.reason.at ? new Date(b.c.reason.at).getTime() : Infinity;
        return ta - tb;
    }
    const sa = a.c.reason.since ? new Date(a.c.reason.since).getTime() : Infinity;
    const sb = b.c.reason.since ? new Date(b.c.reason.since).getTime() : Infinity;
    if (sa !== sb) return sa - sb;
    return b.j.priority_score - a.j.priority_score;
}
