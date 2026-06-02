-- =============================================================================
-- TRAFFIO MEDICAL - SECURITY & AUDIT TRAIL
-- Creates the security_access_logs table to track AI Agent interactions
-- that involve identity verification and sensitive patient data access.
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  patient_id UUID REFERENCES patients(id),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  phone TEXT NOT NULL,
  action TEXT NOT NULL,          -- e.g. 'identity_check', 'view_appointments'
  status TEXT NOT NULL,          -- e.g. 'success', 'failed', 'blocked'
  metadata JSONB DEFAULT '{}',   -- Extensible payload for attempted prefixes, IP, etc.
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Optimization indexes for audit dashboards or rate-limiting queries
CREATE INDEX IF NOT EXISTS idx_security_logs_patient ON security_access_logs(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_logs_phone ON security_access_logs(phone, created_at DESC);

-- Allow authenticated and service_role to insert
ALTER TABLE security_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service_role full access to security_access_logs"
    ON security_access_logs
    AS PERMISSIVE
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
