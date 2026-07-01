-- ================================================================
-- TRIAL EXTENSIONS (Super-Admin)
-- Permite ao super_admin estender o período de teste de um tenant
-- de forma segura (server-enforced) e auditável.
--
-- Modelo: o enforcement de trial gira em torno de tenants.trial_ends_at
-- (ver SubscriptionGuard / subscriptionService.isTrialExpired). Estender
-- o teste = empurrar trial_ends_at para frente. Como o guard recalcula
-- ao vivo, não há job que "queime" o trial — ao expirar de novo, o
-- pagamento volta a ser reforçado automaticamente.
-- ================================================================

-- 0. Flag de bypass do gate de cartão para trials concedidos pelo super-admin.
--    Sem essa flag, um tenant sem cartão continua caindo no PaymentRequiredModal
--    do SubscriptionGuard mesmo com trial_ends_at estendido no futuro.
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS admin_granted_trial BOOLEAN NOT NULL DEFAULT FALSE;

-- 1. Tabela de auditoria das extensões
CREATE TABLE IF NOT EXISTS public.trial_extensions (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id              UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    extended_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    days_added             INTEGER NOT NULL,
    previous_trial_ends_at TIMESTAMPTZ,
    new_trial_ends_at      TIMESTAMPTZ NOT NULL,
    reason                 TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trial_extensions ENABLE ROW LEVEL SECURITY;

-- Apenas super_admin lê o histórico de extensões.
-- (INSERT acontece dentro da função SECURITY DEFINER, que ignora RLS.)
DROP POLICY IF EXISTS "Super admins can view trial extensions" ON public.trial_extensions;
CREATE POLICY "Super admins can view trial extensions"
    ON public.trial_extensions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'super_admin'
    ));

CREATE INDEX IF NOT EXISTS idx_trial_extensions_tenant
    ON public.trial_extensions (tenant_id, created_at DESC);

-- 2. RPC seguro: estende o trial de UM tenant somando dias.
--    - Só super_admin pode executar (checagem server-side).
--    - Só adiciona dias (p_days > 0); nunca encurta.
--    - Estende a partir de GREATEST(now, trial_ends_at) → evita "somar no
--      passado" e nunca reduz o tempo restante.
--    - Reativa para 'trial' tenants suspensos/cancelados/expirados;
--      não mexe em tenants 'active' (assinantes pagantes).
CREATE OR REPLACE FUNCTION public.extend_tenant_trial(
    p_tenant_id UUID,
    p_days      INTEGER,
    p_reason    TEXT DEFAULT NULL
)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_super  BOOLEAN;
    v_old_ends  TIMESTAMPTZ;
    v_new_ends  TIMESTAMPTZ;
    v_tenant    public.tenants;
BEGIN
    -- AuthZ: somente super_admin
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'super_admin'
    ) INTO v_is_super;

    IF NOT v_is_super THEN
        RAISE EXCEPTION 'forbidden: only super_admin can extend trials'
            USING ERRCODE = '42501';
    END IF;

    -- Validação: apenas adicionar dias
    IF p_days IS NULL OR p_days <= 0 THEN
        RAISE EXCEPTION 'invalid p_days: must be a positive integer'
            USING ERRCODE = '22023';
    END IF;

    -- Lock da linha + leitura do valor atual
    SELECT trial_ends_at INTO v_old_ends
    FROM public.tenants
    WHERE id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'tenant not found: %', p_tenant_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Estende a partir do maior entre agora e o fim atual do trial
    v_new_ends := GREATEST(NOW(), COALESCE(v_old_ends, NOW()))
                  + make_interval(days => p_days);

    UPDATE public.tenants
    SET trial_ends_at        = v_new_ends,
        admin_granted_trial  = TRUE,
        subscription_status  = CASE
            WHEN subscription_status = 'active' THEN subscription_status
            ELSE 'trial'
        END
    WHERE id = p_tenant_id
    RETURNING * INTO v_tenant;

    -- Auditoria
    INSERT INTO public.trial_extensions (
        tenant_id, extended_by, days_added,
        previous_trial_ends_at, new_trial_ends_at, reason
    )
    VALUES (
        p_tenant_id, auth.uid(), p_days,
        v_old_ends, v_new_ends, p_reason
    );

    RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.extend_tenant_trial(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extend_tenant_trial(UUID, INTEGER, TEXT) TO authenticated;
