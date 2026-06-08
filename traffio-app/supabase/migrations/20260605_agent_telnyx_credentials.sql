-- Credenciais SIP/WebRTC por agente (membro do tenant)
-- Idempotente: pode ser re-executada sem erros.

CREATE TABLE IF NOT EXISTS agent_telnyx_credentials (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telnyx_credential_id  TEXT        NOT NULL,
  telnyx_sip_username   TEXT        NOT NULL,
  telnyx_sip_password   TEXT        NOT NULL,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  last_registered_at    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, user_id)
);

ALTER TABLE agent_telnyx_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_telnyx_credentials_select" ON agent_telnyx_credentials;
CREATE POLICY "agent_telnyx_credentials_select"
  ON agent_telnyx_credentials FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_telnyx_credentials_service_insert" ON agent_telnyx_credentials;
CREATE POLICY "agent_telnyx_credentials_service_insert"
  ON agent_telnyx_credentials FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "agent_telnyx_credentials_service_update" ON agent_telnyx_credentials;
CREATE POLICY "agent_telnyx_credentials_service_update"
  ON agent_telnyx_credentials FOR UPDATE
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "agent_telnyx_credentials_service_delete" ON agent_telnyx_credentials;
CREATE POLICY "agent_telnyx_credentials_service_delete"
  ON agent_telnyx_credentials FOR DELETE
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_agent_telnyx_credentials_user   ON agent_telnyx_credentials (user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_telnyx_credentials_active ON agent_telnyx_credentials (tenant_id, is_active) WHERE is_active = true;
