-- ================================================================
-- SUBSCRIPTION PLANS
-- Tabela de planos, colunas de assinatura em tenants e faturas
-- ================================================================

-- 1. Tabela de planos (fonte única de verdade dos planos disponíveis)
CREATE TABLE IF NOT EXISTS public.plans (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    monthly_price         NUMERIC(10,2) NOT NULL,
    annual_monthly_price  NUMERIC(10,2) NOT NULL,  -- preço mensal no ciclo anual
    max_professionals     INT,                      -- NULL = ilimitado
    max_locations         INT,                      -- NULL = ilimitado
    max_whatsapp_numbers  INT NOT NULL DEFAULT 1,
    max_storage_gb        INT NOT NULL DEFAULT 5,
    features              JSONB NOT NULL DEFAULT '{}'::JSONB,
    sort_order            INT NOT NULL DEFAULT 0,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.plans
    (id, name, monthly_price, annual_monthly_price, max_professionals, max_locations, max_whatsapp_numbers, max_storage_gb, features, sort_order)
VALUES
    (
        'essencial',
        'Essencial',
        197.00,
        158.00,
        2,      -- max_professionals
        1,      -- max_locations
        1,      -- max_whatsapp_numbers
        5,      -- max_storage_gb
        '{
            "agenda": true,
            "prontuario": true,
            "portal_paciente": true,
            "whatsapp_lembretes": true,
            "whatsapp_inbox": false,
            "whatsapp_midia": false,
            "crm_kanban": false,
            "marketing_ads": false,
            "financeiro_completo": false,
            "modulos_especialidade": 1,
            "dicom": false,
            "ia_termos_clinicos": false,
            "master_dashboard": false,
            "api_access": false,
            "onboarding_assistido": false
        }'::JSONB,
        1
    ),
    (
        'clinica',
        'Clínica',
        397.00,
        318.00,
        10,     -- max_professionals
        3,      -- max_locations
        1,      -- max_whatsapp_numbers (1 por unidade, cobrado extra)
        30,     -- max_storage_gb
        '{
            "agenda": true,
            "prontuario": true,
            "portal_paciente": true,
            "whatsapp_lembretes": true,
            "whatsapp_inbox": true,
            "whatsapp_midia": true,
            "crm_kanban": true,
            "marketing_ads": true,
            "financeiro_completo": true,
            "modulos_especialidade": -1,
            "dicom": true,
            "ia_termos_clinicos": true,
            "master_dashboard": false,
            "api_access": false,
            "onboarding_assistido": false
        }'::JSONB,
        2
    ),
    (
        'rede',
        'Rede',
        897.00,
        718.00,
        NULL,   -- ilimitado
        NULL,   -- ilimitado
        3,      -- max_whatsapp_numbers inclusos (adicional cobrado à parte)
        200,    -- max_storage_gb
        '{
            "agenda": true,
            "prontuario": true,
            "portal_paciente": true,
            "whatsapp_lembretes": true,
            "whatsapp_inbox": true,
            "whatsapp_midia": true,
            "crm_kanban": true,
            "marketing_ads": true,
            "financeiro_completo": true,
            "modulos_especialidade": -1,
            "dicom": true,
            "ia_termos_clinicos": true,
            "master_dashboard": true,
            "api_access": true,
            "onboarding_assistido": true
        }'::JSONB,
        3
    )
ON CONFLICT (id) DO NOTHING;

-- 2. Colunas de assinatura na tabela tenants
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS plan                    TEXT REFERENCES public.plans(id) DEFAULT 'essencial',
    ADD COLUMN IF NOT EXISTS subscription_status     TEXT CHECK (subscription_status IN ('trial', 'active', 'suspended', 'canceled')) DEFAULT 'trial',
    ADD COLUMN IF NOT EXISTS billing_cycle           TEXT CHECK (billing_cycle IN ('monthly', 'annual')) DEFAULT 'monthly',
    ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS subscription_renews_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trial_ends_at           TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
    ADD COLUMN IF NOT EXISTS subscription_external_id TEXT;

-- Inicializar tenants existentes sem plano atribuído
UPDATE public.tenants
SET
    plan                = 'essencial',
    subscription_status = 'trial',
    trial_ends_at       = NOW() + INTERVAL '14 days'
WHERE plan IS NULL;

-- 3. Faturas de assinatura do tenant (histórico de cobranças do plano)
CREATE TABLE IF NOT EXISTS public.tenant_invoices (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    plan_id              TEXT NOT NULL REFERENCES public.plans(id),
    billing_cycle        TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')) DEFAULT 'monthly',
    amount               NUMERIC(10,2) NOT NULL,
    status               TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded')) DEFAULT 'pending',
    due_date             DATE,
    paid_at              TIMESTAMPTZ,
    external_invoice_id  TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. RLS

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Planos são públicos para leitura (necessário para a página de preços)
CREATE POLICY "plans_public_read" ON public.plans
    FOR SELECT USING (TRUE);

ALTER TABLE public.tenant_invoices ENABLE ROW LEVEL SECURITY;

-- Faturas visíveis apenas para membros ativos do tenant
CREATE POLICY "invoices_tenant_members" ON public.tenant_invoices
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM public.members
            WHERE user_id = auth.uid() AND is_active = TRUE
        )
    );

-- Índices
CREATE INDEX IF NOT EXISTS idx_tenant_invoices_tenant_id ON public.tenant_invoices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_plan ON public.tenants (plan);
CREATE INDEX IF NOT EXISTS idx_tenants_subscription_status ON public.tenants (subscription_status);
