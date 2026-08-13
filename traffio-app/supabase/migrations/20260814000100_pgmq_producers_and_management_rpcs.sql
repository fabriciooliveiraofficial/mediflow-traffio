-- =============================================================================
-- Migração pgmq — parte 2: produtores SQL + RPCs de gestão
-- Data: 2026-08-14
--
-- Reescreve os 3 produtores que hoje inserem direto em outbound_message_queue
-- (enqueue_nps_on_completion, crm_dispatch_automations, crm_trg_stop_conditions)
-- e a RPC de mensagem manual do CRM (crm_send_manual_message) para usar
-- outbound_reminder_registry + pgmq. Cria as RPCs que a tela de gestão de fila
-- (useOutboundQueue.ts e afins) passa a chamar no lugar de UPDATE direto.
-- =============================================================================

BEGIN;

-- 1. Helper compartilhado: produzir uma mensagem (registro + pgmq), uma vez só ---
-- Não valida auth/tenant — é chamado só de dentro de outras funções
-- SECURITY DEFINER que já validaram o contexto (trigger interno, RPC que já
-- checou auth.uid()). Idempotente pelo mesmo índice único de sempre.

CREATE OR REPLACE FUNCTION public.outbound_enqueue_message(
    p_tenant_id            uuid,
    p_patient_phone        text,
    p_message_type         text,
    p_template_key         text,
    p_template_vars        jsonb,
    p_scheduled_at         timestamptz,
    p_reference_id         uuid,
    p_reference_type       text,
    p_notification_channel text DEFAULT 'whatsapp',
    p_channel_recipient_id text DEFAULT NULL,
    p_is_edited            boolean DEFAULT false,
    p_media_url            text DEFAULT NULL,
    p_media_type           text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registry_id uuid;
  v_msg_id      bigint;
BEGIN
  INSERT INTO public.outbound_reminder_registry (
    tenant_id, patient_phone, message_type, template_key, template_vars,
    scheduled_at, status, reference_id, reference_type,
    notification_channel, channel_recipient_id, is_edited, media_url, media_type
  ) VALUES (
    p_tenant_id, p_patient_phone, p_message_type, p_template_key, COALESCE(p_template_vars, '{}'::jsonb),
    p_scheduled_at, 'pending', p_reference_id, p_reference_type,
    COALESCE(p_notification_channel, 'whatsapp'), p_channel_recipient_id, COALESCE(p_is_edited, false),
    p_media_url, p_media_type
  )
  ON CONFLICT (tenant_id, patient_phone, message_type, reference_id, notification_channel) DO NOTHING
  RETURNING id INTO v_registry_id;

  -- Já existia (dedup) — nada a fazer, devolve NULL como hoje o upsert
  -- ignoreDuplicates devolvia silenciosamente.
  IF v_registry_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Corpo da mensagem no pgmq carrega só o ponteiro pro registro — o
  -- consumidor (process-outbound) sempre relê o registro na hora de
  -- processar, então "editar" uma mensagem pendente é só um UPDATE no
  -- registro, sem precisar tocar a fila.
  SELECT * INTO v_msg_id FROM pgmq.send(
    'outbound_notifications',
    jsonb_build_object('registry_id', v_registry_id),
    p_scheduled_at
  );

  UPDATE public.outbound_reminder_registry SET queue_msg_id = v_msg_id WHERE id = v_registry_id;

  RETURN v_registry_id;
END;
$$;

-- 2. enqueue_nps_on_completion — mesma lógica, só troca o destino do INSERT ------

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
  IF NEW.status != 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  UPDATE public.appointments
  SET    completed_at = NOW()
  WHERE  id           = NEW.id
    AND  completed_at IS NULL;

  SELECT
    COALESCE(bot_config, '{}'::jsonb),
    name,
    COALESCE(timezone, 'America/Sao_Paulo')
  INTO v_bot_config, v_tenant_name, v_tenant_tz
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  v_nps_channels := v_bot_config -> 'channel_automations';

  IF v_nps_channels IS NULL THEN
    v_is_nps_enabled := COALESCE((v_bot_config ->> 'nps_enabled')::boolean, true);
    IF NOT v_is_nps_enabled THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NOT (
      COALESCE((v_nps_channels -> 'whatsapp' ->> 'nps')::boolean, false) OR
      COALESCE((v_nps_channels -> 'sms'      ->> 'nps')::boolean, false) OR
      COALESCE((v_nps_channels -> 'email'    ->> 'nps')::boolean, false)
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT phone, full_name, email, preferred_locale
  INTO v_patient_phone, v_patient_name, v_patient_email, v_patient_locale
  FROM public.patients
  WHERE id = NEW.patient_id;

  v_locale := COALESCE(v_patient_locale, v_bot_config->>'locale', 'pt-BR');

  v_delay_minutes := COALESCE((v_bot_config ->> 'nps_delay_minutes')::int, 180);

  v_scheduled_at := public.crm_clamp_to_send_window(NEW.tenant_id, NOW() + (v_delay_minutes * interval '1 minute'));

  SELECT * INTO v_resolved
  FROM public.resolve_notification_channel(
    NEW.tenant_id,
    v_patient_phone,
    'nps',
    v_patient_email
  );

  IF v_resolved.channel IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.outbound_enqueue_message(
    p_tenant_id            => NEW.tenant_id,
    p_patient_phone        => v_patient_phone,
    p_message_type         => 'nps_survey',
    p_template_key         => 'nps_survey',
    p_template_vars        => jsonb_build_object(
                                 'patient_name', v_patient_name,
                                 'tenant_name',  v_tenant_name,
                                 'clinic_name',  v_tenant_name,
                                 'locale',       v_locale
                               ),
    p_scheduled_at         => v_scheduled_at,
    p_reference_id         => NEW.id,
    p_reference_type       => 'appointment',
    p_notification_channel => v_resolved.channel,
    p_channel_recipient_id => v_resolved.recipient_id
  );

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[enqueue_nps_on_completion] Appt %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- 3. crm_dispatch_automations — mesma lógica, INSERT vira chamada ao helper -----

CREATE OR REPLACE FUNCTION public.crm_dispatch_automations(p_journey_id uuid, p_cycle integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  j public.crm_journeys;
  v_phone text;
  a RECORD;
  v_scheduled_at timestamptz;
  v_run_id uuid;
  v_outbound_id uuid;
  v_patient_name text;
  v_patient_locale text;
  v_clinic_name text;
  v_bot_config jsonb;
  v_locale text;
BEGIN
  SELECT * INTO j FROM public.crm_journeys WHERE id = p_journey_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_phone := j.lead_phone;
  IF j.patient_id IS NOT NULL THEN
    SELECT phone, full_name, preferred_locale
    INTO v_phone, v_patient_name, v_patient_locale
    FROM public.patients WHERE id = j.patient_id;
    v_phone := COALESCE(j.lead_phone, v_phone);
  END IF;
  IF v_phone IS NULL THEN RETURN; END IF;

  IF v_patient_name IS NULL AND j.session_id IS NOT NULL THEN
    SELECT platform_display_name INTO v_patient_name
    FROM public.conversation_sessions WHERE id = j.session_id;
  END IF;

  SELECT COALESCE(name, 'Clínica'), COALESCE(bot_config, '{}'::jsonb)
  INTO v_clinic_name, v_bot_config
  FROM public.tenants WHERE id = j.tenant_id;

  v_locale := LOWER(COALESCE(v_bot_config ->> 'notification_locale', v_patient_locale, 'pt'));
  IF v_locale NOT IN ('pt', 'en', 'es') THEN v_locale := 'pt'; END IF;

  FOR a IN
    SELECT DISTINCT ON (stage_id, template_key) *
    FROM public.crm_stage_automations
    WHERE stage_id = j.stage_id AND trigger_kind = 'on_enter' AND is_active = true
      AND (tenant_id = j.tenant_id OR tenant_id IS NULL)
    ORDER BY stage_id, template_key, tenant_id NULLS LAST
  LOOP
    v_scheduled_at := public.crm_clamp_to_send_window(j.tenant_id, j.stage_entered_at + (a.delay_hours * interval '1 hour'));

    INSERT INTO public.crm_automation_runs (tenant_id, journey_id, automation_id, cycle, status)
    VALUES (j.tenant_id, p_journey_id, a.id, p_cycle, 'scheduled')
    ON CONFLICT (journey_id, automation_id, cycle) DO NOTHING
    RETURNING id INTO v_run_id;

    IF v_run_id IS NOT NULL THEN
      -- message_type = template_key (não uma constante): mesmo motivo de
      -- sempre — reference_id é o journey_id, igual para toda a cadência
      -- D0/D2/D7, então message_type precisa diferenciar cada mensagem.
      v_outbound_id := public.outbound_enqueue_message(
        p_tenant_id      => j.tenant_id,
        p_patient_phone  => v_phone,
        p_message_type   => a.template_key,
        p_template_key   => a.template_key,
        p_template_vars  => jsonb_build_object(
                               'journey_id',     p_journey_id,
                               'procedure_name', j.procedure_name,
                               'patient_name',   COALESCE(v_patient_name, ''),
                               'clinic_name',    v_clinic_name,
                               'locale',         v_locale
                             ),
        p_scheduled_at   => v_scheduled_at,
        p_reference_id   => p_journey_id,
        p_reference_type => 'crm_journey'
        -- notification_channel fica no default ('whatsapp') — mesmo
        -- comportamento de hoje, esta cadência nunca resolveu canal via
        -- matriz explicitamente.
      );

      UPDATE public.crm_automation_runs SET outbound_id = v_outbound_id WHERE id = v_run_id;
      PERFORM public.crm_log_event(p_journey_id, 'automation_fired',
        jsonb_build_object('template_key', a.template_key, 'scheduled_at', v_scheduled_at), 'system');
    END IF;
  END LOOP;
END;
$$;

-- 4. crm_trg_stop_conditions — cancelamento vira pgmq.delete() + UPDATE pontual --

CREATE OR REPLACE FUNCTION public.crm_trg_stop_conditions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_stop_signal text;
  v_row record;
BEGIN
  v_stop_signal := CASE NEW.event_type
    WHEN 'message_received'    THEN 'reply'
    WHEN 'appointment_created' THEN 'booking'
    WHEN 'sale_recorded'       THEN 'payment'
    ELSE NULL
  END;
  IF v_stop_signal IS NULL THEN RETURN NEW; END IF;

  FOR v_row IN
    UPDATE public.crm_automation_runs r
    SET status = 'stopped', stopped_reason = v_stop_signal
    FROM public.crm_stage_automations a
    WHERE r.automation_id = a.id
      AND r.journey_id = NEW.journey_id
      AND r.status = 'scheduled'
      AND v_stop_signal = ANY (a.stop_on)
    RETURNING r.outbound_id
  LOOP
    -- Cancelamento pontual por mensagem: usa o queue_msg_id guardado no
    -- registro pra remover SÓ essa mensagem do pgmq — nunca um DELETE de
    -- tabela inteira (era exatamente essa a causa do primeiro incidente
    -- nesta migração: um DELETE sem filtro apagando lembretes vencendo).
    PERFORM pgmq.delete('outbound_notifications', queue_msg_id)
    FROM public.outbound_reminder_registry
    WHERE id = v_row.outbound_id AND status = 'pending' AND queue_msg_id IS NOT NULL;

    UPDATE public.outbound_reminder_registry
    SET status = 'cancelled', queue_msg_id = NULL
    WHERE id = v_row.outbound_id AND status = 'pending';
  END LOOP;

  RETURN NEW;
END;
$$;

-- 5. crm_send_manual_message — mesmo contrato externo, INSERT vira helper -------

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

  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = j.tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

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

  v_scheduled_at := public.crm_clamp_to_send_window(j.tenant_id, now());
  v_delayed := v_scheduled_at > now() + interval '2 minutes';

  SELECT COALESCE(t.timezone, 'America/Sao_Paulo') INTO v_tz FROM public.tenants t WHERE t.id = j.tenant_id;
  SELECT COALESCE(w.window_start, '08:00'::time), COALESCE(w.window_end, '20:00'::time)
    INTO v_start, v_end
    FROM (SELECT 1) x
    LEFT JOIN public.crm_send_windows w ON w.tenant_id = j.tenant_id;

  v_outbound_id := public.outbound_enqueue_message(
    p_tenant_id            => j.tenant_id,
    p_patient_phone        => v_identifier,
    p_message_type         => 'manual_followup',
    p_template_key         => 'manual_followup',
    p_template_vars        => jsonb_build_object('override_message', p_message, 'journey_id', p_journey_id),
    p_scheduled_at         => v_scheduled_at,
    p_reference_id         => NULL,
    p_reference_type       => 'crm_manual',
    p_notification_channel => CASE WHEN v_channel IN ('whatsapp','instagram','facebook','sms') THEN v_channel ELSE 'whatsapp' END,
    p_channel_recipient_id => v_identifier,
    p_is_edited            => true
  );

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

-- 5b. outbound_enqueue_message_batch — usado por schedule-reminders/check-recall
-- (Edge Functions, service_role). Um round-trip por invocação em vez de uma
-- chamada RPC por lembrete — mesmo espírito do upsert em lote que existia
-- antes, só que cada item ainda passa pelo helper acima (dedup + pgmq.send
-- individual, porque cada lembrete tem seu próprio scheduled_at).

CREATE OR REPLACE FUNCTION public.outbound_enqueue_message_batch(p_items jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_created int := 0;
  v_id uuid;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_id := public.outbound_enqueue_message(
      p_tenant_id            => (v_item->>'tenant_id')::uuid,
      p_patient_phone        => v_item->>'patient_phone',
      p_message_type         => v_item->>'message_type',
      p_template_key         => v_item->>'template_key',
      p_template_vars        => COALESCE(v_item->'template_vars', '{}'::jsonb),
      p_scheduled_at         => (v_item->>'scheduled_at')::timestamptz,
      p_reference_id         => NULLIF(v_item->>'reference_id', '')::uuid,
      p_reference_type       => v_item->>'reference_type',
      p_notification_channel => COALESCE(v_item->>'notification_channel', 'whatsapp'),
      p_channel_recipient_id => v_item->>'channel_recipient_id',
      p_is_edited            => COALESCE((v_item->>'is_edited')::boolean, false),
      p_media_url            => v_item->>'media_url',
      p_media_type           => v_item->>'media_type'
    );
    IF v_id IS NOT NULL THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

-- 5c. outbound_cancel_stale_reminders — substitui o DELETE de "limpeza
-- auto-curável" do schedule-reminders. Era exatamente esse DELETE (sem
-- filtro quando a lista de tipos válidos vinha vazia) que apagava lembretes
-- vencendo no minuto do envio — a causa raiz do primeiro incidente desta
-- migração. Aqui a operação é sempre por LINHA (pgmq.delete de um msg_id por
-- vez) e sempre protegida por `scheduled_at > now()`: nunca cancela algo que
-- já pode estar sendo processado neste minuto pelo process-outbound.

CREATE OR REPLACE FUNCTION public.outbound_cancel_stale_reminders(
  p_reference_id   uuid,
  p_reference_type text,
  p_valid_types    text[]
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT id, queue_msg_id FROM public.outbound_reminder_registry
    WHERE reference_id = p_reference_id
      AND reference_type = p_reference_type
      AND status = 'pending'
      AND message_type LIKE 'reminder_%'
      AND scheduled_at > now()
      AND (p_valid_types IS NULL OR array_length(p_valid_types, 1) IS NULL OR NOT (message_type = ANY(p_valid_types)))
  LOOP
    IF v_row.queue_msg_id IS NOT NULL THEN
      PERFORM pgmq.delete('outbound_notifications', v_row.queue_msg_id);
    END IF;
    UPDATE public.outbound_reminder_registry
    SET status = 'cancelled', queue_msg_id = NULL
    WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- 6. outbound_enqueue_manual — substitui o INSERT direto de AgendaMestra.tsx ----
-- Único caminho de produção chamado por um usuário autenticado sem passar por
-- uma journey do CRM — precisa validar auth/tenant aqui mesmo (os outros
-- produtores rodam em contexto interno/trigger já confiável).

CREATE OR REPLACE FUNCTION public.outbound_enqueue_manual(
    p_tenant_id            uuid,
    p_patient_phone        text,
    p_message_type         text,
    p_template_key         text,
    p_template_vars        jsonb,
    p_notification_channel text,
    p_channel_recipient_id text,
    p_reference_id         uuid DEFAULT NULL,
    p_reference_type       text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_id := public.outbound_enqueue_message(
    p_tenant_id            => p_tenant_id,
    p_patient_phone        => p_patient_phone,
    p_message_type         => p_message_type,
    p_template_key         => p_template_key,
    p_template_vars        => p_template_vars,
    p_scheduled_at         => now(),
    p_reference_id         => p_reference_id,
    p_reference_type       => p_reference_type,
    p_notification_channel => p_notification_channel,
    p_channel_recipient_id => p_channel_recipient_id,
    p_is_edited            => true
  );

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'duplicate message (already queued)' USING ERRCODE = '23505';
  END IF;

  RETURN v_id;
END;
$$;

-- 7. RPCs de gestão da fila — substituem os UPDATE diretos de useOutboundQueue.ts -

CREATE OR REPLACE FUNCTION public.outbound_cancel_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.outbound_reminder_registry;
BEGIN
  SELECT * INTO r FROM public.outbound_reminder_registry WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = r.tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF r.status != 'pending' THEN RETURN false; END IF;

  IF r.queue_msg_id IS NOT NULL THEN
    PERFORM pgmq.delete('outbound_notifications', r.queue_msg_id);
  END IF;

  UPDATE public.outbound_reminder_registry
  SET status = 'cancelled', queue_msg_id = NULL
  WHERE id = p_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.outbound_edit_message(p_id uuid, p_override_message text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.outbound_reminder_registry;
BEGIN
  SELECT * INTO r FROM public.outbound_reminder_registry WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = r.tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Não precisa tocar o pgmq: o corpo da mensagem na fila só tem o
  -- registry_id, process-outbound relê template_vars fresco do registro na
  -- hora de enviar.
  UPDATE public.outbound_reminder_registry
  SET template_vars = COALESCE(template_vars, '{}'::jsonb) || jsonb_build_object('override_message', p_override_message),
      is_edited = true
  WHERE id = p_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.outbound_retry_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.outbound_reminder_registry;
  v_msg_id bigint;
BEGIN
  SELECT * INTO r FROM public.outbound_reminder_registry WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = r.tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF r.status != 'failed' THEN RETURN false; END IF;

  -- 'failed' já foi arquivado pelo process-outbound (fora da fila viva) —
  -- tentar de novo é enfileirar uma mensagem NOVA agora, não reanimar a
  -- antiga. read_ct do pgmq começa em 0 naturalmente pro novo msg_id, sem
  -- precisar zerar nenhum contador à mão.
  SELECT * INTO v_msg_id FROM pgmq.send(
    'outbound_notifications',
    jsonb_build_object('registry_id', p_id),
    now()
  );

  UPDATE public.outbound_reminder_registry
  SET status = 'pending', error_message = NULL, attempts = 0,
      scheduled_at = now(), queue_msg_id = v_msg_id
  WHERE id = p_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.outbound_send_now(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.outbound_reminder_registry;
BEGIN
  SELECT * INTO r FROM public.outbound_reminder_registry WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = r.tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF r.status != 'pending' OR r.queue_msg_id IS NULL THEN RETURN false; END IF;

  -- pgmq.set_vt nesta versão instalada só aceita segundos (integer), sem
  -- overload timestamptz — 0 segundos = visível imediatamente.
  PERFORM pgmq.set_vt('outbound_notifications', r.queue_msg_id, 0);

  UPDATE public.outbound_reminder_registry
  SET scheduled_at = now()
  WHERE id = p_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.outbound_cancel_all_pending_for_patient(p_tenant_id uuid, p_patient_phone text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT id, queue_msg_id FROM public.outbound_reminder_registry
    WHERE tenant_id = p_tenant_id AND patient_phone = p_patient_phone AND status = 'pending'
  LOOP
    IF v_row.queue_msg_id IS NOT NULL THEN
      PERFORM pgmq.delete('outbound_notifications', v_row.queue_msg_id);
    END IF;
    UPDATE public.outbound_reminder_registry
    SET status = 'cancelled', queue_msg_id = NULL
    WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.outbound_enqueue_manual(uuid, text, text, text, jsonb, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_cancel_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_edit_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_retry_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_send_now(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_cancel_all_pending_for_patient(uuid, text) TO authenticated;

COMMIT;

SELECT 'Produtores SQL migrados para pgmq + RPCs de gestão criadas.' AS resultado;
