-- Add next_appointment_status to crm_journeys
ALTER TABLE public.crm_journeys 
ADD COLUMN IF NOT EXISTS next_appointment_status text;

-- Update the appointments trigger to also save next_appointment_status
CREATE OR REPLACE FUNCTION public.crm_trg_appointments()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_journey_id uuid;
  v_phone text;
  v_next timestamptz;
  v_next_status text;
BEGIN
  SELECT phone INTO v_phone FROM public.patients WHERE id = NEW.patient_id;

  v_journey_id := public.crm_ensure_journey(NEW.tenant_id, NEW.patient_id, v_phone, NULL, 'conversation');

  SELECT 
    MIN((a.date + a.start_time)::timestamp AT TIME ZONE COALESCE(t.timezone, 'America/Sao_Paulo')),
    (array_agg(a.status ORDER BY (a.date + a.start_time) ASC))[1]
    INTO v_next, v_next_status
    FROM public.appointments a
    JOIN public.tenants t ON t.id = a.tenant_id
   WHERE a.patient_id = NEW.patient_id
     AND a.tenant_id = NEW.tenant_id
     AND a.status NOT IN ('canceled','cancelled','noshow','no_show')
     AND (a.date + a.start_time)::timestamp AT TIME ZONE COALESCE(t.timezone, 'America/Sao_Paulo') >= now();

  IF TG_OP = 'INSERT' THEN
    UPDATE public.crm_journeys
    SET appointments_count = appointments_count + 1, 
        next_appointment_at = v_next,
        next_appointment_status = v_next_status
    WHERE id = v_journey_id;

    PERFORM public.crm_log_event(v_journey_id, 'appointment_created',
      jsonb_build_object('appointment_id', NEW.id, 'date', NEW.date), 'user');

    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, 'scheduled', 'system');
    EXCEPTION WHEN OTHERS THEN NULL; -- transição não aplicável ao estágio atual: ignora
    END;

    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE' OF status
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  UPDATE public.crm_journeys 
  SET next_appointment_at = v_next,
      next_appointment_status = v_next_status
  WHERE id = v_journey_id;

  IF NEW.status = ANY (ARRAY['checkin_done','in_consult','waiting']) THEN
    PERFORM public.crm_log_event(v_journey_id, 'checked_in', jsonb_build_object('appointment_id', NEW.id), 'user');
    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, 'showed_up', 'user');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

  ELSIF NEW.status = 'completed' THEN
    PERFORM public.crm_log_event(v_journey_id, 'appointment_completed', jsonb_build_object('appointment_id', NEW.id), 'user');
    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, 'showed_up', 'user');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

  ELSIF NEW.status = ANY (ARRAY['noshow','no_show']) THEN
    UPDATE public.crm_journeys SET no_show_count = no_show_count + 1 WHERE id = v_journey_id;
    PERFORM public.crm_log_event(v_journey_id, 'no_show', jsonb_build_object('appointment_id', NEW.id), 'user');
    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, 'recovery', 'system');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

  ELSIF NEW.status = ANY (ARRAY['canceled','cancelled']) THEN
    PERFORM public.crm_log_event(v_journey_id, 'appointment_cancelled', jsonb_build_object('appointment_id', NEW.id), 'user');
    IF (SELECT stage_id FROM public.crm_journeys WHERE id = v_journey_id) = 'scheduled' THEN
      BEGIN
        PERFORM public.crm_move_stage(v_journey_id, 'in_contact', 'system');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

  ELSIF NEW.status = 'confirmed' THEN
    PERFORM public.crm_log_event(v_journey_id, 'appointment_confirmed', jsonb_build_object('appointment_id', NEW.id), 'user');
  END IF;

  RETURN NEW;
END;
$$;
