-- =============================================================================
-- CRM — Fase 1: status que se atualiza sozinho e não falha em silêncio
--
-- Regras (plano aprovado em 15/09/2026):
--   * Fatos reais (agendou, reagendou, chegou, faltou, cancelou, respondeu)
--     movem o card mesmo pulando etapas. A trava de crm_stage_transitions
--     continua valendo para mudanças manuais.
--   * Movimento só para frente: fato nunca rebaixa um card (ex.: paciente em
--     Orçamento que marca sessão continua em Orçamento).
--   * Se uma atualização não puder acontecer: evento 'sync_blocked' no
--     histórico + needs_action=true (sobe na fila). Nunca bloqueia a escrita
--     original (agendamento/mensagem).
--   * Motor legado tr_advance_kanban_on_appointment_outcome desligado.
--
-- Rollback: supabase/rollbacks/20260915_crm_phase1_rollback.sql
-- =============================================================================

-- 0. Coluna lida pela tela (selo "Consulta confirmada") que nunca foi criada ----
ALTER TABLE public.crm_journeys ADD COLUMN IF NOT EXISTS next_appointment_status text;

-- 1. Novos tipos de evento ------------------------------------------------------
ALTER TABLE public.crm_journey_events DROP CONSTRAINT IF EXISTS crm_journey_events_event_type_check;
ALTER TABLE public.crm_journey_events ADD CONSTRAINT crm_journey_events_event_type_check CHECK (event_type = ANY (ARRAY[
  'journey_created','stage_changed','appointment_created','appointment_confirmed',
  'checked_in','appointment_completed','no_show','appointment_cancelled',
  'message_received','message_sent','sale_recorded','note_added',
  'automation_fired','automation_stopped','journey_merged',
  'appointment_rescheduled','sync_blocked'
]));

-- 2. crm_move_stage: aceita salto quando chamado por crm_sync_stage ------------
-- A permissão vem de uma flag local de transação lida e APAGADA na entrada, para
-- não vazar para chamadas aninhadas (o espelho em conversation_sessions dispara
-- outro crm_move_stage dentro desta mesma execução).
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

-- 3. Porta única para fatos do sistema -----------------------------------------
CREATE OR REPLACE FUNCTION public.crm_sync_stage(p_journey_id uuid, p_to_stage text, p_actor text, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM set_config('crm.system_fact', 'on', true);
    PERFORM public.crm_move_stage(p_journey_id, p_to_stage, p_actor, NULL, jsonb_build_object('source', p_source));
    PERFORM set_config('crm.system_fact', 'off', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('crm.system_fact', 'off', true);
    BEGIN
      PERFORM public.crm_log_event(p_journey_id, 'sync_blocked',
        jsonb_build_object('to', p_to_stage, 'source', p_source, 'error', SQLERRM), 'system');
      UPDATE public.crm_journeys SET needs_action = true WHERE id = p_journey_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[crm_sync_stage] journey % -> %: %', p_journey_id, p_to_stage, SQLERRM;
    END;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_sync_stage(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- 4. Agendamentos -> CRM ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_trg_appointments()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_journey_id uuid;
  v_stage text;
  v_stage_entered timestamptz;
  v_phone text;
  v_next_at timestamptz;
  v_next_status text;
  v_actor text;
  v_was_active boolean;
  v_is_active boolean;
  v_reopen_won boolean;
BEGIN
  IF NEW.patient_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.date IS NOT DISTINCT FROM OLD.date
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time THEN
    RETURN NEW;
  END IF;

  v_actor := CASE WHEN auth.uid() IS NOT NULL THEN 'user' ELSE 'system' END;

  -- Card do paciente: o aberto; senão o último fechado (sessão de tratamento ou
  -- retorno usam o MESMO card); só cria um novo se o paciente nunca teve card.
  -- crm_ensure_journey sozinho ignora cards fechados e duplicava o paciente.
  SELECT id INTO v_journey_id FROM public.crm_journeys
  WHERE tenant_id = NEW.tenant_id AND patient_id = NEW.patient_id AND stage_id NOT IN ('won','lost')
  ORDER BY last_event_at DESC LIMIT 1;

  IF v_journey_id IS NULL THEN
    SELECT id INTO v_journey_id FROM public.crm_journeys
    WHERE tenant_id = NEW.tenant_id AND patient_id = NEW.patient_id
    ORDER BY last_event_at DESC LIMIT 1;
  END IF;

  IF v_journey_id IS NULL THEN
    v_phone := (SELECT phone FROM public.patients WHERE id = NEW.patient_id);
    v_journey_id := public.crm_ensure_journey(NEW.tenant_id, NEW.patient_id, v_phone, NULL, 'conversation');
  END IF;
  IF v_journey_id IS NULL THEN RETURN NEW; END IF;

  -- Próxima consulta ativa (inclui a própria linha, que já está visível no AFTER)
  SELECT date + start_time, status INTO v_next_at, v_next_status
  FROM public.appointments
  WHERE tenant_id = NEW.tenant_id AND patient_id = NEW.patient_id
    AND status IN ('scheduled','confirmed')
    AND date + start_time > now()
  ORDER BY date + start_time ASC LIMIT 1;

  UPDATE public.crm_journeys
  SET next_appointment_at = v_next_at, next_appointment_status = v_next_status
  WHERE id = v_journey_id;

  SELECT stage_id, stage_entered_at INTO v_stage, v_stage_entered FROM public.crm_journeys WHERE id = v_journey_id;
  -- Paciente fechado há mais de 180 dias que volta = novo ciclo. Dentro disso é
  -- sessão de tratamento e o card continua Fechado.
  v_reopen_won := v_stage = 'won' AND v_stage_entered < now() - interval '180 days';

  v_is_active  := NEW.status IN ('scheduled','confirmed');
  v_was_active := TG_OP = 'UPDATE' AND OLD.status IN ('scheduled','confirmed');

  -- Agendou (novo, ou voltou a ficar ativo depois de falta/cancelamento)
  IF v_is_active AND NOT v_was_active THEN
    PERFORM public.crm_log_event(v_journey_id, 'appointment_created',
      jsonb_build_object('appointment_id', NEW.id, 'date', NEW.date, 'time', NEW.start_time), v_actor);
    IF v_stage IN ('new_lead','in_contact','recovery','recall_due','lost') OR v_reopen_won THEN
      PERFORM public.crm_sync_stage(v_journey_id, 'scheduled', v_actor, 'agenda');
    END IF;
    IF NEW.status = 'confirmed' THEN
      PERFORM public.crm_log_event(v_journey_id, 'appointment_confirmed', jsonb_build_object('appointment_id', NEW.id), v_actor);
    END IF;
    RETURN NEW;
  END IF;

  -- Reagendou (mesma consulta ativa, data ou horário diferente)
  IF v_is_active AND v_was_active
     AND (NEW.date IS DISTINCT FROM OLD.date OR NEW.start_time IS DISTINCT FROM OLD.start_time) THEN
    PERFORM public.crm_log_event(v_journey_id, 'appointment_rescheduled',
      jsonb_build_object('appointment_id', NEW.id,
        'from', OLD.date::text || ' ' || left(OLD.start_time::text, 5),
        'to',   NEW.date::text || ' ' || left(NEW.start_time::text, 5)), v_actor);
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('checkin_done','in_consult','waiting','in_progress','completed') THEN
    IF NEW.status = 'completed' THEN
      PERFORM public.crm_log_event(v_journey_id, 'appointment_completed', jsonb_build_object('appointment_id', NEW.id), v_actor);
    ELSIF TG_OP = 'INSERT' OR OLD.status NOT IN ('checkin_done','in_consult','waiting','in_progress') THEN
      PERFORM public.crm_log_event(v_journey_id, 'checked_in', jsonb_build_object('appointment_id', NEW.id), v_actor);
    END IF;
    IF v_stage IN ('new_lead','in_contact','scheduled','recovery','recall_due','lost') OR v_reopen_won THEN
      PERFORM public.crm_sync_stage(v_journey_id, 'showed_up', v_actor, 'recepcao');
    END IF;

  ELSIF NEW.status IN ('noshow','no_show') THEN
    UPDATE public.crm_journeys SET no_show_count = no_show_count + 1 WHERE id = v_journey_id;
    PERFORM public.crm_log_event(v_journey_id, 'no_show', jsonb_build_object('appointment_id', NEW.id), v_actor);
    IF v_stage IN ('new_lead','in_contact','scheduled','showed_up','proposal','recall_due') THEN
      PERFORM public.crm_sync_stage(v_journey_id, 'recovery', 'system', 'recepcao');
    END IF;

  ELSIF NEW.status IN ('canceled','cancelled') THEN
    PERFORM public.crm_log_event(v_journey_id, 'appointment_cancelled', jsonb_build_object('appointment_id', NEW.id), v_actor);
    -- Só volta para Em conversa se não sobrou outra consulta marcada
    IF v_next_at IS NULL AND v_stage IN ('new_lead','scheduled') THEN
      PERFORM public.crm_sync_stage(v_journey_id, 'in_contact', 'system', 'agenda');
    END IF;

  ELSIF NEW.status = 'confirmed' THEN
    PERFORM public.crm_log_event(v_journey_id, 'appointment_confirmed', jsonb_build_object('appointment_id', NEW.id), v_actor);
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Nunca impedir a gravação do agendamento por causa do CRM
  RAISE WARNING '[crm_trg_appointments] appt %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- Antes o gatilho só disparava em mudança de status: reagendar era invisível.
DROP TRIGGER IF EXISTS tr_crm_appointments ON public.appointments;
CREATE TRIGGER tr_crm_appointments
  AFTER INSERT OR UPDATE OF status, date, start_time ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.crm_trg_appointments();

-- 5. Mensagens -> CRM ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_trg_conversation_messages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_journey_id uuid;
  v_stage text;
BEGIN
  IF NEW.role = 'internal' OR NEW.message_type = 'internal' THEN RETURN NEW; END IF;

  SELECT id, stage_id INTO v_journey_id, v_stage FROM public.crm_journeys WHERE session_id = NEW.session_id LIMIT 1;
  IF v_journey_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.role = 'user' THEN
    PERFORM public.crm_log_event(v_journey_id, 'message_received',
      jsonb_build_object('preview', LEFT(NEW.content, 120)), 'patient');
  ELSE
    PERFORM public.crm_log_event(v_journey_id, 'message_sent',
      jsonb_build_object('preview', LEFT(NEW.content, 120)),
      CASE NEW.role WHEN 'human' THEN 'user' WHEN 'assistant' THEN 'bot' ELSE 'system' END);

    IF NEW.role IN ('human','assistant') AND v_stage = 'new_lead' THEN
      PERFORM public.crm_sync_stage(v_journey_id, 'in_contact',
        CASE NEW.role WHEN 'human' THEN 'user' ELSE 'bot' END, 'atendimento');
    END IF;
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[crm_trg_conversation_messages] msg %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 6. Espelho legado: ignorar o eco do próprio CRM --------------------------------
-- crm_move_stage grava um rótulo legado em conversation_sessions.kanban_stage que
-- não volta para o mesmo estágio (Compareceu -> "Avaliação" -> Agendado). Sem este
-- filtro, cada movimento gerava uma tentativa de regressão.
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
  v_appt_count int;
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

  SELECT id, stage_id, appointments_count INTO v_journey_id, v_current_stage, v_appt_count
  FROM public.crm_journeys WHERE session_id = NEW.id LIMIT 1;
  IF v_journey_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.kanban_stage IS NOT DISTINCT FROM public.crm_legacy_stage_label(v_current_stage, v_appt_count) THEN
    RETURN NEW;
  END IF;

  v_target_stage := public.crm_stage_from_legacy_label(NEW.kanban_stage);
  IF v_target_stage IS DISTINCT FROM v_current_stage THEN
    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, v_target_stage, 'user');
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.crm_log_event(v_journey_id, 'sync_blocked',
        jsonb_build_object('to', v_target_stage, 'source', 'atendimento', 'error', SQLERRM), 'system');
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- 7. Desligar o motor legado que competia com o CRM -------------------------------
DROP TRIGGER IF EXISTS tr_advance_kanban_on_appointment_outcome ON public.appointments;
