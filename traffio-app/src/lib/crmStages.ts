import {
  Target, MessageSquare, CalendarClock, UserCheck,
  FileText, RotateCcw, History, DollarSign, FileArchive,
} from 'lucide-react';

/**
 * Fonte única de verdade (frontend) para os estágios do CRM Journey Engine.
 * Espelha public.crm_stages (supabase/migrations/20260701_crm_journey_foundation.sql).
 * Usada por: FollowUpBoard, PerformanceStats, FollowUpTimelineDrawer.
 *
 * conversation_sessions.kanban_stage (lib/kanbanStages.ts) continua existindo
 * como espelho legado para HumanInboxPage/SidebarLeadClassifyView — não é
 * mais a fonte de verdade do funil.
 */
export const CRM_STAGES = [
  'new_lead',
  'in_contact',
  'scheduled',
  'showed_up',
  'proposal',
  'recovery',
  'recall_due',
  'won',
  'lost',
] as const;

export type CrmStageId = (typeof CRM_STAGES)[number];
export type CrmStageKind = 'open' | 'working' | 'won' | 'lost';

export const CRM_STAGE_KIND: Record<CrmStageId, CrmStageKind> = {
  new_lead:   'open',
  in_contact: 'open',
  scheduled:  'open',
  showed_up:  'open',
  proposal:   'open',
  recovery:   'working',
  recall_due: 'working',
  won:        'won',
  lost:       'lost',
};

export const CRM_STAGE_ICONS: Record<CrmStageId, React.ComponentType<any>> = {
  new_lead:   Target,
  in_contact: MessageSquare,
  scheduled:  CalendarClock,
  showed_up:  UserCheck,
  proposal:   FileText,
  recovery:   RotateCcw,
  recall_due: History,
  won:        DollarSign,
  lost:       FileArchive,
};

/** Chave de tradução (`crm.stages.*`) para cada estágio. */
export const CRM_STAGE_LABEL_KEYS: Record<CrmStageId, string> = {
  new_lead:   'newLead',
  in_contact: 'inContact',
  scheduled:  'scheduled',
  showed_up:  'showedUp',
  proposal:   'proposal',
  recovery:   'recovery',
  recall_due: 'recallDue',
  won:        'won',
  lost:       'lost',
};

/** Estágios visíveis como colunas do kanban — won/lost aparecem como listas colapsáveis. */
export const CRM_BOARD_STAGES: CrmStageId[] = [
  'new_lead', 'in_contact', 'scheduled', 'showed_up', 'proposal', 'recovery', 'recall_due',
];

export const NEXT_ACTION_LABEL_KEYS: Record<string, string> = {
  call:            'nextAction.call',
  message:         'nextAction.message',
  confirm:         'nextAction.confirm',
  follow_proposal: 'nextAction.followProposal',
  recover:         'nextAction.recover',
  recall:          'nextAction.recall',
};

export const LOST_REASON_LABEL_KEYS: Record<string, string> = {
  price:       'lostReason.price',
  competitor:  'lostReason.competitor',
  no_response: 'lostReason.noResponse',
  gave_up:     'lostReason.gaveUp',
  other:       'lostReason.other',
};
