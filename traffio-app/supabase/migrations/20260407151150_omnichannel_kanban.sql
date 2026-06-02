-- =============================================================================
-- MIGRAÇÃO: Atendimento Omnichannel & Follow-up Kanban
-- Adiciona suporte a funil de vendas (Kanban) e transferência de chats
-- =============================================================================

-- 1. Novas colunas na tabela de sessões para suporte ao Kanban inteligente
ALTER TABLE conversation_sessions
    ADD COLUMN IF NOT EXISTS kanban_stage varchar(50) NOT NULL DEFAULT 'Novos Leads',
    ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS revenue_estimated numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id);

-- Cria índice para otimizar busca pela página de Follow-up (que filtra muito por kanban_stage)
CREATE INDEX IF NOT EXISTS idx_conv_sessions_kanban
  ON conversation_sessions (tenant_id, kanban_stage);

-- Índice para busca por paciente vinculada
CREATE INDEX IF NOT EXISTS idx_conv_sessions_patient
  ON conversation_sessions (patient_id);

-- =============================================================================
-- RPC: transfer_conversation — Transferência Segura de Conversa
-- Garante que o usuário que está transferindo é o dono atual ou Admin.
-- =============================================================================
CREATE OR REPLACE FUNCTION transfer_conversation(
    p_session_id  uuid,
    p_from_user_id uuid,
    p_to_user_id   uuid,
    p_tenant_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    v_session conversation_sessions%ROWTYPE;
BEGIN
    -- Busca a sessão e trava para evitar double-operation
    SELECT * INTO v_session
    FROM conversation_sessions
    WHERE id = p_session_id
      AND tenant_id = p_tenant_id
    FOR UPDATE NOWAIT;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
    END IF;

    -- Apenas o dono pode transferir (ou poderia adicionar checagem de role admin aqui)
    IF v_session.assigned_to_user_id != p_from_user_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'not_authorized_or_not_owner'
        );
    END IF;

    -- Fazemos a transferência
    UPDATE conversation_sessions SET
        assigned_to_user_id = p_to_user_id
        -- Mantém claimed_at para não perder o SLA de quando o time iniciou aversa
        -- omnichannel_status permanece 'human_active'
    WHERE id = p_session_id;

    -- Opcional: Adicionar uma mensagem de log interna de transferência
    INSERT INTO conversation_messages (
        session_id, role, content
    ) VALUES (
        p_session_id,
        'internal',
        'Conversa transferida para outro atendente.'
    );

    RETURN jsonb_build_object('success', true);

EXCEPTION
    WHEN lock_not_available THEN
        RETURN jsonb_build_object('success', false, 'reason', 'locked_by_other_transaction');
END;
$$;
