-- Fix crm_trg_appointments missing INSERT block and timezone conversion

CREATE OR REPLACE FUNCTION public.crm_trg_appointments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journey_id uuid;
  v_phone text;
  v_next timestamptz;
BEGIN
  -- Obtain phone for ensure_journey
  SELECT phone INTO v_phone FROM public.patients WHERE id = NEW.patient_id;
  v_journey_id := public.crm_ensure_journey(NEW.tenant_id, NEW.patient_id, v_phone, NULL, 'conversation');

  -- Calculate the next future appointment (correcting timezone and syntax)
  SELECT MIN((a.date + a.start_time)::timestamp AT TIME ZONE COALESCE(t.timezone, 'America/Sao_Paulo'))
    INTO v_next
    FROM public.appointments a
    JOIN public.tenants t ON t.id = a.tenant_id
   WHERE a.patient_id = NEW.patient_id
     AND a.status IN ('scheduled','confirmed','waiting')
     AND (a.date + a.start_time)::timestamp AT TIME ZONE COALESCE(t.timezone, 'America/Sao_Paulo') > now()
     AND a.id != NEW.id;

  -- Restore INSERT block
  IF TG_OP = 'INSERT' THEN
    UPDATE public.crm_journeys
    SET appointments_count = appointments_count + 1, next_appointment_at = v_next
    WHERE id = v_journey_id;

    PERFORM public.crm_log_event(v_journey_id, 'appointment_created',
      jsonb_build_object('appointment_id', NEW.id, 'date', NEW.date), 'user');

    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, 'scheduled', 'system');
    EXCEPTION WHEN OTHERS THEN 
      RAISE WARNING '[crm_trg_appointments] failed to move to scheduled: %', SQLERRM;
    END;

    RETURN NEW;
  END IF;

  -- If it's an UPDATE, only proceed if status changed
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Update journey with next appointment
  UPDATE public.crm_journeys SET next_appointment_at = v_next WHERE id = v_journey_id;

  IF NEW.status = ANY (ARRAY['checkin_done','in_consult','waiting']) THEN
    PERFORM public.crm_log_event(v_journey_id, 'checked_in', jsonb_build_object('appointment_id', NEW.id), 'user');
    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, 'showed_up', 'user');
    EXCEPTION WHEN OTHERS THEN 
      RAISE WARNING '[crm_trg_appointments] failed to move to showed_up: %', SQLERRM;
    END;

  ELSIF NEW.status = 'completed' THEN
    PERFORM public.crm_log_event(v_journey_id, 'appointment_completed', jsonb_build_object('appointment_id', NEW.id), 'user');
    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, 'showed_up', 'user');
    EXCEPTION WHEN OTHERS THEN 
      RAISE WARNING '[crm_trg_appointments] failed to move to showed_up (completed): %', SQLERRM;
    END;

  ELSIF NEW.status = ANY (ARRAY['noshow','no_show']) THEN
    UPDATE public.crm_journeys SET no_show_count = no_show_count + 1 WHERE id = v_journey_id;
    PERFORM public.crm_log_event(v_journey_id, 'no_show', jsonb_build_object('appointment_id', NEW.id), 'user');
    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, 'recovery', 'system');
    EXCEPTION WHEN OTHERS THEN 
      RAISE WARNING '[crm_trg_appointments] failed to move to recovery: %', SQLERRM;
    END;

  ELSIF NEW.status = ANY (ARRAY['canceled','cancelled']) THEN
    PERFORM public.crm_log_event(v_journey_id, 'appointment_cancelled', jsonb_build_object('appointment_id', NEW.id), 'user');
    IF (SELECT stage_id FROM public.crm_journeys WHERE id = v_journey_id) = 'scheduled' THEN
      BEGIN
        PERFORM public.crm_move_stage(v_journey_id, 'in_contact', 'system');
      EXCEPTION WHEN OTHERS THEN 
        RAISE WARNING '[crm_trg_appointments] failed to move to in_contact: %', SQLERRM;
      END;
    END IF;

  ELSIF NEW.status = 'confirmed' THEN
    PERFORM public.crm_log_event(v_journey_id, 'appointment_confirmed', jsonb_build_object('appointment_id', NEW.id), 'user');
  END IF;

  RETURN NEW;
END;
$$;
