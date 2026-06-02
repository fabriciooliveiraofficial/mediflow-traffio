import {
  Target, FileArchive, MessageSquare,
  Calendar, CalendarX, CalendarPlus,
  Stethoscope, DollarSign,
} from 'lucide-react';

/**
 * Fonte única de verdade para os estágios do funil Kanban.
 * Usada por: FollowUpBoard e SidebarLeadClassifyView.
 */
export const KANBAN_STAGES = [
  'Novos Leads',
  'Em Contato',
  'Avaliação',
  'Faltou Avaliação',
  'Reagendamento Avaliação',
  'Consulta',
  'Faltou Consulta',
  'Vendido/Procedimento',
  'Perdido',
] as const;

export type KanbanStage = (typeof KANBAN_STAGES)[number];

export const STAGE_ICONS: Record<KanbanStage, React.ComponentType<any>> = {
  'Novos Leads':              Target,
  'Em Contato':               MessageSquare,
  'Avaliação':                Calendar,
  'Faltou Avaliação':         CalendarX,
  'Reagendamento Avaliação':  CalendarPlus,
  'Consulta':                 Stethoscope,
  'Faltou Consulta':          CalendarX,
  'Vendido/Procedimento':     DollarSign,
  'Perdido':                  FileArchive,
};
