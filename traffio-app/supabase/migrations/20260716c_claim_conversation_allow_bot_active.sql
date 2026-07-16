-- -----------------------------------------------------------------------------
-- Fix: claim_conversation rejeitava claim de conversas 'bot_active' com
-- reason='not_in_queue', mas o frontend permite assumir tanto 'queued'
-- quanto 'bot_active' (tirar o bot manualmente da conversa). Alinha a RPC
-- ao comportamento já exposto na UI (HumanInboxPage.tsx canClaim).
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

    IF v_session.omnichannel_status NOT IN ('queued', 'bot_active') THEN
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
