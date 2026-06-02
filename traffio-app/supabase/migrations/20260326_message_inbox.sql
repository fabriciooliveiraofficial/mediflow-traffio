-- =============================================================================
-- TRAFFIO MEDICAL - Message Inbox (Debounce + Concurrency Control)
--
-- Desacopla o recebimento de mensagens do processamento pelo agente.
-- O webhook apenas insere aqui (fast, <50ms).
-- O cron process-inbox agrupa, debounce e processa com lock por conversa.
-- =============================================================================

CREATE TABLE IF NOT EXISTS message_inbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone           TEXT        NOT NULL,
    content         TEXT        NOT NULL,
    message_id      TEXT        NOT NULL,               -- Z-API messageId (idempotência)
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT        NOT NULL DEFAULT 'pending'  -- pending | processing | done | skipped
        CHECK (status IN ('pending', 'processing', 'done', 'skipped')),
    batch_id        UUID,                               -- preenchido quando agrupado pelo worker
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice de busca do worker: mensagens pendentes por tenant/phone ordenadas por tempo
CREATE INDEX IF NOT EXISTS idx_message_inbox_pending
    ON message_inbox (tenant_id, phone, received_at)
    WHERE status = 'pending';

-- Índice de idempotência: evita reprocessar mesmo message_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_inbox_message_id
    ON message_inbox (tenant_id, message_id);

-- RLS: apenas service role acessa (Edge Functions usam service role)
ALTER TABLE message_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON message_inbox
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- Limpeza automática: remover mensagens processadas com mais de 24h
-- =============================================================================
CREATE OR REPLACE FUNCTION cleanup_message_inbox()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    DELETE FROM message_inbox
    WHERE status IN ('done', 'skipped')
      AND created_at < NOW() - INTERVAL '24 hours';
$$;

GRANT EXECUTE ON FUNCTION cleanup_message_inbox() TO service_role;
