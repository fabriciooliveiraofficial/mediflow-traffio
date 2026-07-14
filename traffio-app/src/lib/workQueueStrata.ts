/**
 * workQueueStrata — fonte única da estratificação operacional do CRM.
 *
 * Consumida pelo WorkQueue (FollowUpBoard) e pela tela Hoje (todayService).
 * Qualquer mudança no critério de "para agir agora" deve acontecer AQUI,
 * nunca duplicada nos consumidores — as duas superfícies precisam exibir
 * exatamente os mesmos itens vencidos.
 */

/** Campos mínimos que uma jornada precisa ter para ser estratificada. */
export interface StratifiableJourney {
    stage_id: string;
    needs_action: boolean;
    next_action_at: string | null;
    priority_score: number;
    last_event_at: string;
}

export type Stratum = 'due' | 'scheduled' | 'quiet';

/** Jornada exige ação agora: SLA estourado ou próxima ação vencida. */
export function isJourneyDue(j: StratifiableJourney, nowMs: number): boolean {
    return j.needs_action || (!!j.next_action_at && new Date(j.next_action_at).getTime() <= nowMs);
}

/**
 * Estratificação por importância operacional:
 *   due       → para agir agora (ordenado por score)
 *   scheduled → adiados/compromisso futuro (ordenado pelo vencimento mais
 *               próximo; ao vencer, sobem sozinhos para "due")
 *   quiet     → tratados/em dia (ordenados por recência)
 * Jornadas fechadas (won/lost) ficam fora de todos os estratos.
 */
export function stratifyJourneys<T extends StratifiableJourney>(
    journeys: T[],
    nowMs: number = Date.now(),
): { due: T[]; scheduled: T[]; quiet: T[] } {
    const open = journeys.filter(j => !['won', 'lost'].includes(j.stage_id));

    const due = open.filter(j => isJourneyDue(j, nowMs))
        .sort((a, b) => b.priority_score - a.priority_score);
    const scheduled = open.filter(j => !isJourneyDue(j, nowMs) && j.next_action_at)
        .sort((a, b) => new Date(a.next_action_at!).getTime() - new Date(b.next_action_at!).getTime());
    const quiet = open.filter(j => !isJourneyDue(j, nowMs) && !j.next_action_at)
        .sort((a, b) => new Date(b.last_event_at).getTime() - new Date(a.last_event_at).getTime());

    return { due, scheduled, quiet };
}
