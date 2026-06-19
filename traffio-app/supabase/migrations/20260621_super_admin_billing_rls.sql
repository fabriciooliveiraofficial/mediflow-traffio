-- ================================================================
-- SUPER ADMIN RLS BYPASS POLICIES FOR BILLING AND TENANTS
-- ================================================================

-- 1. tenants
DROP POLICY IF EXISTS "Super admins can view all tenants" ON public.tenants;
CREATE POLICY "Super admins can view all tenants"
    ON public.tenants FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'super_admin'
    ));

-- 2. tenant_wallets
DROP POLICY IF EXISTS "Super admins can view all wallets" ON public.tenant_wallets;
CREATE POLICY "Super admins can view all wallets"
    ON public.tenant_wallets FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'super_admin'
    ));

-- 3. tenant_usage_log
DROP POLICY IF EXISTS "Super admins can view all usage logs" ON public.tenant_usage_log;
CREATE POLICY "Super admins can view all usage logs"
    ON public.tenant_usage_log FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'super_admin'
    ));

-- 4. wallet_transactions
DROP POLICY IF EXISTS "Super admins can view all wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Super admins can view all wallet transactions"
    ON public.wallet_transactions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'super_admin'
    ));
