-- =============================================================================
-- MIGRAÇÃO: KYC — Pedidos de Compra de Número com Validação de Documentos
-- Data: 2026-06-05
-- Idempotente: pode ser re-executada sem erros.
-- =============================================================================

-- ============================================================
-- 1. number_order_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS public.number_order_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    phone_number        TEXT NOT NULL,
    country_code        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending_docs'
                        CHECK (status IN ('pending_docs','docs_submitted','under_review','approved','rejected','completed','cancelled')),
    telnyx_order_id     TEXT,
    rejection_reason    TEXT,
    submitted_at        TIMESTAMPTZ,
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_number_orders_tenant
    ON public.number_order_requests (tenant_id, status);

ALTER TABLE public.number_order_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their number orders" ON public.number_order_requests;
CREATE POLICY "Members can view their number orders"
    ON public.number_order_requests FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = number_order_requests.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Admins can manage number orders" ON public.number_order_requests;
CREATE POLICY "Admins can manage number orders"
    ON public.number_order_requests FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = number_order_requests.tenant_id
          AND members.user_id = auth.uid()
          AND members.role IN ('owner','admin')
    ));

DROP POLICY IF EXISTS "Service role full access to number_order_requests" ON public.number_order_requests;
CREATE POLICY "Service role full access to number_order_requests"
    ON public.number_order_requests FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 2. number_order_holder_info
-- ============================================================
CREATE TABLE IF NOT EXISTS public.number_order_holder_info (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id         UUID NOT NULL UNIQUE REFERENCES public.number_order_requests(id) ON DELETE CASCADE,
    tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    holder_type      TEXT NOT NULL DEFAULT 'individual'
                     CHECK (holder_type IN ('individual','business')),
    full_name        TEXT,
    company_name     TEXT,
    cpf              TEXT,
    cnpj             TEXT,
    email            TEXT,
    phone            TEXT,
    address_street   TEXT,
    address_number   TEXT,
    address_city     TEXT,
    address_state    TEXT,
    address_zip      TEXT,
    address_country  TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.number_order_holder_info ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view holder info" ON public.number_order_holder_info;
CREATE POLICY "Members can view holder info"
    ON public.number_order_holder_info FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = number_order_holder_info.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Admins can manage holder info" ON public.number_order_holder_info;
CREATE POLICY "Admins can manage holder info"
    ON public.number_order_holder_info FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = number_order_holder_info.tenant_id
          AND members.user_id = auth.uid()
          AND members.role IN ('owner','admin')
    ));

DROP POLICY IF EXISTS "Service role full access to number_order_holder_info" ON public.number_order_holder_info;
CREATE POLICY "Service role full access to number_order_holder_info"
    ON public.number_order_holder_info FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 3. number_order_documents
-- ============================================================
CREATE TABLE IF NOT EXISTS public.number_order_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES public.number_order_requests(id) ON DELETE CASCADE,
    tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL
                  CHECK (document_type IN ('cpf','cnpj','passport','id_card','proof_of_address','power_of_attorney')),
    file_path     TEXT NOT NULL,
    file_name     TEXT NOT NULL,
    file_size     INTEGER,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_number_order_docs_order
    ON public.number_order_documents (order_id);

ALTER TABLE public.number_order_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view order documents" ON public.number_order_documents;
CREATE POLICY "Members can view order documents"
    ON public.number_order_documents FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = number_order_documents.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Admins can manage order documents" ON public.number_order_documents;
CREATE POLICY "Admins can manage order documents"
    ON public.number_order_documents FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = number_order_documents.tenant_id
          AND members.user_id = auth.uid()
          AND members.role IN ('owner','admin')
    ));

DROP POLICY IF EXISTS "Service role full access to number_order_documents" ON public.number_order_documents;
CREATE POLICY "Service role full access to number_order_documents"
    ON public.number_order_documents FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 4. Storage bucket: number-order-documents (privado)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'number-order-documents',
    'number-order-documents',
    false,
    10485760,
    ARRAY['image/jpeg','image/png','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Tenant upload own documents" ON storage.objects;
CREATE POLICY "Tenant upload own documents"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'number-order-documents'
        AND (storage.foldername(name))[1] = (
            SELECT m.tenant_id::text FROM public.members m
            WHERE m.user_id = auth.uid() AND m.is_active = true
            LIMIT 1
        )
    );

DROP POLICY IF EXISTS "Tenant read own documents" ON storage.objects;
CREATE POLICY "Tenant read own documents"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'number-order-documents'
        AND (storage.foldername(name))[1] = (
            SELECT m.tenant_id::text FROM public.members m
            WHERE m.user_id = auth.uid() AND m.is_active = true
            LIMIT 1
        )
    );

DROP POLICY IF EXISTS "Service role full access to number-order-documents storage" ON storage.objects;
CREATE POLICY "Service role full access to number-order-documents storage"
    ON storage.objects FOR ALL TO service_role
    USING (bucket_id = 'number-order-documents')
    WITH CHECK (bucket_id = 'number-order-documents');
