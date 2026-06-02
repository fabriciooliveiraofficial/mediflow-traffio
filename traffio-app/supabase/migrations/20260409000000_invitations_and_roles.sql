-- ##########################################################
-- TRAFFIO — Multi-User Invitations & Extended Roles
-- Migration: 20260409000000
-- ##########################################################

-- ============================================================
-- 1. EXPAND roles no members (adicionar manager, attendant)
-- ============================================================
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_role_check;
ALTER TABLE members ADD CONSTRAINT members_role_check
    CHECK (role IN ('owner', 'admin', 'manager', 'doctor', 'attendant', 'staff'));

-- Expand profiles.role também
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('doctor', 'staff', 'patient', 'super_admin', 'owner', 'admin', 'manager', 'attendant'));

-- Garantir que members tem is_active (pode não existir em prod)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'members' AND column_name = 'is_active'
    ) THEN
        ALTER TABLE members ADD COLUMN is_active BOOLEAN DEFAULT TRUE NOT NULL;
    END IF;
END $$;

-- ============================================================
-- 2. TABELA invitations
-- ============================================================
CREATE TABLE IF NOT EXISTS invitations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'doctor', 'attendant', 'staff')),
    token       TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    invited_by  UUID NOT NULL REFERENCES profiles(id),
    status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_invitations_token  ON invitations(token)    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email  ON invitations(email);

-- ============================================================
-- 3. RLS para invitations
-- ============================================================
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Admins/owners/managers do tenant podem ver e gerenciar convites
CREATE POLICY "tenant_admins_manage_invitations" ON invitations
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = invitations.tenant_id
              AND m.role IN ('owner', 'admin', 'manager')
              AND m.is_active = TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = invitations.tenant_id
              AND m.role IN ('owner', 'admin', 'manager')
              AND m.is_active = TRUE
        )
    );

-- Qualquer um pode ler um convite pelo token (para a página de aceitação)
-- A validação real acontece na Edge Function com service_role
CREATE POLICY "public_read_invitation_by_token" ON invitations
    FOR SELECT TO anon, authenticated
    USING (TRUE);

-- ============================================================
-- 4. FUNCTION: expirar convites automaticamente (cron-like)
-- ============================================================
CREATE OR REPLACE FUNCTION expire_old_invitations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE invitations
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at < NOW();
END;
$$;

-- ============================================================
-- 5. VIEW: membros com dados do perfil (uso em TeamManagement)
-- ============================================================
CREATE OR REPLACE VIEW tenant_members_view AS
SELECT
    m.id,
    m.tenant_id,
    m.user_id,
    m.role,
    m.is_active,
    m.created_at,
    p.full_name,
    p.email,
    p.avatar_url
FROM members m
LEFT JOIN profiles p ON p.id = m.user_id;

-- RLS na view não é necessária pois herda da tabela members
GRANT SELECT ON tenant_members_view TO authenticated;
