-- ROLLBACK da Fase 1 (sync automático de status do CRM) — definições capturadas de PRODUÇÃO em 2026-09-15 antes da mudança.
-- Para reverter: aplicar este arquivo inteiro com: npx supabase db query --linked -f supabase/rollbacks/20260915_crm_phase1_rollback.sql

ALTER TABLE public.crm_journey_events DROP CONSTRAINT IF EXISTS crm_journey_events_event_type_check;
ALTER TABLE public.crm_journey_events ADD CONSTRAINT crm_journey_events_event_type_check CHECK ((event_type = ANY (ARRAY['journey_created'::text, 'stage_changed'::text, 'appointment_created'::text, 'appointment_confirmed'::text, 'checked_in'::text, 'appointment_completed'::text, 'no_show'::text, 'appointment_cancelled'::text, 'message_received'::text, 'message_sent'::text, 'sale_recorded'::text, 'note_added'::text, 'automation_fired'::text, 'automation_stopped'::text, 'journey_merged'::text]))) NOT VALID;

DROP FUNCTION IF EXISTS public.crm_sync_stage(uuid, text, text, text);

DROP TRIGGER IF EXISTS tr_advance_kanban_on_appointment_outcome ON public.appointments;
CREATE TRIGGER tr_advance_kanban_on_appointment_outcome AFTER UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION advance_kanban_on_appointment_outcome();

DROP TRIGGER IF EXISTS tr_crm_appointments ON public.appointments;
CREATE TRIGGER tr_crm_appointments AFTER INSERT OR UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION crm_trg_appointments();

-- (a coluna crm_journeys.next_appointment_status é mantida — inofensiva e lida pela tela)

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
BEGIN
  SELECT * INTO j FROM public.crm_journeys WHERE id = p_journey_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_journey % not found', p_journey_id;
  END IF;

  -- AuthZ: chamadas de usuÃ¡rio autenticado precisam pertencer ao tenant do card.
  -- Chamadas internas (triggers/cron/service_role) nÃ£o tÃªm auth.uid() â€” passam.
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = j.tenant_id
    ) THEN
      RAISE EXCEPTION 'forbidden: user does not belong to this tenant' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_old_stage := j.stage_id;

  IF p_to_stage = v_old_stage THEN
    RETURN j; -- no-op: evita eventos/automaÃ§Ã£o duplicados
  END IF;

  v_allowed := (p_to_stage = 'lost') OR EXISTS (
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

  -- Espelha em conversation_sessions.kanban_stage para HumanInboxPage/SidebarLeadClassifyView
  IF j.session_id IS NOT NULL THEN
    v_legacy_label := public.crm_legacy_stage_label(p_to_stage, j.appointments_count);
    UPDATE public.conversation_sessions
    SET kanban_stage = v_legacy_label
    WHERE id = j.session_id AND kanban_stage IS DISTINCT FROM v_legacy_label;
  END IF;

  PERFORM public.crm_dispatch_automations(p_journey_id, v_cycle);

  RETURN j;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_trg_appointments()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_journey_id uuid;
  v_phone text;
  v_next timestamptz;
BEGIN
  v_phone := (SELECT phone FROM public.patients WHERE id = NEW.patient_id);
  v_journey_id := public.crm_ensure_journey(NEW.tenant_id, NEW.patient_id, v_phone, NULL, 'conversation');

  -- Busca o prÃ³ximo appointment real agendado no futuro para o mesmo paciente
  SELECT date + start_time INTO v_next
  FROM public.appointments
  WHERE patient_id = NEW.patient_id AND status IN ('scheduled','confirmed','waiting')
    AND date + start_time > now()
    AND id != NEW.id
  ORDER BY date + start_time ASC LIMIT 1;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

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
$function$
;

CREATE OR REPLACE FUNCTION public.crm_trg_conversation_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_journey_id uuid;
BEGIN
  SELECT id INTO v_journey_id FROM public.crm_journeys WHERE session_id = NEW.session_id LIMIT 1;
  IF v_journey_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.role IN ('assistant', 'system') THEN
    PERFORM public.crm_log_event(v_journey_id, 'message_sent',
      jsonb_build_object('preview', LEFT(NEW.content, 120)), 'bot');
  ELSE
    PERFORM public.crm_log_event(v_journey_id, 'message_received',
      jsonb_build_object('preview', LEFT(NEW.content, 120)), 'patient');
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_trg_conversation_sessions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_patient_id uuid;
  v_journey_id uuid;
  v_target_stage text;
  v_current_stage text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT id INTO v_patient_id FROM public.patients
    WHERE tenant_id = NEW.tenant_id
      AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(NEW.patient_phone, '\D', '', 'g')
    LIMIT 1;

    PERFORM public.crm_ensure_journey(
      NEW.tenant_id, v_patient_id, NEW.patient_phone, NEW.id, 'conversation',
      COALESCE(NEW.channel, 'whatsapp'), NEW.platform_display_name);
    RETURN NEW;
  END IF;

  IF NEW.kanban_stage IS NOT DISTINCT FROM OLD.kanban_stage THEN RETURN NEW; END IF;

  SELECT id, stage_id INTO v_journey_id, v_current_stage FROM public.crm_journeys WHERE session_id = NEW.id LIMIT 1;
  IF v_journey_id IS NULL THEN RETURN NEW; END IF;

  v_target_stage := public.crm_stage_from_legacy_label(NEW.kanban_stage);
  IF v_target_stage IS DISTINCT FROM v_current_stage THEN
    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, v_target_stage, 'user');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[crm_trg_conversation_sessions] transiÃ§Ã£o legada invÃ¡lida % -> % (session %): %',
        v_current_stage, v_target_stage, NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$
;