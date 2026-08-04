-- ============================================================
-- Editar/Anular/Substituir em dado clínico — padrão addendum
-- ------------------------------------------------------------
-- Prontuário médico não se sobrescreve nem se apaga (HIPAA/LGPD tratam
-- dado de saúde da mesma forma): o registro original fica sempre visível
-- e rastreável; a correção é um novo registro linkado a ele. Para receita,
-- o padrão de e-prescribing é Void (anula, mantém no histórico) + Reissue
-- (nova receita substituindo, linkada à anulada). Para documento/exame,
-- o padrão é versionamento (substituir = nova versão; a anterior continua
-- acessível como "substituída") + soft-delete (nunca remove do Storage).
--
-- Este migration adiciona as colunas necessárias para os três padrões e
-- uma tabela de audit log genérica para registrar quem fez o quê e por quê.
-- ============================================================

-- 1. medical_records: emenda e anulação
ALTER TABLE public.medical_records
    ADD COLUMN IF NOT EXISTS amends_id UUID REFERENCES public.medical_records(id),
    ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS voided_reason TEXT,
    ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_medical_records_amends_id ON public.medical_records(amends_id) WHERE amends_id IS NOT NULL;

-- 2. prescriptions: anulação e reemissão
ALTER TABLE public.prescriptions
    ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS voided_reason TEXT,
    ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS reissued_from_id UUID REFERENCES public.prescriptions(id);

CREATE INDEX IF NOT EXISTS idx_prescriptions_reissued_from_id ON public.prescriptions(reissued_from_id) WHERE reissued_from_id IS NOT NULL;

-- 3. documents: versionamento e soft-delete
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS replaces_id UUID REFERENCES public.documents(id),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_reason TEXT,
    ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_documents_replaces_id ON public.documents(replaces_id) WHERE replaces_id IS NOT NULL;

-- 4. Audit log genérico — quem fez o quê, quando e por quê, nas 3 entidades
CREATE TABLE IF NOT EXISTS public.clinical_audit_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    entity_type   TEXT NOT NULL CHECK (entity_type IN ('medical_record', 'prescription', 'document')),
    entity_id     UUID NOT NULL,
    action        TEXT NOT NULL CHECK (action IN ('created', 'amended', 'voided', 'reissued', 'replaced', 'soft_deleted', 'restored')),
    reason        TEXT,
    performed_by  UUID REFERENCES public.profiles(id),
    performed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinical_audit_log_entity ON public.clinical_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_clinical_audit_log_tenant ON public.clinical_audit_log(tenant_id);

ALTER TABLE public.clinical_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can see tenant audit log" ON public.clinical_audit_log;
CREATE POLICY "Members can see tenant audit log" ON public.clinical_audit_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = clinical_audit_log.tenant_id
            AND members.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Members can insert tenant audit log" ON public.clinical_audit_log;
CREATE POLICY "Members can insert tenant audit log" ON public.clinical_audit_log
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = clinical_audit_log.tenant_id
            AND members.user_id = auth.uid()
        )
    );
