-- =============================================================================
-- CRM Command Center — envio manual de mensagem direto da Fila de Trabalho
-- Data: 2026-07-02
-- Pré-requisito: 20260702a_crm_identity_resolution.sql
--
-- A RLS de outbound_message_queue só permite INSERT via service_role (por
-- design — a fila é do backend). Este RPC SECURITY DEFINER é a ponte segura:
-- valida que o usuário pertence ao tenant do card, resolve o canal/identidade
-- do contato, enfileira a mensagem (process-outbound envia em <1 min via
-- override_message) e já reprograma a próxima ação do card para +24h —
-- follow-up do follow-up, automático.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.crm_send_manual_message(
  p_journey_id uuid,
  p_message text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  j public.crm_journeys;
  v_channel text;
  v_identifier text;
  v_outbound_id uuid;
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

  -- Resolve canal preferencial: identidade whatsapp > canal da sessão > primeira identidade
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

  INSERT INTO public.outbound_message_queue
    (tenant_id, patient_phone, message_type, template_key, template_vars,
     scheduled_at, status, is_edited, reference_id, reference_type,
     notification_channel, channel_recipient_id)
  VALUES
    (j.tenant_id, v_identifier, 'manual_followup', 'manual_followup',
     jsonb_build_object('override_message', p_message, 'journey_id', p_journey_id),
     now(), 'pending', true, NULL, 'crm_manual',
     CASE WHEN v_channel IN ('whatsapp','instagram','facebook','sms') THEN v_channel ELSE 'whatsapp' END,
     v_identifier)
  RETURNING id INTO v_outbound_id;

  -- Ação tratada: próxima checagem em 24h
  UPDATE public.crm_journeys
  SET needs_action = false,
      next_action_at = now() + interval '24 hours',
      next_action_type = 'message',
      updated_at = now()
  WHERE id = p_journey_id;

  PERFORM public.crm_log_event(p_journey_id, 'message_sent',
    jsonb_build_object('manual', true, 'preview', LEFT(p_message, 120), 'channel', v_channel), 'user');

  RETURN v_outbound_id;
END;
$$;

SELECT 'crm_send_manual_message aplicado.' AS resultado;
