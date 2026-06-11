-- =============================================================================
-- MIGRAÇÃO: Telnyx Regulatory Requirement Groups (cache por tenant)
-- Data: 2026-06-11
-- Idempotente: pode ser re-executada sem erros.
--
-- Armazena, por tenant + país + tipo de número, o requirement_group da Telnyx
-- já preenchido (endereço, documentos, dados de contato), para reuso silencioso
-- em compras futuras sem repetir o formulário ao usuário.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tenant_requirement_groups (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    country_code                TEXT NOT NULL,
    phone_number_type           TEXT NOT NULL,
    telnyx_requirement_group_id TEXT NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'unapproved',
    regulatory_requirements     JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, country_code, phone_number_type)
);

CREATE INDEX IF NOT EXISTS idx_tenant_requirement_groups_lookup
    ON public.tenant_requirement_groups (tenant_id, country_code, phone_number_type);

ALTER TABLE public.tenant_requirement_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view requirement groups" ON public.tenant_requirement_groups;
CREATE POLICY "Members can view requirement groups"
    ON public.tenant_requirement_groups FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = tenant_requirement_groups.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Admins can manage requirement groups" ON public.tenant_requirement_groups;
CREATE POLICY "Admins can manage requirement groups"
    ON public.tenant_requirement_groups FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = tenant_requirement_groups.tenant_id
          AND members.user_id = auth.uid()
          AND members.role IN ('owner', 'admin')
    ));

DROP POLICY IF EXISTS "Service role full access to tenant_requirement_groups" ON public.tenant_requirement_groups;
CREATE POLICY "Service role full access to tenant_requirement_groups"
    ON public.tenant_requirement_groups FOR ALL TO service_role
    USING (true) WITH CHECK (true);
