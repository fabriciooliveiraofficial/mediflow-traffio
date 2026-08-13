-- =============================================================================
-- Migração pgmq — parte 3: RPCs de consumo pro process-outbound
-- Data: 2026-08-14
--
-- O schema `pgmq` não é exposto via PostgREST — process-outbound (service_role)
-- chama estes wrappers em public em vez de pgmq.read/archive/set_vt direto.
-- =============================================================================

BEGIN;

-- 1. outbound_claim_messages — substitui claim_outbound_messages() -------------
-- pgmq.read() já dá o essencial (visibility timeout = claim atômico; uma
-- mensagem não confirmada reaparece sozinha depois do vt, sem reaper escrito à
-- mão). O que pgmq.read() não faz nativamente é justiça por tenant — replica
-- aqui a mesma regra de antes: candidatos extras, cap por tenant via window
-- function, excesso devolvido à visibilidade imediatamente (equivalente a
-- nunca ter sido reivindicado neste lote).

CREATE OR REPLACE FUNCTION public.outbound_claim_messages(
  p_batch_size     int DEFAULT 150,
  p_per_tenant_cap int DEFAULT 15,
  p_vt_seconds     int DEFAULT 120
)
RETURNS TABLE (
  msg_id                bigint,
  read_ct               int,
  id                    uuid,
  tenant_id             uuid,
  patient_phone         text,
  message_type          text,
  template_key          text,
  template_vars         jsonb,
  scheduled_at          timestamptz,
  reference_id          uuid,
  reference_type        text,
  media_url             text,
  media_type            text,
  is_edited             boolean,
  notification_channel  text,
  channel_recipient_id  text,
  attempts              int,
  confirmation_status   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orphan record;
BEGIN
  CREATE TEMP TABLE _claimed ON COMMIT DROP AS
  SELECT m.msg_id, m.read_ct, r.*
  FROM pgmq.read('outbound_notifications', p_vt_seconds, p_batch_size * 4) m
  JOIN public.outbound_reminder_registry r ON r.id = (m.message->>'registry_id')::uuid;

  -- Mensagem cuja linha de registro não está mais 'pending' (cancelada,
  -- ou já processada por uma corrida rara) é lixo da fila — arquiva e não
  -- devolve pro chamador. Nunca reprocessar algo que o negócio já resolveu.
  --
  -- Referências qualificadas com "_claimed." em todo lugar abaixo (não só
  -- estilo): RETURNS TABLE(msg_id, tenant_id, scheduled_at, ...) declara
  -- cada coluna como variável implícita dentro da função — um "msg_id" (ou
  -- "tenant_id"/"scheduled_at") sem prefixo de tabela colide com essa
  -- variável e o Postgres recusa a query como ambígua.
  FOR v_orphan IN SELECT _claimed.msg_id FROM _claimed WHERE _claimed.status != 'pending'
  LOOP
    PERFORM pgmq.archive('outbound_notifications', v_orphan.msg_id);
  END LOOP;
  DELETE FROM _claimed WHERE _claimed.status != 'pending';

  -- Cap por tenant: excesso volta a ficar visível JÁ (vt = 0s) — mesmo
  -- efeito de "não ter sido pego neste lote", pego na invocação seguinte.
  -- pgmq.set_vt nesta versão só aceita segundos (integer), não timestamptz.
  PERFORM pgmq.set_vt('outbound_notifications', ranked.msg_id, 0)
  FROM (
    SELECT _claimed.msg_id, row_number() OVER (PARTITION BY _claimed.tenant_id ORDER BY _claimed.scheduled_at) AS rn
    FROM _claimed
  ) ranked
  WHERE ranked.rn > p_per_tenant_cap;

  RETURN QUERY
  SELECT c.msg_id, c.read_ct, c.id, c.tenant_id, c.patient_phone, c.message_type, c.template_key,
         c.template_vars, c.scheduled_at, c.reference_id, c.reference_type,
         c.media_url, c.media_type, c.is_edited, c.notification_channel, c.channel_recipient_id,
         c.attempts, c.confirmation_status
  FROM (
    SELECT _claimed.*, row_number() OVER (PARTITION BY _claimed.tenant_id ORDER BY _claimed.scheduled_at) AS rn
    FROM _claimed
  ) c
  WHERE c.rn <= p_per_tenant_cap
  ORDER BY c.scheduled_at
  LIMIT p_batch_size;
END;
$$;

-- 2. outbound_archive_message — sucesso ou falha definitiva --------------------
-- Tira a mensagem da fila viva do pgmq (guarda em pgmq.a_outbound_notifications,
-- com archived_at automático). O desfecho (sent/failed/cancelled) já está
-- gravado em outbound_reminder_registry.status — o archive é só "não
-- processar de novo", não é ele que decide o resultado.

CREATE OR REPLACE FUNCTION public.outbound_archive_message(p_msg_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pgmq.archive('outbound_notifications', p_msg_id);
$$;

-- 3. outbound_release_for_retry — falha transitória, empurra o backoff ---------
-- Substitui o "volta pra pending com scheduled_at futuro" de antes. A
-- mensagem CONTINUA na fila viva (não arquiva) — só fica invisível até o
-- horário do backoff, quando pgmq a devolve sozinho, sem reaper manual.
-- pgmq.set_vt nesta versão instalada (1.5.1) só tem o overload em segundos
-- (integer) — sem overload timestamptz (diferente de pgmq.send, que tem os
-- dois). Converte o alvo absoluto pra segundos-a-partir-de-agora; nunca
-- negativo (alvo no passado vira "libera já", não um vt inválido).

CREATE OR REPLACE FUNCTION public.outbound_release_for_retry(p_msg_id bigint, p_retry_at timestamptz)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pgmq.set_vt('outbound_notifications', p_msg_id, GREATEST(0, EXTRACT(EPOCH FROM (p_retry_at - now()))::int));
$$;

-- 4. outbound_release_now — devolve a mensagem imediatamente à visibilidade ----
-- Usado no guard de "quiet hours atrasou o processamento": a mensagem não deu
-- errado, só precisa esperar a janela abrir. Fica na fila viva.

CREATE OR REPLACE FUNCTION public.outbound_release_now(p_msg_id bigint, p_at timestamptz DEFAULT now())
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pgmq.set_vt('outbound_notifications', p_msg_id, GREATEST(0, EXTRACT(EPOCH FROM (p_at - now()))::int));
$$;

COMMIT;

SELECT 'RPCs de consumo pgmq criadas.' AS resultado;
