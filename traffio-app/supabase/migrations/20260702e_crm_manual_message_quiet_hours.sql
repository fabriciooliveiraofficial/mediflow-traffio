-- =============================================================================
-- CRM Command Center — mensagem manual ciente do horário de envio (quiet hours)
-- Data: 2026-07-02
-- Substitui: crm_send_manual_message de 20260702c
--
-- Decisão de produto (do cliente): o timezone do tenant é fonte de verdade e
-- NUNCA deve ser alterado para "fazer a mensagem sair". Quando o operador envia
-- fora da janela, o correto é (a) agendar o envio para a próxima abertura da
-- janela — em vez de deixar a mensagem em loop claim/release a noite inteira —
-- e (b) devolver ao frontend os dados para exibir um toast informativo:
-- "fora do horário de envio; agendada para X (horário da clínica)".
--
-- Retorno muda de uuid para jsonb:
--   { outbound_id, scheduled_at, delayed, timezone, window_start, window_end }
-- =============================================================================

DROP FUNCTION IF EXISTS public.crm_send_manual_message(uuid, text);

CREATE OR REPLACE FUNCTION public.crm_send_manual_message(
  p_journey_id uuid,
  p_message text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  j public.crm_journeys;
  v_channel text;
  v_identifier text;
  v_outbound_id uuid;
  v_scheduled_at timestamptz;
  v_delayed boolean;
  v_tz text;
  v_start time;
  v_end time;
BEGIN
  IF p_message IS NULL OR length(trim(p_message)) = 0 THEN
    RAISE EXCEPTION 'message is empty' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO j FROM public.crm_journeys WHERE id = p_journey_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'journey not found'; END IF;

  -- AuthZ obrigatório: só membros do tenant
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = j.tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Resolve canal preferencial: identidade whatsapp > instagram > facebook > demais
  SELECT channel, identifier INTO v_channel, v_identifier
  FROM public.crm_journey_identities
  WHERE journey_id = p_journey_id
  ORDER BY CASE channel WHEN 'whatsapp' THEN 0 WHEN 'instagram' THEN 1 WHEN 'facebook' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_identifier IS NULL THEN
    v_channel := 'whatsapp';
    v_identifier := j.lead_phone;
    IF v_identifier IS NULL AND j.patient_id IS NOT NULL THEN
      SELECT phone INTO v_identifier FROM public.patients WHERE id = j.patient_id;
    END IF;
  END IF;
  IF v_identifier IS NULL THEN
    RAISE EXCEPTION 'journey has no reachable channel' USING ERRCODE = '22023';
  END IF;

  -- Janela de envio no fuso do tenant (fonte de verdade — nunca alterada aqui).
  -- Agenda direto para a próxima abertura em vez de deixar o processador
  -- devolver a mensagem à fila a cada minuto durante a madrugada.
  v_scheduled_at := public.crm_clamp_to_send_window(j.tenant_id, now());
  v_delayed := v_scheduled_at > now() + interval '2 minutes';

  SELECT COALESCE(t.timezone, 'America/Sao_Paulo') INTO v_tz FROM public.tenants t WHERE t.id = j.tenant_id;
  SELECT COALESCE(w.window_start, '08:00'::time), COALESCE(w.window_end, '20:00'::time)
    INTO v_start, v_end
    FROM (SELECT 1) x
    LEFT JOIN public.crm_send_windows w ON w.tenant_id = j.tenant_id;

  INSERT INTO public.outbound_message_queue
    (tenant_id, patient_phone, message_type, template_key, template_vars,
     scheduled_at, status, is_edited, reference_id, reference_type,
     notification_channel, channel_recipient_id)
  VALUES
    (j.tenant_id, v_identifier, 'manual_followup', 'manual_followup',
     jsonb_build_object('override_message', p_message, 'journey_id', p_journey_id),
     v_scheduled_at, 'pending', true, NULL, 'crm_manual',
     CASE WHEN v_channel IN ('whatsapp','instagram','facebook','sms') THEN v_channel ELSE 'whatsapp' END,
     v_identifier)
  RETURNING id INTO v_outbound_id;

  -- Ação tratada: próxima checagem 24h após o envio efetivo
  UPDATE public.crm_journeys
  SET needs_action = false,
      next_action_at = v_scheduled_at + interval '24 hours',
      next_action_type = 'message',
      updated_at = now()
  WHERE id = p_journey_id;

  PERFORM public.crm_log_event(p_journey_id, 'message_sent',
    jsonb_build_object('manual', true, 'preview', LEFT(p_message, 120),
                       'channel', v_channel, 'scheduled_at', v_scheduled_at, 'delayed', v_delayed), 'user');

  RETURN jsonb_build_object(
    'outbound_id',  v_outbound_id,
    'scheduled_at', v_scheduled_at,
    'delayed',      v_delayed,
    'timezone',     v_tz,
    'window_start', to_char(v_start, 'HH24:MI'),
    'window_end',   to_char(v_end, 'HH24:MI')
  );
END;
$$;

SELECT 'crm_send_manual_message v2 (quiet-hours-aware) aplicado.' AS resultado;
