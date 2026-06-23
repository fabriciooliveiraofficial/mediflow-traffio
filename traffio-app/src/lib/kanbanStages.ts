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

/**
 * Chave de tradução (`crm.kanbanStages.*`) para cada estágio.
 * O valor de `KANBAN_STAGES` continua sendo o dado real (coluna `kanban_stage`
 * no banco) — este mapa serve apenas para exibição traduzida na UI.
 */
export const STAGE_LABEL_KEYS: Record<KanbanStage, string> = {
  'Novos Leads':              'novosLeads',
  'Em Contato':               'emContato',
  'Avaliação':                'avaliacao',
  'Faltou Avaliação':         'faltouAvaliacao',
  'Reagendamento Avaliação':  'reagendamentoAvaliacao',
  'Consulta':                 'consulta',
  'Faltou Consulta':          'faltouConsulta',
  'Vendido/Procedimento':     'vendidoProcedimento',
  'Perdido':                  'perdido',
};
