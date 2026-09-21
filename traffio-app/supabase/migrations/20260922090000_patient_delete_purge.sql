-- Excluir paciente = apagar TUDO dele (decisão do usuário, 2026-09-22).
--
-- Incidente que motivou: paciente e agendamento excluídos no painel, e o banco
-- seguia com a sessão da conversa (estado "cadastro confirmado", ficha antiga),
-- 29 mensagens, fila de entrada, preferência/identidade de canal, card do CRM e
-- lembretes pendentes. A plataforma mostrava "nada"; o agente de IA lia o resto
-- e afirmou um agendamento que não existia.
--
-- Antes: o DELETE em patients só propagava pelas FKs clínicas (CASCADE) — tudo
-- que é ligado por TELEFONE (sem FK) ficava órfão, e 4 tabelas com FK NO ACTION
-- (call_records, chat_history, notifications_log, voicemails) BLOQUEAVAM a
-- exclusão de qualquer paciente que tivesse uma linha nelas.
--
-- Por que gatilho (e não só RPC chamada pela tela): a limpeza precisa valer para
-- QUALQUER caminho de exclusão — a tela atual (DELETE direto), telas futuras e
-- API. O risco clássico de gatilho neste projeto (o do NPS travou a conclusão de
-- consultas em 11/08/2026) é tratado na raiz: TODO o corpo roda dentro de
-- EXCEPTION WHEN OTHERS → falha na limpeza vira WARNING e a exclusão segue.
-- No pior caso o comportamento é o de antes; nunca pior.
--
-- Telefone compartilhado (família): se OUTRO paciente do tenant usa o mesmo
-- telefone, a conversa não é só deste paciente → a conversa é preservada e só o
-- que é inequivocamente dele (vínculos por patient_id) é apagado.

CREATE OR REPLACE FUNCTION public.purge_patient_footprint(p_patient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant    uuid;
  v_digits    text;
  v_shared    boolean := false;
  v_keys      text[]  := '{}';   -- identificadores de conversa (telefone e ids de canal)
  v_sessions  uuid[]  := '{}';
  v_row       record;
  v_cancelled int := 0;
  v_out       jsonb := '{}'::jsonb;
  v_n         int;
BEGIN
  SELECT tenant_id, regexp_replace(coalesce(phone, ''), '\D', '', 'g')
    INTO v_tenant, v_digits
  FROM public.patients WHERE id = p_patient_id;
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('found', false); END IF;

  IF length(v_digits) >= 8 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.patients o
      WHERE o.tenant_id = v_tenant AND o.id <> p_patient_id
        AND regexp_replace(coalesce(o.phone, ''), '\D', '', 'g') = v_digits
    ) INTO v_shared;
  END IF;

  -- Bloqueadores (FK NO ACTION): dado pessoal sai; call_records é registro de
  -- uso/faturamento de telefonia → fica, sem o vínculo com a pessoa.
  DELETE FROM public.notifications_log WHERE patient_id = p_patient_id;
  DELETE FROM public.chat_history      WHERE patient_id = p_patient_id;
  DELETE FROM public.voicemails        WHERE patient_id = p_patient_id;
  UPDATE public.call_records SET patient_id = NULL WHERE patient_id = p_patient_id;

  IF NOT v_shared THEN
    -- Conversas do paciente: pelo vínculo, pelo telefone, e pelos ids de canal
    -- (Instagram/Messenger/Live Chat usam o id da plataforma como "telefone").
    SELECT coalesce(array_agg(DISTINCT k), '{}') INTO v_keys FROM (
      SELECT s.patient_phone AS k FROM public.conversation_sessions s
        WHERE s.tenant_id = v_tenant AND s.patient_id = p_patient_id
      UNION
      SELECT s.patient_phone FROM public.conversation_sessions s
        WHERE s.tenant_id = v_tenant AND length(v_digits) >= 8
          AND regexp_replace(coalesce(s.patient_phone, ''), '\D', '', 'g') = v_digits
      UNION
      SELECT ci.channel_user_id FROM public.channel_identities ci
        WHERE ci.tenant_id = v_tenant AND ci.patient_id = p_patient_id
    ) q WHERE k IS NOT NULL AND k <> '';

    SELECT coalesce(array_agg(id), '{}') INTO v_sessions
    FROM public.conversation_sessions
    WHERE tenant_id = v_tenant AND (patient_id = p_patient_id OR patient_phone = ANY (v_keys));

    -- Lembretes/automações pendentes: tira da fila pgmq e apaga o registro.
    FOR v_row IN
      SELECT id, queue_msg_id, status FROM public.outbound_reminder_registry
      WHERE tenant_id = v_tenant
        AND (patient_phone = ANY (v_keys)
             OR (length(v_digits) >= 8 AND regexp_replace(coalesce(patient_phone, ''), '\D', '', 'g') = v_digits))
    LOOP
      IF v_row.status = 'pending' AND v_row.queue_msg_id IS NOT NULL THEN
        BEGIN
          PERFORM pgmq.delete('outbound_notifications', v_row.queue_msg_id);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_cancelled := v_cancelled + 1;
      END IF;
      DELETE FROM public.outbound_reminder_registry WHERE id = v_row.id;
    END LOOP;
    v_out := v_out || jsonb_build_object('reminders_dequeued', v_cancelled);

    DELETE FROM public.outbound_message_queue
      WHERE tenant_id = v_tenant AND patient_phone = ANY (v_keys);

    DELETE FROM public.message_inbox  WHERE tenant_id = v_tenant AND phone = ANY (v_keys);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('message_inbox', v_n);
    DELETE FROM public.message_outbox WHERE tenant_id = v_tenant AND phone = ANY (v_keys);
    DELETE FROM public.conversation_locks WHERE tenant_id = v_tenant AND phone = ANY (v_keys);
    DELETE FROM public.filtered_inbound WHERE tenant_id = v_tenant AND sender_id = ANY (v_keys);
    DELETE FROM public.patient_channel_preferences WHERE tenant_id = v_tenant AND patient_phone = ANY (v_keys);

    -- Telemetria do agente: fica (métrica técnica), sem o dado pessoal.
    UPDATE public.agent_turn_events SET phone = NULL, session_id = NULL
      WHERE tenant_id = v_tenant AND (session_id = ANY (v_sessions) OR phone = ANY (v_keys));

    DELETE FROM public.ai_audit_logs WHERE session_id = ANY (v_sessions);

    -- Card do CRM (eventos, identidades e execuções de automação caem por CASCADE).
    DELETE FROM public.crm_journeys
      WHERE tenant_id = v_tenant AND (patient_id = p_patient_id OR session_id = ANY (v_sessions));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('crm_journeys', v_n);

    -- A conversa (conversation_messages cai por CASCADE).
    DELETE FROM public.conversation_sessions WHERE id = ANY (v_sessions);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('conversation_sessions', v_n);
  ELSE
    DELETE FROM public.crm_journeys WHERE tenant_id = v_tenant AND patient_id = p_patient_id;
  END IF;

  DELETE FROM public.channel_identities WHERE tenant_id = v_tenant AND patient_id = p_patient_id;

  RETURN v_out || jsonb_build_object('found', true, 'shared_phone', v_shared);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_patient_footprint(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_purge_patient_footprint()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.purge_patient_footprint(OLD.id);
  EXCEPTION WHEN OTHERS THEN
    -- Nunca bloquear a exclusão por causa da limpeza (lição do gatilho de NPS).
    RAISE WARNING 'purge_patient_footprint falhou para % (exclusão segue): %', OLD.id, SQLERRM;
  END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_purge_patient_footprint ON public.patients;
CREATE TRIGGER tr_purge_patient_footprint
  BEFORE DELETE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.trg_purge_patient_footprint();

-- ── Agendamento cancelado/removido → lembretes pendentes saem da fila ────────
-- "Excluir" na agenda marca status='canceled'. O envio já conferia o status e
-- pulava, mas o lembrete ficava 'pending' na tela de Notificações até a hora.
CREATE OR REPLACE FUNCTION public.trg_cancel_reminders_on_appointment_end()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row record;
  v_id  uuid := coalesce(OLD.id, NEW.id);
BEGIN
  BEGIN
    FOR v_row IN
      SELECT id, queue_msg_id FROM public.outbound_reminder_registry
      WHERE reference_type = 'appointment' AND reference_id::text = v_id::text AND status = 'pending'
    LOOP
      IF v_row.queue_msg_id IS NOT NULL THEN
        BEGIN
          PERFORM pgmq.delete('outbound_notifications', v_row.queue_msg_id);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END IF;
      UPDATE public.outbound_reminder_registry
        SET status = 'cancelled', queue_msg_id = NULL,
            error_message = 'Agendamento cancelado/removido'
      WHERE id = v_row.id;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cancelar lembretes do agendamento % falhou (operação segue): %', v_id, SQLERRM;
  END;
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_cancel_reminders_on_appointment_cancel ON public.appointments;
CREATE TRIGGER tr_cancel_reminders_on_appointment_cancel
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW
  WHEN (NEW.status IN ('canceled', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trg_cancel_reminders_on_appointment_end();

DROP TRIGGER IF EXISTS tr_cancel_reminders_on_appointment_delete ON public.appointments;
CREATE TRIGGER tr_cancel_reminders_on_appointment_delete
  BEFORE DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.trg_cancel_reminders_on_appointment_end();
