-- ============================================================
-- Idioma das mensagens: bot_config.notification_locale como fonte de verdade
--
-- Não existe cadastro de idioma por paciente na plataforma. O seletor PT/EN/ES
-- na página Inteligência (Intelligence.tsx) agora persiste em
-- bot_config.notification_locale e essa migration atualiza o trigger síncrono
-- de NPS (enqueue_nps_on_completion) para usar essa configuração como
-- prioridade, com preferred_locale do paciente como fallback legado.
-- ============================================================

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
  v_patient_locale text;
  v_locale         text;
  v_scheduled_at   timestamptz;
  v_local_hour     int;
  v_channel        text;
BEGIN
  IF NEW.status != 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  UPDATE public.appointments
  SET    completed_at = NOW()
  WHERE  id           = NEW.id
    AND  completed_at IS NULL;

  SELECT
    COALESCE(bot_config, '{}'::jsonb),
    COALESCE(name, 'Clínica'),
    COALESCE(timezone, 'America/Sao_Paulo')
  INTO v_bot_config, v_tenant_name, v_tenant_tz
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  v_nps_channels := v_bot_config -> 'channel_automations';
  IF v_nps_channels IS NULL THEN RETURN NEW; END IF;

  IF NOT (
    COALESCE((v_nps_channels -> 'whatsapp' ->> 'nps')::boolean, false) OR
    COALESCE((v_nps_channels -> 'sms'      ->> 'nps')::boolean, false) OR
    COALESCE((v_nps_channels -> 'email'    ->> 'nps')::boolean, false)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT phone, full_name, COALESCE(preferred_locale, 'pt')
  INTO   v_patient_phone, v_patient_name, v_patient_locale
  FROM   public.patients
  WHERE  id = NEW.patient_id;

  IF v_patient_phone IS NULL THEN RETURN NEW; END IF;

  -- Fonte de verdade: bot_config.notification_locale (configurado pelo tenant
  -- na página Inteligência). Fallback: preferred_locale do paciente (legado).
  v_locale := LOWER(COALESCE(v_bot_config ->> 'notification_locale', v_patient_locale, 'pt'));
  IF v_locale NOT IN ('pt', 'en', 'es') THEN
    v_locale := 'pt';
  END IF;

  v_delay_minutes := COALESCE((v_bot_config ->> 'nps_delay_minutes')::int, 180);
  v_scheduled_at  := NOW() + make_interval(mins => v_delay_minutes);

  v_local_hour := EXTRACT(HOUR FROM (v_scheduled_at AT TIME ZONE v_tenant_tz))::int;
  IF v_local_hour >= 22 THEN
    v_scheduled_at := (
      date_trunc('day', v_scheduled_at AT TIME ZONE v_tenant_tz)
      + interval '1 day'
      + interval '8 hours'
    ) AT TIME ZONE v_tenant_tz;
  ELSIF v_local_hour < 8 THEN
    v_scheduled_at := (
      date_trunc('day', v_scheduled_at AT TIME ZONE v_tenant_tz)
      + interval '8 hours'
    ) AT TIME ZONE v_tenant_tz;
  END IF;

  SELECT COALESCE(preferred_channel, 'whatsapp')
  INTO   v_channel
  FROM   public.patient_channel_preferences
  WHERE  patient_phone = v_patient_phone
  LIMIT  1;

  v_channel := COALESCE(v_channel, 'whatsapp');

  IF NOT COALESCE((v_nps_channels -> v_channel ->> 'nps')::boolean, false) THEN
    v_channel := 'whatsapp';
  END IF;

  INSERT INTO public.outbound_message_queue (
    tenant_id,
    patient_phone,
    message_type,
    template_key,
    template_vars,
    scheduled_at,
    reference_id,
    reference_type,
    status,
    notification_channel,
    channel_recipient_id,
    is_edited
  ) VALUES (
    NEW.tenant_id,
    v_patient_phone,
    'nps_survey',
    'nps_survey',
    jsonb_build_object(
      'patient_name', v_patient_name,
      'clinic_name',  v_tenant_name,
      'locale',       v_locale
    ),
    v_scheduled_at,
    NEW.id,
    'appointment',
    'pending',
    v_channel,
    v_patient_phone,
    false
  )
  ON CONFLICT (tenant_id, patient_phone, template_key, reference_id)
  DO NOTHING;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[enqueue_nps_on_completion] Appt %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

SELECT 'Trigger enqueue_nps_on_completion atualizado: notification_locale como fonte de verdade.' AS resultado;
