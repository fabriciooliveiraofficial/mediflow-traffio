-- =============================================================================
-- CRM Journey Engine — Motor (funções, triggers, automação, SLA sweep)
-- Data: 2026-07-01
-- Pré-requisito: 20260701_crm_journey_foundation.sql
--
-- Descoberta crítica que fundamenta este arquivo: appointments.status tem
-- HOJE três grafias divergentes gravadas por telas diferentes em produção:
--   AgendaMestra.tsx        → confirmed / checkin_done / canceled / noshow
--   ReceptionDashboard.tsx  → scheduled / waiting / in_consult / completed
--   FollowUpTimelineDrawer  → completed / no_show (com underscore) / canceled
-- O trigger legado (20260630_kanban_autocomplete.sql) só reagia a
-- 'completed'/'no_show' e por isso ficava cego às duas primeiras telas.
-- Este motor normaliza todas as variantes conhecidas como sinônimos.
-- =============================================================================

-- 1. Helper: mapeia estágio novo → legado (mirror em conversation_sessions.kanban_stage)
CREATE OR REPLACE FUNCTION public.crm_legacy_stage_label(p_stage_id text, p_appointments_count int)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_stage_id
    WHEN 'new_lead'   THEN 'Novos Leads'
    WHEN 'in_contact' THEN 'Em Contato'
    WHEN 'scheduled'  THEN CASE WHEN p_appointments_count > 1 THEN 'Consulta' ELSE 'Avaliação' END
    WHEN 'showed_up'  THEN CASE WHEN p_appointments_count > 1 THEN 'Consulta' ELSE 'Avaliação' END
    WHEN 'proposal'   THEN 'Consulta'
    WHEN 'recovery'   THEN CASE WHEN p_appointments_count > 1 THEN 'Faltou Consulta' ELSE 'Faltou Avaliação' END
    WHEN 'recall_due' THEN 'Em Contato'
    WHEN 'won'        THEN 'Vendido/Procedimento'
    WHEN 'lost'        THEN 'Perdido'
    ELSE 'Novos Leads'
  END;
$$;

-- 2. Helper: mapeia legado → estágio novo (leitura de gravações diretas feitas
--    por HumanInboxPage.tsx / SidebarLeadClassifyView.tsx, que continuam
--    escrevendo em conversation_sessions.kanban_stage sem passar pelo motor)
CREATE OR REPLACE FUNCTION public.crm_stage_from_legacy_label(p_label text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_label
    WHEN 'Novos Leads'             THEN 'new_lead'
    WHEN 'Em Contato'              THEN 'in_contact'
    WHEN 'Avaliação'               THEN 'scheduled'
    WHEN 'Consulta'                THEN 'scheduled'
    WHEN 'Faltou Avaliação'        THEN 'recovery'
    WHEN 'Faltou Consulta'         THEN 'recovery'
    WHEN 'Reagendamento Avaliação' THEN 'recovery'
    WHEN 'Vendido/Procedimento'    THEN 'won'
    WHEN 'Perdido'                 THEN 'lost'
    ELSE 'new_lead'
  END;
$$;

-- 3. Priority score determinístico (0-100), auditável, sem caixa-preta:
--    valor estimado (0-40) + recência de engajamento (0-30)
--    + urgência de SLA no estágio (0-20) + penalidade de faltas (0-10)
CREATE OR REPLACE FUNCTION public.crm_calculate_priority_score(p_journey_id uuid)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  j public.crm_journeys;
  v_sla_hours int;
  v_hours_since_event numeric;
  v_hours_in_stage numeric;
  v_value_pts int;
  v_recency_pts int;
  v_urgency_pts int;
  v_noshow_pts int;
BEGIN
  SELECT * INTO j FROM public.crm_journeys WHERE id = p_journey_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT sla_hours INTO v_sla_hours FROM public.crm_stages WHERE id = j.stage_id;

  v_value_pts := LEAST(40, FLOOR(j.revenue_estimated / 100)::int);

  v_hours_since_event := GREATEST(0, EXTRACT(EPOCH FROM (now() - j.last_event_at)) / 3600);
  v_recency_pts := GREATEST(0, 30 - FLOOR(v_hours_since_event / 4)::int);

  IF v_sla_hours IS NULL THEN
    v_urgency_pts := 0;
  ELSE
    v_hours_in_stage := GREATEST(0, EXTRACT(EPOCH FROM (now() - j.stage_entered_at)) / 3600);
    v_urgency_pts := LEAST(20, FLOOR(20 * v_hours_in_stage / v_sla_hours)::int);
  END IF;

  v_noshow_pts := LEAST(10, j.no_show_count * 5);

  RETURN LEAST(100, v_value_pts + v_recency_pts + v_urgency_pts + v_noshow_pts);
END;
$$;

-- 4. Janela de envio por tenant — evita cadência disparando de madrugada
CREATE OR REPLACE FUNCTION public.crm_clamp_to_send_window(p_tenant_id uuid, p_ts timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
AS $$
DECLARE
  v_tz text;
  v_start time;
  v_end time;
  v_local timestamp;
BEGIN
  SELECT COALESCE(t.timezone, 'America/Sao_Paulo') INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
  SELECT COALESCE(w.window_start, '08:00'), COALESCE(w.window_end, '20:00')
    INTO v_start, v_end
    FROM (SELECT 1) x
    LEFT JOIN public.crm_send_windows w ON w.tenant_id = p_tenant_id;

  v_local := p_ts AT TIME ZONE v_tz;

  IF v_local::time < v_start THEN
    RETURN (v_local::date + v_start) AT TIME ZONE v_tz;
  ELSIF v_local::time > v_end THEN
    RETURN (v_local::date + 1 + v_start) AT TIME ZONE v_tz;
  ELSE
    RETURN p_ts;
  END IF;
END;
$$;

-- 5. Log de evento controlado — único ponto de escrita em crm_journey_events
--    (a tabela só aceita INSERT de service_role via RLS; toda gravação de
--    evento passa por aqui, nunca por INSERT direto do cliente)
CREATE OR REPLACE FUNCTION public.crm_log_event(
  p_journey_id uuid, p_event_type text, p_payload jsonb DEFAULT '{}'::jsonb, p_actor text DEFAULT 'system'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.crm_journeys WHERE id = p_journey_id;
  IF v_tenant_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.crm_journey_events (tenant_id, journey_id, event_type, payload, actor)
  VALUES (v_tenant_id, p_journey_id, p_event_type, p_payload, p_actor)
  RETURNING id INTO v_id;

  UPDATE public.crm_journeys SET last_event_at = now(), updated_at = now() WHERE id = p_journey_id;

  RETURN v_id;
END;
$$;

-- 6. Get-or-create: 1 card por paciente/telefone. Se já existir um card por
--    telefone (lead pré-cadastro) e agora chegar um patient_id, faz upgrade
--    do MESMO card em vez de criar um segundo (resolve duplicidade walk-in
--    vs. lead-por-telefone).
CREATE OR REPLACE FUNCTION public.crm_ensure_journey(
  p_tenant_id uuid, p_patient_id uuid, p_lead_phone text, p_session_id uuid, p_origin text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_patient_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.crm_journeys
    WHERE tenant_id = p_tenant_id AND patient_id = p_patient_id AND stage_id NOT IN ('won','lost')
    LIMIT 1;
  END IF;

  IF v_id IS NULL AND p_lead_phone IS NOT NULL THEN
    SELECT id INTO v_id FROM public.crm_journeys
    WHERE tenant_id = p_tenant_id
      AND lead_phone = p_lead_phone
      AND (patient_id IS NULL OR patient_id = p_patient_id)
      AND stage_id NOT IN ('won','lost')
    LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    -- Upgrade: preenche patient_id/session_id se agora disponíveis, sem tocar origin/stage
    UPDATE public.crm_journeys
    SET patient_id = COALESCE(patient_id, p_patient_id),
        session_id = COALESCE(session_id, p_session_id),
        lead_phone = COALESCE(lead_phone, p_lead_phone),
        updated_at = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  BEGIN
    INSERT INTO public.crm_journeys (tenant_id, patient_id, lead_phone, session_id, stage_id, origin, stage_entered_at)
    VALUES (p_tenant_id, p_patient_id, p_lead_phone, p_session_id, 'new_lead', p_origin, now())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Corrida entre triggers (ex.: patients e conversation_sessions disparando quase
    -- simultaneamente para o mesmo paciente): outra chamada já criou o card primeiro.
    IF p_patient_id IS NOT NULL THEN
      SELECT id INTO v_id FROM public.crm_journeys
      WHERE tenant_id = p_tenant_id AND patient_id = p_patient_id AND stage_id NOT IN ('won','lost')
      LIMIT 1;
    END IF;
    IF v_id IS NULL AND p_lead_phone IS NOT NULL THEN
      SELECT id INTO v_id FROM public.crm_journeys
      WHERE tenant_id = p_tenant_id AND lead_phone = p_lead_phone AND stage_id NOT IN ('won','lost')
      LIMIT 1;
    END IF;
    IF v_id IS NOT NULL THEN
      UPDATE public.crm_journeys
      SET patient_id = COALESCE(patient_id, p_patient_id),
          session_id = COALESCE(session_id, p_session_id),
          updated_at = now()
      WHERE id = v_id;
      RETURN v_id;
    END IF;
    RAISE;
  END;

  PERFORM public.crm_log_event(v_id, 'journey_created', jsonb_build_object('origin', p_origin), 'system');
  UPDATE public.crm_journeys SET priority_score = public.crm_calculate_priority_score(v_id) WHERE id = v_id;

  RETURN v_id;
END;
$$;

-- 7. Dispatch de automação por estágio — idempotente (crm_automation_runs),
--    respeita janela de envio, reusa outbound_message_queue/process-outbound
CREATE OR REPLACE FUNCTION public.crm_dispatch_automations(p_journey_id uuid, p_cycle int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  j public.crm_journeys;
  v_phone text;
  a RECORD;
  v_scheduled_at timestamptz;
  v_run_id uuid;
  v_outbound_id uuid;
BEGIN
  SELECT * INTO j FROM public.crm_journeys WHERE id = p_journey_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_phone := j.lead_phone;
  IF v_phone IS NULL AND j.patient_id IS NOT NULL THEN
    SELECT phone INTO v_phone FROM public.patients WHERE id = j.patient_id;
  END IF;
  IF v_phone IS NULL THEN RETURN; END IF;

  FOR a IN
    SELECT DISTINCT ON (stage_id, template_key) *
    FROM public.crm_stage_automations
    WHERE stage_id = j.stage_id AND trigger_kind = 'on_enter' AND is_active = true
      AND (tenant_id = j.tenant_id OR tenant_id IS NULL)
    ORDER BY stage_id, template_key, tenant_id NULLS LAST  -- override do tenant vence o default global
  LOOP
    v_scheduled_at := public.crm_clamp_to_send_window(j.tenant_id, j.stage_entered_at + (a.delay_hours * interval '1 hour'));

    INSERT INTO public.crm_automation_runs (tenant_id, journey_id, automation_id, cycle, status)
    VALUES (j.tenant_id, p_journey_id, a.id, p_cycle, 'scheduled')
    ON CONFLICT (journey_id, automation_id, cycle) DO NOTHING
    RETURNING id INTO v_run_id;

    IF v_run_id IS NOT NULL THEN
      -- message_type = template_key (não uma constante): o índice único
      -- idx_outbound_queue_unique_msg já existente é por
      -- (tenant_id, patient_phone, message_type, reference_id, notification_channel).
      -- Como reference_id é o journey_id (igual para todas as mensagens da
      -- cadência D0/D2/D7), message_type precisa diferenciar cada uma —
      -- mesma convenção que o resto do app já usa ('recall', 'nps', etc.).
      INSERT INTO public.outbound_message_queue
        (tenant_id, patient_phone, message_type, template_key, template_vars, scheduled_at, status, reference_id, reference_type)
      VALUES
        (j.tenant_id, v_phone, a.template_key, a.template_key,
         jsonb_build_object('journey_id', p_journey_id, 'procedure_name', j.procedure_name),
         v_scheduled_at, 'pending', p_journey_id, 'crm_journey')
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_outbound_id;

      UPDATE public.crm_automation_runs SET outbound_id = v_outbound_id WHERE id = v_run_id;
      PERFORM public.crm_log_event(p_journey_id, 'automation_fired',
        jsonb_build_object('template_key', a.template_key, 'scheduled_at', v_scheduled_at), 'system');
    END IF;
  END LOOP;
END;
$$;

-- 8. Núcleo do motor: única porta de mudança de estágio. UI (RPC), bot e
--    triggers de appointments/patients/conversation_sessions chamam esta
--    mesma função — impossível o card e o kanban divergirem.
CREATE OR REPLACE FUNCTION public.crm_move_stage(
  p_journey_id uuid, p_to_stage text, p_actor text DEFAULT 'user',
  p_reason text DEFAULT NULL, p_extra jsonb DEFAULT '{}'::jsonb
) RETURNS public.crm_journeys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  -- AuthZ: chamadas de usuário autenticado precisam pertencer ao tenant do card.
  -- Chamadas internas (triggers/cron/service_role) não têm auth.uid() — passam.
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = j.tenant_id
    ) THEN
      RAISE EXCEPTION 'forbidden: user does not belong to this tenant' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_old_stage := j.stage_id;

  IF p_to_stage = v_old_stage THEN
    RETURN j; -- no-op: evita eventos/automação duplicados
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
$$;

-- 9. Trigger: appointments → cria/avança journey. Normaliza as 3 grafias
--    reais de status vistas em produção (ver cabeçalho deste arquivo).
CREATE OR REPLACE FUNCTION public.crm_trg_appointments()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_journey_id uuid;
  v_phone text;
  v_next timestamptz;
BEGIN
  SELECT phone INTO v_phone FROM public.patients WHERE id = NEW.patient_id;

  v_journey_id := public.crm_ensure_journey(NEW.tenant_id, NEW.patient_id, v_phone, NULL, 'conversation');

  SELECT MIN((a.date + a.start_time)::timestamp AT TIME ZONE COALESCE(t.timezone, 'America/Sao_Paulo'))
    INTO v_next
    FROM public.appointments a
    JOIN public.tenants t ON t.id = a.tenant_id
   WHERE a.patient_id = NEW.patient_id
     AND a.tenant_id = NEW.tenant_id
     AND a.status NOT IN ('canceled','cancelled','noshow','no_show')
     AND (a.date + a.start_time)::timestamp AT TIME ZONE COALESCE(t.timezone, 'America/Sao_Paulo') >= now();

  IF TG_OP = 'INSERT' THEN
    UPDATE public.crm_journeys
    SET appointments_count = appointments_count + 1, next_appointment_at = v_next
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

  UPDATE public.crm_journeys SET next_appointment_at = v_next WHERE id = v_journey_id;

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

DROP TRIGGER IF EXISTS tr_crm_appointments ON public.appointments;
CREATE TRIGGER tr_crm_appointments
  AFTER INSERT OR UPDATE OF status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.crm_trg_appointments();

-- 10. Trigger: patients → resolve o walk-in ("a clínica atende alguém e o
--     CRM nunca fica sabendo"). Se já existir card por telefone (lead que
--     conversou antes de virar paciente), crm_ensure_journey faz o upgrade.
CREATE OR REPLACE FUNCTION public.crm_trg_patients()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.crm_ensure_journey(NEW.tenant_id, NEW.id, NEW.phone, NULL, 'walk_in');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_crm_patients ON public.patients;
CREATE TRIGGER tr_crm_patients
  AFTER INSERT ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.crm_trg_patients();

-- 11. Trigger: conversation_sessions → cria journey ao nascer a conversa;
--     mantém sincronia bidirecional com kanban_stage legado (guardas contra
--     eco: ver comentário no crm_move_stage, passo "espelha").
CREATE OR REPLACE FUNCTION public.crm_trg_conversation_sessions()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

    PERFORM public.crm_ensure_journey(NEW.tenant_id, v_patient_id, NEW.patient_phone, NEW.id, 'conversation');
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE' OF kanban_stage — só reage a gravações externas (HumanInboxPage /
  -- SidebarLeadClassifyView). Gravações originadas pelo próprio crm_move_stage já
  -- chegam aqui com o valor já convertido, então v_target = v_current e o guard abaixo
  -- impede loop.
  IF NEW.kanban_stage IS NOT DISTINCT FROM OLD.kanban_stage THEN
    RETURN NEW;
  END IF;

  SELECT id, stage_id INTO v_journey_id, v_current_stage FROM public.crm_journeys WHERE session_id = NEW.id LIMIT 1;
  IF v_journey_id IS NULL THEN RETURN NEW; END IF;

  v_target_stage := public.crm_stage_from_legacy_label(NEW.kanban_stage);
  IF v_target_stage IS DISTINCT FROM v_current_stage THEN
    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, v_target_stage, 'user');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[crm_trg_conversation_sessions] transição legada inválida % -> % (session %): %',
        v_current_stage, v_target_stage, NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_crm_conversation_sessions_insert ON public.conversation_sessions;
CREATE TRIGGER tr_crm_conversation_sessions_insert
  AFTER INSERT ON public.conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.crm_trg_conversation_sessions();

DROP TRIGGER IF EXISTS tr_crm_conversation_sessions_update ON public.conversation_sessions;
CREATE TRIGGER tr_crm_conversation_sessions_update
  AFTER UPDATE OF kanban_stage ON public.conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.crm_trg_conversation_sessions();

-- 12. Trigger: conversation_messages → alimenta a timeline e dispara
--     stop-conditions (paciente respondeu = cancela cadência de recuperação)
CREATE OR REPLACE FUNCTION public.crm_trg_conversation_messages()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
$$;

DROP TRIGGER IF EXISTS tr_crm_conversation_messages ON public.conversation_messages;
CREATE TRIGGER tr_crm_conversation_messages
  AFTER INSERT ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.crm_trg_conversation_messages();

-- 13. Stop conditions: resposta do paciente / novo agendamento / venda
--     cancelam automaticamente as mensagens de cadência ainda pendentes.
--     Sem isto, a clínica manda "sentimos sua falta" pra quem já remarcou —
--     o erro mais comum e mais danoso em motores de recuperação.
CREATE OR REPLACE FUNCTION public.crm_trg_stop_conditions()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_stop_signal text;
BEGIN
  v_stop_signal := CASE NEW.event_type
    WHEN 'message_received'    THEN 'reply'
    WHEN 'appointment_created' THEN 'booking'
    WHEN 'sale_recorded'       THEN 'payment'
    ELSE NULL
  END;
  IF v_stop_signal IS NULL THEN RETURN NEW; END IF;

  WITH stopped AS (
    UPDATE public.crm_automation_runs r
    SET status = 'stopped', stopped_reason = v_stop_signal
    FROM public.crm_stage_automations a
    WHERE r.automation_id = a.id
      AND r.journey_id = NEW.journey_id
      AND r.status = 'scheduled'
      AND v_stop_signal = ANY (a.stop_on)
    RETURNING r.outbound_id
  )
  UPDATE public.outbound_message_queue q
  SET status = 'cancelled'
  FROM stopped s
  WHERE q.id = s.outbound_id AND q.status = 'pending';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_crm_stop_conditions ON public.crm_journey_events;
CREATE TRIGGER tr_crm_stop_conditions
  AFTER INSERT ON public.crm_journey_events
  FOR EACH ROW
  WHEN (NEW.event_type IN ('message_received','appointment_created','sale_recorded'))
  EXECUTE FUNCTION public.crm_trg_stop_conditions();

-- 14. SLA sweep — roda a cada 15 min via pg_cron (SQL puro, sem precisar de
--     service_role key): marca needs_action e recalcula priority_score.
CREATE OR REPLACE FUNCTION public.crm_sweep_journey_sla()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
$$;

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'crm-journey-sla-sweep';
SELECT cron.schedule(
  'crm-journey-sla-sweep',
  '*/15 * * * *',
  $$ SELECT public.crm_sweep_journey_sla(); $$
);

-- 15. Aposenta o trigger legado de 30/06 — checava apenas 'completed'/'no_show'
--     (grafia usada só pelo drawer do CRM), ficando cego a checkin_done/noshow/
--     canceled gravados pela Agenda Mestra e pelo painel de recepção.
DROP TRIGGER IF EXISTS tr_advance_kanban_on_appointment_outcome ON public.appointments;
DROP FUNCTION IF EXISTS public.advance_kanban_on_appointment_outcome();

SELECT 'CRM Journey Engine — Motor aplicado.' AS resultado;
