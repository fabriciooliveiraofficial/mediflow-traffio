-- Update crm_sweep_journey_sla to auto-archive leads inactive for > 15 days
CREATE OR REPLACE FUNCTION public.crm_sweep_journey_sla()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_j uuid;
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

  -- Auto-arquiva leads inativos há mais de 15 dias usando o motor do CRM
  FOR v_j IN 
    SELECT id FROM public.crm_journeys 
    WHERE stage_id NOT IN ('won', 'lost') 
      AND last_event_at <= now() - interval '15 days'
  LOOP
    BEGIN
      PERFORM public.crm_move_stage(v_j, 'lost', 'system', 'no_response', '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN 
      -- ignora transições inválidas se houver (não deve ocorrer, qualquer estágio vai p/ lost)
      NULL;
    END;
  END LOOP;
END;
$$;
