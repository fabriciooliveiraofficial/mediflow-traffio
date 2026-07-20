-- Migration to fix silent fallback issues in NPS and CRM triggers

-- 1. Fix enqueue_nps_on_completion silently exiting if 'channel_automations' is not set
CREATE OR REPLACE FUNCTION public.enqueue_nps_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bot_config     jsonb;
  v_tenant_name    text;
  v_tenant_tz      text;
  v_nps_channels   jsonb;
  v_delay_minutes  int;
  v_patient_phone  text;
  v_patient_name   text;
  v_patient_email  text;
  v_patient_locale text;
  v_locale         text;
  v_scheduled_at   timestamptz;
  v_local_hour     int;
  v_resolved       record;
  v_is_nps_enabled boolean;
BEGIN
  -- Apenas quando o agendamento muda PARA 'completed'
  IF NEW.status != 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  -- Gravar a data exata de conclusao (se nao existir)
  UPDATE public.appointments
  SET    completed_at = NOW()
  WHERE  id           = NEW.id
    AND  completed_at IS NULL;

  -- 1. Obter tenant, config do bot e timezone
  SELECT
    COALESCE(bot_config, '{}'::jsonb),
    name,
    COALESCE(timezone, 'America/Sao_Paulo')
  INTO v_bot_config, v_tenant_name, v_tenant_tz
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  -- Verificar se NPS esta habilitado globalmente (fallback se matrix estiver ausente)
  v_nps_channels := v_bot_config -> 'channel_automations';
  
  IF v_nps_channels IS NULL THEN
    -- Fallback de retrocompatibilidade para tenants pre-matriz
    v_is_nps_enabled := COALESCE((v_bot_config ->> 'nps_enabled')::boolean, true);
    IF NOT v_is_nps_enabled THEN
      RETURN NEW;
    END IF;
  ELSE
    -- Validacao matriz: cancela rapido se o NPS estiver desativado em TODOS os canais
    IF NOT (
      COALESCE((v_nps_channels -> 'whatsapp' ->> 'nps')::boolean, false) OR
      COALESCE((v_nps_channels -> 'sms'      ->> 'nps')::boolean, false) OR
      COALESCE((v_nps_channels -> 'email'    ->> 'nps')::boolean, false)
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 2. Obter dados do paciente
  SELECT phone, name, email, locale
  INTO v_patient_phone, v_patient_name, v_patient_email, v_patient_locale
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_locale := COALESCE(v_patient_locale, v_bot_config->>'locale', 'pt-BR');

  -- 3. Obter tempo de delay em minutos (padrao 180 = 3h)
  v_delay_minutes := COALESCE((v_bot_config ->> 'nps_delay_minutes')::int, 180);

  -- 4. Definir momento de envio e aplicar Clamp (Window 8h - 20h)
  v_scheduled_at := public.clamp_to_send_window(NEW.tenant_id, NOW() + (v_delay_minutes * interval '1 minute'));

  -- 5. Resolver canal final de comunicacao (WhatsApp, SMS ou Email) usando a matriz
  v_resolved := public.resolve_notification_channel(
    NEW.tenant_id,
    v_patient_phone,
    'nps',
    v_patient_email
  );

  IF v_resolved IS NULL THEN
    RETURN NEW; -- O paciente nao aceita contato ou nenhum canal valido esta habilitado
  END IF;

  -- 6. Inserir na fila de envio de mensagens (apenas o evento padrao do NPS)
  -- idx_outbound_queue_unique_msg impede envio repetido caso algo ative multiplas vezes
  INSERT INTO public.outbound_message_queue (
    tenant_id,
    patient_phone,
    message_type,
    template_key,
    template_vars,
    scheduled_at,
    status,
    reference_id,
    reference_type,
    notification_channel,
    channel_recipient_id
  ) VALUES (
    NEW.tenant_id,
    v_patient_phone,
    'nps_survey',
    'nps_survey',
    jsonb_build_object(
      'patient_name', v_patient_name,
      'tenant_name',  v_tenant_name
    ),
    v_scheduled_at,
    'pending',
    NEW.id,
    'appointment',
    v_resolved.channel,
    v_resolved.recipient_id
  )
  ON CONFLICT (tenant_id, patient_phone, message_type, reference_id, notification_channel)
  WHERE status != 'cancelled'
  DO NOTHING;

  RETURN NEW;
END;
$$;


-- 2. Modify crm_trg_appointments to LOG the error instead of swallowing it
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
  v_phone := (SELECT phone FROM public.patients WHERE id = NEW.patient_id);
  v_journey_id := public.crm_ensure_journey(NEW.tenant_id, NEW.patient_id, v_phone, NULL, 'conversation');

  -- Busca o próximo appointment real agendado no futuro para o mesmo paciente
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
$$;
