-- ================================================================
-- MONETIZAÇÃO DA IA — franquia por orçamento de custo + carteira de créditos
-- Plano aprovado em 15/09/2026 (docs/PLANO_MONETIZACAO_IA_2026-09.md).
--
-- Regra econômica que este schema sustenta: piso de 35% de margem em QUALQUER
-- cenário. Para isso a franquia NÃO é contada em "respostas" (custo variável),
-- e sim em ORÇAMENTO DE CUSTO: 1 conversa = AI_CONVERSATION_UNIT_BRL (R$1,55)
-- de custo real de IA. Toda chamada de LLM debita o custo real; o tenant nunca
-- consome mais do que franquia × unidade, independente de cache/dólar/modelo.
--
-- Idempotente: pode ser reaplicada sem efeito colateral.
-- ================================================================

-- ─── 1. Planos: preços novos, franquia de IA, 1 número incluso em todos ─────
ALTER TABLE public.plans
    ADD COLUMN IF NOT EXISTS ai_conversations_included   INT           NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS extra_whatsapp_number_price NUMERIC(10,2) NOT NULL DEFAULT 229.00;

-- Anual = 1 mês grátis (11/12), não mais -20%: com Z-API (R$100/número) + Stripe
-- + imposto somando ~45% da receita, -20% derrubava a margem abaixo do piso.
UPDATE public.plans SET monthly_price = 297, annual_monthly_price = 272, max_whatsapp_numbers = 1, ai_conversations_included = 0   WHERE id = 'essencial';
UPDATE public.plans SET monthly_price = 547, annual_monthly_price = 497, max_whatsapp_numbers = 1, ai_conversations_included = 60  WHERE id = 'clinica';
UPDATE public.plans SET monthly_price = 997, annual_monthly_price = 917, max_whatsapp_numbers = 1, ai_conversations_included = 150 WHERE id = 'rede';

-- Números WhatsApp além do 1º incluso (cada um = 1 instância Z-API paga pela Traffio)
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS extra_whatsapp_numbers INT NOT NULL DEFAULT 0;

-- ─── 2. Pacotes de conversas de IA (compra avulsa; créditos não expiram) ─────
-- Piso de R$3,50/conversa = 35% de margem mesmo no cenário de estresse
-- (R$1,55 de custo + Stripe 4,69% + imposto 15,5%).
CREATE TABLE IF NOT EXISTS public.ai_packages (
    id         TEXT PRIMARY KEY,
    units      INT NOT NULL,
    price_brl  NUMERIC(10,2) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO public.ai_packages (id, units, price_brl, sort_order) VALUES
    ('ai_50',  50,  199.00,  1),
    ('ai_150', 150, 549.00,  2),
    ('ai_500', 500, 1790.00, 3)
ON CONFLICT (id) DO UPDATE SET units = EXCLUDED.units, price_brl = EXCLUDED.price_brl, sort_order = EXCLUDED.sort_order;

ALTER TABLE public.ai_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_packages_public_read ON public.ai_packages;
CREATE POLICY ai_packages_public_read ON public.ai_packages FOR SELECT USING (TRUE);

-- ─── 3. Parâmetros econômicos (editáveis em /master/intelligence) ───────────
INSERT INTO public.master_config (key, value, description, is_secret) VALUES
    ('AI_USD_BRL_RATE',          '5.69', 'Câmbio USD→BRL usado no custo de IA (já com IOF). Revisar todo mês; acima de 6,20 reprecificar pacotes.', false),
    ('AI_CONVERSATION_UNIT_BRL', '1.55', 'Custo de IA (R$) que equivale a 1 conversa da franquia. Cada chamada de LLM debita o custo real.', false),
    ('AI_DAILY_CAP_BRL',         '30',   'Teto diário de custo de IA por tenant (R$). Atingido → IA pausa até o dia seguinte e as conversas vão à fila humana.', false),
    ('AI_PHONE_TURNS_PER_HOUR',  '40',   'Máximo de respostas do agente ao MESMO telefone em 1h (anti-loop / robô).', false),
    ('AI_TRIAL_CONVERSATIONS',   '20',   'Conversas de IA por mês durante o trial (custo de aquisição, máx. R$31/trial).', false)
ON CONFLICT (key) DO NOTHING;

-- ─── 4. ai_usage_logs: custo em BRL + correção histórica ─────────────────────
-- Sonnet 5 custa US$2/10 por MTok (o reajuste para 3/15 foi cancelado pela
-- Anthropic). Até 15/09/2026 o llmProvider gravava 3/15 — todos os componentes
-- (input, cache write, cache read, output) escalam exatamente por 2/3.
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS cost_brl_cents NUMERIC(14,4);

UPDATE public.ai_usage_logs
   SET cost_api_cents     = cost_api_cents * 2.0 / 3.0,
       price_tenant_cents = price_tenant_cents * 2.0 / 3.0
 WHERE model = 'claude-sonnet-5'
   AND created_at < '2026-09-15'
   AND cost_brl_cents IS NULL;   -- guarda de idempotência: só antes do backfill abaixo

UPDATE public.ai_usage_logs SET cost_brl_cents = cost_api_cents * 5.69 WHERE cost_brl_cents IS NULL;
ALTER TABLE public.ai_usage_logs ALTER COLUMN cost_brl_cents SET DEFAULT 0;

-- ─── 5. Carteira de créditos de IA + ledger ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_ai_wallets (
    tenant_id         UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    credit_units      NUMERIC(12,2) NOT NULL DEFAULT 0,   -- conversas compradas (pacotes), não expiram
    last_alert_at     TIMESTAMPTZ,                         -- último aviso "IA pausada" enviado ao tenant
    last_alert_reason TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_credit_transactions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    type           TEXT NOT NULL CHECK (type IN ('purchase', 'consumption', 'bonus', 'adjustment')),
    units          NUMERIC(12,4) NOT NULL,      -- positivo = crédito, negativo = consumo
    balance_after  NUMERIC(12,2) NOT NULL,
    description    TEXT,
    reference_type TEXT,
    reference_id   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_credit_tx_tenant ON public.ai_credit_transactions (tenant_id, created_at DESC);

ALTER TABLE public.tenant_ai_wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_ai_wallets_members_read ON public.tenant_ai_wallets;
CREATE POLICY tenant_ai_wallets_members_read ON public.tenant_ai_wallets FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.members m WHERE m.tenant_id = tenant_ai_wallets.tenant_id AND m.user_id = auth.uid() AND m.is_active));
DROP POLICY IF EXISTS tenant_ai_wallets_service_all ON public.tenant_ai_wallets;
CREATE POLICY tenant_ai_wallets_service_all ON public.tenant_ai_wallets FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

ALTER TABLE public.ai_credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_credit_tx_members_read ON public.ai_credit_transactions;
CREATE POLICY ai_credit_tx_members_read ON public.ai_credit_transactions FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.members m WHERE m.tenant_id = ai_credit_transactions.tenant_id AND m.user_id = auth.uid() AND m.is_active));
DROP POLICY IF EXISTS ai_credit_tx_service_all ON public.ai_credit_transactions;
CREATE POLICY ai_credit_tx_service_all ON public.ai_credit_transactions FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

INSERT INTO public.tenant_ai_wallets (tenant_id) SELECT id FROM public.tenants ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_tenant_ai_wallet()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.tenant_ai_wallets (tenant_id) VALUES (NEW.id) ON CONFLICT (tenant_id) DO NOTHING;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_create_tenant_ai_wallet ON public.tenants;
CREATE TRIGGER trg_create_tenant_ai_wallet AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_tenant_ai_wallet();

-- ─── 6. Helpers de leitura ───────────────────────────────────────────────────
-- Lê um parâmetro numérico da master_config; valor ausente/inválido → default.
CREATE OR REPLACE FUNCTION public.ai_config_num(p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(
        (SELECT CASE WHEN trim(value) ~ '^[0-9]+([.,][0-9]+)?$' THEN replace(trim(value), ',', '.')::numeric END
           FROM public.master_config WHERE key = p_key),
        p_default);
$$;

-- Franquia mensal do tenant (em conversas). Trial vigente → AI_TRIAL_CONVERSATIONS;
-- assinatura ativa → franquia do plano; suspenso/cancelado/trial vencido → 0
-- (a IA não pode gastar por quem não está pagando).
CREATE OR REPLACE FUNCTION public.ai_included_units(p_tenant UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((
        SELECT CASE
            WHEN t.subscription_status = 'trial' AND (t.trial_ends_at IS NULL OR t.trial_ends_at > now())
                THEN public.ai_config_num('AI_TRIAL_CONVERSATIONS', 20)
            WHEN t.subscription_status = 'active'
                THEN COALESCE(p.ai_conversations_included, 0)
            ELSE 0
        END
        FROM public.tenants t
        LEFT JOIN public.plans p ON p.id = t.plan
        WHERE t.id = p_tenant
    ), 0);
$$;

-- Status do orçamento de IA do tenant no mês corrente (mês-calendário UTC).
-- Usado pelo gate das Edge Functions (service role) e pela página de Assinatura
-- (membro do tenant ou master admin).
CREATE OR REPLACE FUNCTION public.ai_budget_status(p_tenant UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_unit_cents   NUMERIC := public.ai_config_num('AI_CONVERSATION_UNIT_BRL', 1.55) * 100;
    v_daily_cap    NUMERIC := public.ai_config_num('AI_DAILY_CAP_BRL', 30);
    v_included     NUMERIC := public.ai_included_units(p_tenant);
    v_month_cents  NUMERIC := 0;
    v_today_cents  NUMERIC := 0;
    v_credit       NUMERIC := 0;
    v_status       TEXT;
    v_used_units   NUMERIC;
    v_remaining    NUMERIC;
    v_reason       TEXT := 'ok';
BEGIN
    IF auth.uid() IS NOT NULL
       AND NOT public.is_master_admin()
       AND NOT EXISTS (SELECT 1 FROM public.members WHERE tenant_id = p_tenant AND user_id = auth.uid() AND is_active) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    SELECT COALESCE(SUM(cost_brl_cents), 0),
           COALESCE(SUM(cost_brl_cents) FILTER (WHERE created_at >= date_trunc('day', now())), 0)
      INTO v_month_cents, v_today_cents
      FROM public.ai_usage_logs
     WHERE tenant_id = p_tenant AND created_at >= date_trunc('month', now());

    SELECT COALESCE(credit_units, 0) INTO v_credit FROM public.tenant_ai_wallets WHERE tenant_id = p_tenant;
    v_credit := COALESCE(v_credit, 0);
    SELECT subscription_status INTO v_status FROM public.tenants WHERE id = p_tenant;

    v_used_units := v_month_cents / v_unit_cents;
    -- Créditos já são debitados pelo trigger conforme o consumo passa da franquia,
    -- então o que sobra = franquia não usada + saldo atual de créditos.
    v_remaining  := GREATEST(v_included - v_used_units, 0) + v_credit;

    IF v_included = 0 AND v_credit <= 0 AND v_status IS DISTINCT FROM 'active' THEN
        v_reason := 'subscription_inactive';
    ELSIF v_remaining <= 0 THEN
        v_reason := 'quota_exhausted';
    ELSIF v_today_cents / 100 >= v_daily_cap THEN
        v_reason := 'daily_cap';
    END IF;

    RETURN jsonb_build_object(
        'allowed',          v_reason = 'ok',
        'reason',           v_reason,
        'included_units',   v_included,
        'used_units',       ROUND(v_used_units, 2),
        'credit_units',     v_credit,
        'remaining_units',  ROUND(GREATEST(v_remaining, 0), 2),
        'spent_month_brl',  ROUND(v_month_cents / 100, 2),
        'spent_today_brl',  ROUND(v_today_cents / 100, 2),
        'daily_cap_brl',    v_daily_cap,
        'unit_brl',         v_unit_cents / 100,
        'period_start',     date_trunc('month', now())
    );
END;
$$;

-- Credita/ajusta conversas na carteira (service role e master admin apenas).
CREATE OR REPLACE FUNCTION public.ai_credit_apply(
    p_tenant UUID, p_units NUMERIC, p_type TEXT, p_description TEXT,
    p_reference_type TEXT DEFAULT NULL, p_reference_id TEXT DEFAULT NULL
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance NUMERIC;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_master_admin() THEN
        RAISE EXCEPTION 'forbidden';
    END IF;
    IF p_type NOT IN ('purchase', 'bonus', 'adjustment') THEN
        RAISE EXCEPTION 'tipo inválido: %', p_type;
    END IF;
    -- Idempotência por referência (webhook do Stripe pode reentregar o evento)
    IF p_reference_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.ai_credit_transactions WHERE reference_type = p_reference_type AND reference_id = p_reference_id
    ) THEN
        SELECT credit_units INTO v_balance FROM public.tenant_ai_wallets WHERE tenant_id = p_tenant;
        RETURN v_balance;
    END IF;

    INSERT INTO public.tenant_ai_wallets (tenant_id) VALUES (p_tenant) ON CONFLICT (tenant_id) DO NOTHING;
    UPDATE public.tenant_ai_wallets
       SET credit_units = credit_units + p_units, updated_at = now()
     WHERE tenant_id = p_tenant
     RETURNING credit_units INTO v_balance;

    INSERT INTO public.ai_credit_transactions (tenant_id, type, units, balance_after, description, reference_type, reference_id)
    VALUES (p_tenant, p_type, p_units, v_balance, p_description, p_reference_type, p_reference_id);
    RETURN v_balance;
END;
$$;

-- ─── 7. Trigger: consumo acima da franquia debita créditos ───────────────────
-- AFTER INSERT em ai_usage_logs. Calcula a parcela DESTA chamada que ultrapassa
-- a franquia do mês e debita da carteira (em conversas). Nunca lança: o log de
-- uso jamais pode falhar por causa da cobrança.
CREATE OR REPLACE FUNCTION public.ai_usage_debit_credits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_unit_cents     NUMERIC;
    v_included_cents NUMERIC;
    v_used_before    NUMERIC;
    v_excess         NUMERIC;
    v_units          NUMERIC;
    v_balance        NUMERIC;
BEGIN
    IF NEW.tenant_id IS NULL OR NEW.cost_brl_cents IS NULL OR NEW.cost_brl_cents <= 0 THEN
        RETURN NEW;
    END IF;

    v_unit_cents     := public.ai_config_num('AI_CONVERSATION_UNIT_BRL', 1.55) * 100;
    v_included_cents := public.ai_included_units(NEW.tenant_id) * v_unit_cents;

    SELECT COALESCE(SUM(cost_brl_cents), 0) INTO v_used_before
      FROM public.ai_usage_logs
     WHERE tenant_id = NEW.tenant_id
       AND created_at >= date_trunc('month', NEW.created_at)
       AND id <> NEW.id;

    -- Parcela desta chamada além da franquia (0 enquanto a franquia cobre tudo)
    v_excess := GREATEST(0, (v_used_before + NEW.cost_brl_cents) - GREATEST(v_included_cents, v_used_before));
    IF v_excess <= 0 THEN RETURN NEW; END IF;

    v_units := v_excess / v_unit_cents;
    INSERT INTO public.tenant_ai_wallets (tenant_id) VALUES (NEW.tenant_id) ON CONFLICT (tenant_id) DO NOTHING;
    UPDATE public.tenant_ai_wallets
       SET credit_units = credit_units - v_units, updated_at = now()
     WHERE tenant_id = NEW.tenant_id
     RETURNING credit_units INTO v_balance;

    INSERT INTO public.ai_credit_transactions (tenant_id, type, units, balance_after, description, reference_type, reference_id)
    VALUES (NEW.tenant_id, 'consumption', -v_units, v_balance,
            'Consumo de IA acima da franquia (' || COALESCE(NEW.context, 'llm') || ')',
            'ai_usage_log', NEW.id::text);
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[ai_usage_debit_credits] falha isolada (log de uso preservado): %', SQLERRM;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_usage_debit_credits ON public.ai_usage_logs;
CREATE TRIGGER trg_ai_usage_debit_credits AFTER INSERT ON public.ai_usage_logs
    FOR EACH ROW EXECUTE FUNCTION public.ai_usage_debit_credits();

GRANT EXECUTE ON FUNCTION public.ai_budget_status(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_credit_apply(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
