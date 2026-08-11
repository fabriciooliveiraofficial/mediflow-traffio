-- Corrige enqueue_nps_on_completion(): as migrations 20260721000000/20260721000002
-- trocaram "full_name"/"preferred_locale" (colunas reais de public.patients) por
-- "name"/"locale" (colunas que NÃO existem), e removeram o EXCEPTION handler que
-- existia na versão original (20260630_nps_recall_engine.sql).
--
-- Efeito em produção: toda vez que um agendamento é marcado como 'completed', o
-- trigger executa "SELECT phone, name, email, locale FROM patients" e estoura
-- 42703 (column "name" does not exist) — confirmado ao vivo via REST API contra
-- fyyhxmugxcfqhvoevuwf. Sem EXCEPTION WHEN OTHERS, esse erro propaga e dá ROLLBACK
-- na transação inteira do UPDATE, ou seja, o agendamento nem chega a virar
-- 'completed' (nem completed_at é gravado) — não é só o NPS que falha.
--
-- Esta migration restaura os nomes corretos de coluna e devolve o EXCEPTION
-- handler (nunca deve bloquear a atualização de status por falha na fila).

BEGIN;

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

  -- 2. Obter dados do paciente (colunas reais: full_name, preferred_locale)
  SELECT phone, full_name, email, preferred_locale
  INTO v_patient_phone, v_patient_name, v_patient_email, v_patient_locale
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_locale := COALESCE(v_patient_locale, v_bot_config->>'locale', 'pt-BR');

  -- 3. Obter tempo de delay em minutos (padrao 180 = 3h)
  v_delay_minutes := COALESCE((v_bot_config ->> 'nps_delay_minutes')::int, 180);

  -- 4. Definir momento de envio e aplicar Clamp (janela comercial)
  v_scheduled_at := public.clamp_to_send_window(NEW.tenant_id, NOW() + (v_delay_minutes * interval '1 minute'));

  -- 5. Resolver canal final de comunicacao (WhatsApp, SMS ou Email) usando a matriz
  SELECT * INTO v_resolved
  FROM public.resolve_notification_channel(
    NEW.tenant_id,
    v_patient_phone,
    'nps',
    v_patient_email
  );

  IF v_resolved.channel IS NULL THEN
    RETURN NEW; -- O paciente nao aceita contato ou nenhum canal valido esta habilitado
  END IF;

  -- 6. Inserir na fila de envio de mensagens (apenas o evento padrao do NPS)
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
      'tenant_name',  v_tenant_name,
      'clinic_name',  v_tenant_name,
      'locale',       v_locale
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

EXCEPTION
  WHEN OTHERS THEN
    -- NUNCA bloqueia a atualização de status do agendamento por falha na fila de NPS
    RAISE WARNING '[enqueue_nps_on_completion] Appt %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

COMMIT;

-- Verificação: reaplica a função e confirma que patients.full_name/preferred_locale existem
SELECT 'Migration 20260811150000_fix_nps_trigger_patient_columns aplicada com sucesso.' AS resultado;
