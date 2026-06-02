-- ================================================================
-- STRIPE INTEGRATION
-- Campos de customer e checkout na tabela tenants
-- ================================================================

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

-- Índice para lookup rápido via webhook do Stripe
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer_id
    ON public.tenants (stripe_customer_id);
