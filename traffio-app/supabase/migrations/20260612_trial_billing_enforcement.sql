-- ================================================================
-- TRIAL BILLING ENFORCEMENT
-- Leads de registro (remarketing) + flag de cartão no tenant
-- Executado no SQL Editor em 2026-06-12 (Migration 1)
-- ================================================================

-- 1. Tabela de leads de registro (TODO registro gera um lead,
--    mesmo em caso de desistência — base de remarketing)
CREATE TABLE IF NOT EXISTS public.registration_leads (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_name    TEXT NOT NULL,
    admin_name     TEXT NOT NULL,
    email          TEXT NOT NULL,
    phone          TEXT,
    plan_id        TEXT,
    billing_cycle  TEXT CHECK (billing_cycle IN ('monthly', 'annual')),
    tenant_id      UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    email_sent_at  TIMESTAMPTZ,          -- quando o e-mail p/ cadastro@ foi enviado
    converted_at   TIMESTAMPTZ,          -- quando inseriu cartão (conversão)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS deny-all: somente service-role (Edge Functions) acessa.
-- Dados sensíveis de remarketing JAMAIS expostos a tenants.
ALTER TABLE public.registration_leads ENABLE ROW LEVEL SECURITY;
-- (sem policies = nenhum acesso via anon/authenticated)

CREATE INDEX IF NOT EXISTS idx_registration_leads_email
    ON public.registration_leads (email);
CREATE INDEX IF NOT EXISTS idx_registration_leads_created_at
    ON public.registration_leads (created_at DESC);

-- 2. Flag de cartão cadastrado no tenant (gate de acesso)
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS card_on_file BOOLEAN NOT NULL DEFAULT FALSE;

-- Tenants que já têm assinatura ativa no Stripe possuem cartão
UPDATE public.tenants
SET card_on_file = TRUE
WHERE subscription_status = 'active'
   OR subscription_external_id IS NOT NULL;

-- Índice para o gate (consulta frequente no login)
CREATE INDEX IF NOT EXISTS idx_tenants_card_on_file
    ON public.tenants (card_on_file)
    WHERE card_on_file = FALSE;
