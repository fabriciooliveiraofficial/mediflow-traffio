-- =============================================================================
-- MIGRAÇÃO 05: Anti-Double-Booking + Omnichannel Status
-- Corrige race conditions de agendamento e prepara o Painel de Atendimento Humano
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BUG FIX #3: UNIQUE PARTIAL INDEX para prevenir double-booking
--
-- O problema: book_appointment_atomic usa SELECT-then-INSERT sem lock (TOCTOU).
-- Dois requests simultâneos para o mesmo horário passam ambos pelo SELECT EXISTS
-- e ambos executam o INSERT com sucesso, gerando agendamento duplicado.
--
-- A solução correta é fazer o PostgreSQL garantir a unicidade via constraint.
-- O INSERT que violar a constraint lança unique_violation (23505),
-- que o RPC captura e retorna { success: false, reason: 'slot_taken' }.
-- -----------------------------------------------------------------------------
-- Coluna correta: start_time (não "time") — conforme DEPLOY_SCHEMA.sql linha 145
CREATE UNIQUE INDEX IF NOT EXISTS appointments_no_double_booking
  ON appointments (tenant_id, doctor_id, date, start_time)
  WHERE status = 'scheduled';

-- Recriar a função de booking para capturar a unique_violation corretamente
CREATE OR REPLACE FUNCTION book_appointment(
    p_tenant_id     uuid,
    p_patient_id    uuid,
    p_doctor_id     uuid,
    p_location_id   uuid,
    p_type_id       uuid,
    p_date          date,
    p_start_time    time,
    p_booked_by     text DEFAULT 'ai_agent'
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    v_appointment_id uuid;
BEGIN
    -- INSERT direto: se o slot já existe o índice lança unique_violation
    INSERT INTO appointments (
        tenant_id, patient_id, doctor_id, location_id, type_id,
        date, start_time, status, booked_by
    )
    VALUES (
        p_tenant_id, p_patient_id, p_doctor_id, p_location_id, p_type_id,
        p_date, p_start_time, 'scheduled', p_booked_by
    )
    RETURNING id INTO v_appointment_id;

    RETURN jsonb_build_object(
        'success', true,
        'appointment_id', v_appointment_id
    );

EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'slot_taken'
        );
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', SQLERRM
        );
END;
$$;

-- -----------------------------------------------------------------------------
-- SPRINT 3 — Schema: Coluna omnichannel_status com enum tipado
--
-- Substitui o campo human_handoff (boolean) por um enum expressivo que permite
-- ao Painel de Atendimento filtrar filas de forma eficiente:
--   bot_active  → IA está respondendo
--   queued      → Aguardando atendente (na fila do Painel)
--   human_active → Atendente assumiu a conversa
--   closed      → Conversa encerrada
-- -----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE omnichannel_status_enum AS ENUM (
        'bot_active',
        'queued',
        'human_active',
        'closed'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE conversation_sessions
    ADD COLUMN IF NOT EXISTS omnichannel_status omnichannel_status_enum
    NOT NULL DEFAULT 'bot_active';

-- Migrar dados existentes: sessions com human_handoff=true → 'queued'
UPDATE conversation_sessions
SET omnichannel_status = 'queued'
WHERE human_handoff = true AND omnichannel_status = 'bot_active';

-- Campo para assignment do atendente
ALTER TABLE conversation_sessions
    ADD COLUMN IF NOT EXISTS assigned_to_user_id uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
    ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- UNIQUE constraint para o upsert atômico de sessão (SessionManager.getOrCreateSession)
ALTER TABLE conversation_sessions
    DROP CONSTRAINT IF EXISTS conversation_sessions_tenant_phone_unique;
ALTER TABLE conversation_sessions
    ADD CONSTRAINT conversation_sessions_tenant_phone_unique
    UNIQUE (tenant_id, patient_phone);

-- Índices para o Painel (filtros por tenant + status são o hot path)
CREATE INDEX IF NOT EXISTS idx_conv_sessions_tenant_status
  ON conversation_sessions (tenant_id, omnichannel_status)
  WHERE omnichannel_status IN ('queued', 'human_active');

CREATE INDEX IF NOT EXISTS idx_conv_sessions_assigned
  ON conversation_sessions (assigned_to_user_id, omnichannel_status)
  WHERE assigned_to_user_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Message Outbox — entrega garantida para Z-API (SPRINT 2)
-- Worker (pg_cron ou Edge Function cron) processa mensagens pendentes a cada 30s.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_outbox (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone           text NOT NULL,
    payload         jsonb NOT NULL,          -- { text, interactive? }
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed')),
    attempts        int NOT NULL DEFAULT 0,
    max_attempts    int NOT NULL DEFAULT 3,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz,
    error_detail    text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON message_outbox (tenant_id, next_attempt_at)
  WHERE status = 'pending';

ALTER TABLE message_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants viewing own outbox"
  ON message_outbox FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM members WHERE user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- Webhook Idempotency — previne processamento duplicado de webhooks Z-API (SPRINT 2)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_webhooks (
    message_id  text PRIMARY KEY,
    tenant_id   uuid NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now()
);

-- TTL: purgar registros com mais de 24h (executar via pg_cron ou trigger)
CREATE INDEX IF NOT EXISTS idx_processed_webhooks_age
  ON processed_webhooks (processed_at);

-- -----------------------------------------------------------------------------
-- RPC: claim_conversation — Assignment de conversa com lock (SPRINT 3)
-- Garante que apenas um atendente pode assumir uma conversa simultaneamente.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_conversation(
    p_session_id  uuid,
    p_user_id     uuid,
    p_tenant_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    v_session conversation_sessions%ROWTYPE;
BEGIN
    -- Lock exclusivo na linha para prevenir dois atendentes assumindo ao mesmo tempo
    SELECT * INTO v_session
    FROM conversation_sessions
    WHERE id = p_session_id
      AND tenant_id = p_tenant_id
    FOR UPDATE NOWAIT;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
    END IF;

    IF v_session.omnichannel_status != 'queued' THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'not_in_queue',
            'current_status', v_session.omnichannel_status::text
        );
    END IF;

    UPDATE conversation_sessions SET
        omnichannel_status  = 'human_active',
        assigned_to_user_id = p_user_id,
        claimed_at          = now()
    WHERE id = p_session_id;

    RETURN jsonb_build_object('success', true);

EXCEPTION
    WHEN lock_not_available THEN
        RETURN jsonb_build_object('success', false, 'reason', 'already_being_claimed');
END;
$$;

-- -----------------------------------------------------------------------------
-- RLS adicional: operações de ESCRITA nas tabelas de sessão (SPRINT 2)
-- As políticas anteriores só cobriam SELECT.
-- A Edge Function usa service_role (bypassa RLS), mas o frontend usa anon/auth.
-- -----------------------------------------------------------------------------

-- conversation_sessions: apenas INSERT para service_role via Edge Function
-- Atendentes podem UPDATE (claim, close) via RPC, não diretamente
CREATE POLICY "Tenants update own sessions"
  ON conversation_sessions FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM members WHERE user_id = auth.uid()
    )
  );

-- conversation_messages: atendentes podem inserir mensagens (envio humano)
CREATE POLICY "Tenants insert own messages"
  ON conversation_messages FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT id FROM conversation_sessions
      WHERE tenant_id IN (
        SELECT tenant_id FROM members WHERE user_id = auth.uid()
      )
    )
  );
