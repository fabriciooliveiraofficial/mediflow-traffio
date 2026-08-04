-- Update crm_trg_conversation_sessions to extract lost_reason and lost_notes from tags
-- and pass them to crm_move_stage.
CREATE OR REPLACE FUNCTION public.crm_trg_conversation_sessions()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_patient_id uuid;
  v_journey_id uuid;
  v_target_stage text;
  v_current_stage text;
  v_extra jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT id INTO v_patient_id FROM public.patients
    WHERE tenant_id = NEW.tenant_id
      AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(NEW.patient_phone, '\D', '', 'g')
    LIMIT 1;

    PERFORM public.crm_ensure_journey(NEW.tenant_id, v_patient_id, NEW.patient_phone, NEW.id, 'conversation');
    RETURN NEW;
  END IF;

  IF NEW.kanban_stage IS NOT DISTINCT FROM OLD.kanban_stage THEN
    RETURN NEW;
  END IF;

  SELECT id, stage_id INTO v_journey_id, v_current_stage FROM public.crm_journeys WHERE session_id = NEW.id LIMIT 1;
  IF v_journey_id IS NULL THEN RETURN NEW; END IF;

  v_target_stage := public.crm_stage_from_legacy_label(NEW.kanban_stage);
  IF v_target_stage IS DISTINCT FROM v_current_stage THEN
    BEGIN
      v_extra := '{}'::jsonb;
      IF NEW.tags->>'lost_notes' IS NOT NULL THEN
        v_extra := jsonb_build_object('lost_notes', NEW.tags->>'lost_notes');
      END IF;
      
      -- pass NEW.tags->>'lost_reason' as p_reason and v_extra as p_extra
      PERFORM public.crm_move_stage(v_journey_id, v_target_stage, 'user', NEW.tags->>'lost_reason', v_extra);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[crm_trg_conversation_sessions] transição legada inválida % -> % (session %): %',
        v_current_stage, v_target_stage, NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;
