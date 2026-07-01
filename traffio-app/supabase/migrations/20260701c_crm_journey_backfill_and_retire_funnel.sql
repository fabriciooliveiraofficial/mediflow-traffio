-- =============================================================================
-- CRM Journey Engine — Backfill e aposentadoria do funil órfão
-- Data: 2026-07-01
-- Pré-requisito: 20260701_crm_journey_foundation.sql, 20260701_crm_journey_engine.sql
--
-- Descoberta: patient_funnel_stage (migration 20260327_patient_funnel_stage.sql)
-- é um SEGUNDO funil, já em produção, escrito pelo bot (clinicalAgent.ts) e
-- por um trigger de sincronização de next_action — mas sem NENHUMA página
-- que o leia (FunilCaptacao.tsx e toda components/automacoes/ não são
-- importados em lugar nenhum do app). Em vez de conviver com um terceiro
-- sistema desconectado, este arquivo absorve os dados dele em crm_journeys
-- e o aposenta.
-- =============================================================================

-- 1. Backfill a partir de conversation_sessions (sessões ainda abertas)
INSERT INTO public.crm_journeys
  (tenant_id, patient_id, lead_phone, session_id, stage_id, origin,
   revenue_estimated, procedure_name, appointments_count, no_show_count,
   stage_entered_at, last_event_at, created_at, updated_at)
SELECT
  cs.tenant_id,
  p.id,
  cs.patient_phone,
  cs.id,
  public.crm_stage_from_legacy_label(cs.kanban_stage),
  'conversation',
  COALESCE(cs.revenue_estimated, 0),
  NULL, -- conversation_sessions não tem coluna de procedimento (confirmado via information_schema)
  COALESCE(apt.cnt, 0),
  COALESCE(apt.no_show_cnt, 0),
  cs.updated_at,
  cs.updated_at,
  cs.created_at,
  cs.updated_at
FROM public.conversation_sessions cs
LEFT JOIN public.patients p
  ON p.tenant_id = cs.tenant_id
 AND regexp_replace(p.phone, '\D', '', 'g') = regexp_replace(cs.patient_phone, '\D', '', 'g')
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS cnt,
    COUNT(*) FILTER (WHERE a.status IN ('noshow','no_show')) AS no_show_cnt
  FROM public.appointments a
  WHERE a.patient_id = p.id AND a.tenant_id = cs.tenant_id
) apt ON p.id IS NOT NULL
WHERE cs.omnichannel_status <> 'closed'
ON CONFLICT DO NOTHING;

-- 2. Backfill a partir do funil órfão (patient_funnel_stage), só para
--    telefones que ainda não têm card (evita duplicar quem já veio de
--    conversation_sessions acima)
INSERT INTO public.crm_journeys
  (tenant_id, patient_id, lead_phone, stage_id, origin,
   next_action_at, next_action_type, stage_entered_at, last_event_at, created_at, updated_at)
SELECT
  pf.tenant_id,
  p.id,
  pf.patient_phone,
  CASE pf.current_stage
    WHEN 'novo_lead'     THEN 'new_lead'
    WHEN 'em_follow_up'  THEN 'in_contact'
    WHEN 'qualificado'   THEN 'in_contact'
    WHEN 'agendado'      THEN 'scheduled'
    WHEN 'perdido'       THEN 'lost'
    ELSE 'new_lead'
  END,
  'conversation',
  pf.next_action_at,
  CASE WHEN pf.next_action_at IS NOT NULL THEN 'message' ELSE NULL END,
  pf.stage_updated_at,
  pf.last_interaction_at,
  pf.created_at,
  pf.stage_updated_at
FROM public.patient_funnel_stage pf
LEFT JOIN public.patients p
  ON p.tenant_id = pf.tenant_id
 AND regexp_replace(p.phone, '\D', '', 'g') = regexp_replace(pf.patient_phone, '\D', '', 'g')
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_journeys j
  WHERE j.tenant_id = pf.tenant_id
    AND (
      (p.id IS NOT NULL AND j.patient_id = p.id)
      OR (j.lead_phone = pf.patient_phone)
    )
)
ON CONFLICT DO NOTHING;

-- 3. Eventos de criação + score inicial para todo o backfill
INSERT INTO public.crm_journey_events (tenant_id, journey_id, event_type, payload, actor, created_at)
SELECT tenant_id, id, 'journey_created', jsonb_build_object('origin', origin, 'backfilled', true), 'system', created_at
FROM public.crm_journeys
WHERE id NOT IN (SELECT journey_id FROM public.crm_journey_events WHERE event_type = 'journey_created');

UPDATE public.crm_journeys SET priority_score = public.crm_calculate_priority_score(id);

-- 4. Aposenta o funil órfão: remove o trigger de sincronização e a tabela.
--    Nenhuma página do frontend lê patient_funnel_stage (confirmado:
--    FunilCaptacao.tsx e components/automacoes/* não são importados em
--    nenhuma rota); os dados já foram absorvidos no passo 2 acima.
DROP TRIGGER IF EXISTS tr_sync_funnel_next_action ON public.outbound_message_queue;
DROP FUNCTION IF EXISTS public.update_funnel_next_action();
DROP TABLE IF EXISTS public.patient_funnel_stage CASCADE;

SELECT 'CRM Journey Engine — Backfill concluído, funil órfão aposentado.' AS resultado;
