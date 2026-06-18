-- ================================================================
-- TENANT WALLET AND PAY-AS-YOU-GO BILLING SYSTEM
-- ================================================================

-- 1. Create tenant_wallets table
CREATE TABLE IF NOT EXISTS public.tenant_wallets (
    tenant_id             UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    balance_brl           DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    auto_reload_enabled   BOOLEAN NOT NULL DEFAULT false,
    auto_reload_threshold DECIMAL(12, 2) NOT NULL DEFAULT 10.00,
    auto_reload_amount    DECIMAL(12, 2) NOT NULL DEFAULT 50.00,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create wallet_transactions table
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    type               TEXT NOT NULL CHECK (type IN ('recharge', 'deduction', 'refund', 'bonus')),
    amount_brl         DECIMAL(12, 2) NOT NULL,
    balance_after_brl  DECIMAL(12, 2) NOT NULL,
    description        TEXT,
    reference_type     TEXT,
    reference_id       UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Modify tenant_usage_log check constraint to allow numbers
ALTER TABLE public.tenant_usage_log
    DROP CONSTRAINT IF EXISTS tenant_usage_log_resource_type_check;

ALTER TABLE public.tenant_usage_log
    ADD CONSTRAINT tenant_usage_log_resource_type_check
    CHECK (resource_type IN ('call_inbound', 'call_outbound', 'sms_inbound', 'sms_outbound', 'number_purchase', 'number_monthly'));

-- 4. Add columns to tenant_usage_log for cost/price/markup/profit tracking
ALTER TABLE public.tenant_usage_log
    ADD COLUMN IF NOT EXISTS telnyx_cost_brl DECIMAL(12, 6) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS markup_multiplier DECIMAL(6, 2) DEFAULT 2.00,
    ADD COLUMN IF NOT EXISTS total_price_brl DECIMAL(12, 6) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS net_profit_brl DECIMAL(12, 6) DEFAULT 0.00;

-- 5. RLS Setup for tenant_wallets
ALTER TABLE public.tenant_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their tenant's wallet" ON public.tenant_wallets;
CREATE POLICY "Members can view their tenant's wallet"
    ON public.tenant_wallets FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = tenant_wallets.tenant_id
          AND members.user_id = auth.uid()
          AND members.is_active = true
    ));

DROP POLICY IF EXISTS "Service role full access to tenant_wallets" ON public.tenant_wallets;
CREATE POLICY "Service role full access to tenant_wallets"
    ON public.tenant_wallets FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- 6. RLS Setup for wallet_transactions
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their tenant's wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Members can view their tenant's wallet transactions"
    ON public.wallet_transactions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = wallet_transactions.tenant_id
          AND members.user_id = auth.uid()
          AND members.is_active = true
    ));

DROP POLICY IF EXISTS "Service role full access to wallet_transactions" ON public.wallet_transactions;
CREATE POLICY "Service role full access to wallet_transactions"
    ON public.wallet_transactions FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- 7. Trigger to automatically create wallet for new tenants
CREATE OR REPLACE FUNCTION public.handle_new_tenant_wallet()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.tenant_wallets (tenant_id, balance_brl)
    VALUES (NEW.id, 0.00)
    ON CONFLICT (tenant_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_create_tenant_wallet ON public.tenants;
CREATE TRIGGER trg_create_tenant_wallet
    AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_tenant_wallet();

-- Initialize wallets for existing tenants
INSERT INTO public.tenant_wallets (tenant_id, balance_brl)
SELECT id, 0.00 FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- 8. Trigger to automatically calculate pricing and profit BEFORE INSERT on tenant_usage_log
CREATE OR REPLACE FUNCTION public.calculate_tenant_usage_profit()
RETURNS TRIGGER AS $$
DECLARE
    v_exchange_rate DECIMAL(12, 4) := 5.50;
    v_markup DECIMAL(6, 2) := 2.00;
BEGIN
    -- Ensure total_cost_usd is calculated if quantity and unit_cost_usd are set
    IF (NEW.total_cost_usd IS NULL OR NEW.total_cost_usd = 0) AND NEW.unit_cost_usd IS NOT NULL AND NEW.quantity IS NOT NULL THEN
        NEW.total_cost_usd := NEW.unit_cost_usd * NEW.quantity;
    END IF;

    -- Calculate BRL costs and prices
    NEW.telnyx_cost_brl := NEW.total_cost_usd * v_exchange_rate;
    NEW.markup_multiplier := v_markup;
    
    -- Se for aquisição ou mensalidade de número, arredondar o preço final para 2 casas (R$ 33,00)
    IF NEW.resource_type IN ('number_purchase', 'number_monthly') THEN
        NEW.total_price_brl := ROUND(NEW.telnyx_cost_brl * v_markup, 2);
    ELSE
        NEW.total_price_brl := NEW.telnyx_cost_brl * v_markup;
    END IF;
    
    NEW.net_profit_brl := NEW.total_price_brl - NEW.telnyx_cost_brl;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_calculate_tenant_usage_profit ON public.tenant_usage_log;
CREATE TRIGGER trg_calculate_tenant_usage_profit
    BEFORE INSERT ON public.tenant_usage_log
    FOR EACH ROW EXECUTE FUNCTION public.calculate_tenant_usage_profit();

-- 9. Trigger function to deduct balance and log transaction on usage log insert
CREATE OR REPLACE FUNCTION public.handle_tenant_usage_debit()
RETURNS TRIGGER AS $$
DECLARE
    v_new_balance DECIMAL(12, 2);
    v_desc TEXT;
BEGIN
    IF NEW.total_price_brl > 0 THEN
        -- Deduct from tenant_wallets
        UPDATE public.tenant_wallets
        SET balance_brl = balance_brl - NEW.total_price_brl,
            updated_at = NOW()
        WHERE tenant_id = NEW.tenant_id
        RETURNING balance_brl INTO v_new_balance;

        -- If tenant doesn't have a wallet, create one (fallback)
        IF NOT FOUND THEN
            INSERT INTO public.tenant_wallets (tenant_id, balance_brl, updated_at)
            VALUES (NEW.tenant_id, -NEW.total_price_brl, NOW())
            RETURNING balance_brl INTO v_new_balance;
        END IF;

        -- Resolve description
        v_desc := CASE 
            WHEN NEW.resource_type = 'call_inbound' THEN 'Ligação recebida'
            WHEN NEW.resource_type = 'call_outbound' THEN 'Ligação realizada'
            WHEN NEW.resource_type = 'sms_inbound' THEN 'SMS recebido'
            WHEN NEW.resource_type = 'sms_outbound' THEN 'SMS enviado'
            WHEN NEW.resource_type = 'number_purchase' THEN 'Aquisição de número'
            WHEN NEW.resource_type = 'number_monthly' THEN 'Mensalidade de número'
            ELSE 'Consumo de comunicação (' || NEW.resource_type || ')'
        END;

        IF NEW.tenant_phone_number IS NOT NULL AND NEW.tenant_phone_number <> '' THEN
            v_desc := v_desc || ' (' || NEW.tenant_phone_number || ')';
        END IF;

        -- Create transaction record
        INSERT INTO public.wallet_transactions (
            tenant_id,
            type,
            amount_brl,
            balance_after_brl,
            description,
            reference_type,
            reference_id
        ) VALUES (
            NEW.tenant_id,
            'deduction',
            NEW.total_price_brl,
            v_new_balance,
            v_desc,
            'usage_log',
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_tenant_usage_debit ON public.tenant_usage_log;
CREATE TRIGGER trg_tenant_usage_debit
    AFTER INSERT ON public.tenant_usage_log
    FOR EACH ROW EXECUTE FUNCTION public.handle_tenant_usage_debit();

-- Indexes for optimal performance
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_tenant ON public.wallet_transactions(tenant_id, created_at DESC);
