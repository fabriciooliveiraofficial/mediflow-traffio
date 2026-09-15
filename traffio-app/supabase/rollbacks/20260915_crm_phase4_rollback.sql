-- ROLLBACK da Fase 4 (painel de automações do Follow-up).
-- Volta prazos para o padrão global das etapas. As chaves gravadas em
-- tenants.bot_config (crm_sla_hours, recall_*, channel_automations.*.recovery)
-- ficam como estão: recall/recovery já eram lidos antes desta fase; crm_sla_hours
-- passa a ser ignorado.
-- Aplicar com: npx supabase db query --linked -f supabase/rollbacks/20260915_crm_phase4_rollback.sql

DROP FUNCTION IF EXISTS public.crm_update_followup_automations(uuid, jsonb);
DROP FUNCTION IF EXISTS public.crm_get_followup_automations(uuid);

CREATE OR REPLACE FUNCTION public.crm_move_stage(p_journey_id uuid, p_to_stage text, p_actor text DEFAULT 'user'::text, p_reason text DEFAULT NULL::text, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS crm_journeys
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  j public.crm_journeys;
  v_old_stage text;
  v_allowed boolean;
  v_cycle int;
  v_sla_hours int;
  v_next_action_type text;
  v_revenue numeric;
  v_procedure text;
  v_legacy_label text;
  v_system_fact boolean;
BEGIN
  v_system_fact := COALESCE(current_setting('crm.system_fact', true), '') = 'on';
  PERFORM set_config('crm.system_fact', 'off', true);

  SELECT * INTO j FROM public.crm_journeys WHERE id = p_journey_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_journey % not found', p_journey_id;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = j.tenant_id
    ) THEN
      RAISE EXCEPTION 'forbidden: user does not belong to this tenant' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_old_stage := j.stage_id;

  IF p_to_stage = v_old_stage THEN
    RETURN j;
  END IF;

  v_allowed := v_system_fact OR (p_to_stage = 'lost') OR EXISTS (
    SELECT 1 FROM public.crm_stage_transitions WHERE from_stage = v_old_stage AND to_stage = p_to_stage
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid stage transition: % -> %', v_old_stage, p_to_stage USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) + 1 INTO v_cycle
  FROM public.crm_journey_events
  WHERE journey_id = p_journey_id AND event_type = 'stage_changed' AND payload->>'to' = p_to_stage;

  SELECT sla_hours INTO v_sla_hours FROM public.crm_stages WHERE id = p_to_stage;

  v_next_action_type := CASE p_to_stage
    WHEN 'new_lead'   THEN 'message'
    WHEN 'in_contact' THEN 'call'
    WHEN 'showed_up'  THEN 'follow_proposal'
    WHEN 'proposal'   THEN 'follow_proposal'
    WHEN 'recovery'   THEN 'recover'
    WHEN 'recall_due' THEN 'recall'
    ELSE NULL
  END;

  v_revenue   := NULLIF(p_extra->>'revenue_estimated', '')::numeric;
  v_procedure := p_extra->>'procedure_name';

  UPDATE public.crm_journeys SET
    stage_id           = p_to_stage,
    stage_entered_at   = now(),
    last_event_at      = now(),
    updated_at         = now(),
    needs_action        = false,
    next_action_type    = v_next_action_type,
    next_action_at       = CASE WHEN v_sla_hours IS NOT NULL THEN now() + (v_sla_hours * interval '1 hour') ELSE NULL END,
    lost_reason          = CASE WHEN p_to_stage = 'lost' THEN COALESCE(p_reason, lost_reason) ELSE lost_reason END,
    revenue_estimated    = COALESCE(v_revenue, revenue_estimated),
    procedure_name       = COALESCE(v_procedure, procedure_name)
  WHERE id = p_journey_id
  RETURNING * INTO j;

  PERFORM public.crm_log_event(p_journey_id, 'stage_changed',
    jsonb_build_object('from', v_old_stage, 'to', p_to_stage, 'reason', p_reason) || p_extra, p_actor);

  UPDATE public.crm_journeys SET priority_score = public.crm_calculate_priority_score(id) WHERE id = p_journey_id
  RETURNING * INTO j;

  IF j.session_id IS NOT NULL THEN
    v_legacy_label := public.crm_legacy_stage_label(p_to_stage, j.appointments_count);
    UPDATE public.conversation_sessions
    SET kanban_stage = v_legacy_label
    WHERE id = j.session_id AND kanban_stage IS DISTINCT FROM v_legacy_label;
  END IF;

  PERFORM public.crm_dispatch_automations(p_journey_id, v_cycle);

  RETURN j;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_sweep_journey_sla()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.crm_journeys
  SET needs_action = true
  WHERE stage_id NOT IN ('won','lost')
    AND needs_action = false
    AND (
      (next_action_at IS NOT NULL AND next_action_at <= now())
      OR (
        next_action_at IS NULL
        AND stage_entered_at + (
          (SELECT sla_hours FROM public.crm_stages WHERE id = crm_journeys.stage_id) * interval '1 hour'
        ) <= now()
      )
    );

  UPDATE public.crm_journeys
  SET priority_score = public.crm_calculate_priority_score(id)
  WHERE stage_id NOT IN ('won','lost');
END;
$function$;

DROP FUNCTION IF EXISTS public.crm_stage_sla_hours(uuid, text);
