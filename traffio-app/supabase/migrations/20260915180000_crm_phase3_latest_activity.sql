-- =============================================================================
-- CRM — Fase 3: última atividade de cada card aberto, para a lista "Hoje"
--
-- Uma chamada devolve, por card aberto do tenant: o último acontecimento
-- relevante (com o trecho da mensagem), quando o paciente escreveu por último e
-- quando a equipe/IA respondeu por último — é o que diferencia um contato do outro
-- na tela e diz se o paciente está esperando resposta.
--
-- SECURITY INVOKER: respeita o RLS de crm_journeys/crm_journey_events (o usuário só
-- lê cards da própria clínica). Usa o índice idx_crm_events_journey.
-- Rollback: DROP FUNCTION public.crm_journey_latest_activity(uuid);
-- =============================================================================

CREATE OR REPLACE FUNCTION public.crm_journey_latest_activity(p_tenant_id uuid)
 RETURNS TABLE (
   out_journey_id uuid,
   out_last_type text,
   out_last_preview text,
   out_last_actor text,
   out_last_at timestamptz,
   out_patient_msg_at timestamptz,
   out_team_msg_at timestamptz
 )
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT
    j.id,
    ev.event_type,
    NULLIF(ev.payload->>'preview', ''),
    ev.actor,
    ev.created_at,
    (SELECT max(m.created_at) FROM public.crm_journey_events m
      WHERE m.journey_id = j.id AND m.event_type = 'message_received'),
    (SELECT max(m.created_at) FROM public.crm_journey_events m
      WHERE m.journey_id = j.id AND m.event_type = 'message_sent' AND m.actor IN ('user','bot'))
  FROM public.crm_journeys j
  LEFT JOIN LATERAL (
    SELECT e.event_type, e.payload, e.actor, e.created_at
    FROM public.crm_journey_events e
    WHERE e.journey_id = j.id
      AND e.event_type IN (
        'message_received','message_sent','no_show','appointment_created',
        'appointment_rescheduled','appointment_cancelled','appointment_confirmed',
        'checked_in','appointment_completed','proposal_sent','proposal_approved',
        'proposal_lost','sale_recorded','sync_blocked','journey_created'
      )
    ORDER BY e.created_at DESC
    LIMIT 1
  ) ev ON true
  WHERE j.tenant_id = p_tenant_id
    AND j.stage_id NOT IN ('won','lost');
$function$;

REVOKE ALL ON FUNCTION public.crm_journey_latest_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_journey_latest_activity(uuid) TO authenticated;
