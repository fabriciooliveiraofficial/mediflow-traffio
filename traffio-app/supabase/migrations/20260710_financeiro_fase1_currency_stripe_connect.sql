-- ##########################################################
-- FINANCEIRO FASE 1 — moeda por tenant + Stripe Connect
--
-- Decisão de produto (2026-07-10):
--   • Página Pagamentos passa a ser Stripe-only, via Stripe
--     Connect (contas Standard) — nunca API keys cruas.
--   • Página Financeiro vira caixa gateway-agnóstico; valores
--     operacionais do tenant (billing_records, propostas,
--     recibos) são armazenados NA MOEDA DO TENANT, sem
--     conversão. Conversão display-only (Frankfurter) fica
--     restrita ao domínio da plataforma (assinatura/ads).
--
-- Também alinha billing_records ao que o frontend já espera
-- (due_date/notes ausentes no schema vivo) e libera o status
-- 'canceled' que o BillingService grava.
-- ##########################################################


-- ── 1. TENANTS: moeda preferida + Stripe Connect ──────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS currency TEXT
    CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_connect_status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (stripe_connect_status IN ('not_connected','onboarding','active','disabled'));

COMMENT ON COLUMN tenants.currency IS
  'Moeda operacional preferida (ISO 4217), escolhida em Configurações. NULL = derivar do país (countryFormats). billing_records/propostas/recibos armazenam valores nesta moeda, sem conversão.';
COMMENT ON COLUMN tenants.stripe_account_id IS
  'Conta Stripe Connect (Standard) do tenant para receber de pacientes. Distinta de stripe_customer_id (assinatura da plataforma). Nunca armazenar secret keys.';
COMMENT ON COLUMN tenants.stripe_connect_status IS
  'not_connected | onboarding | active | disabled — sincronizado via account.updated no stripe-connect-webhook.';
COMMENT ON COLUMN tenants.payment_config IS
  'JSONB. Chave accepted_methods: [{ id: cash|card_machine|bank_transfer|insurance|financing|check|other, enabled: bool, label: text|null }] — métodos manuais aceitos no caixa. Chaves legadas enable_cc/enable_financing (Asaas/DrCash) em desuso.';

-- Lookup do webhook Connect (account.updated chega só com o acct_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_stripe_account_id
  ON tenants (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;


-- ── 2. BILLING_RECORDS: colunas esperadas pelo app + Fase 1 ─
ALTER TABLE billing_records
  ADD COLUMN IF NOT EXISTS currency TEXT
    CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_link_url TEXT,
  ADD COLUMN IF NOT EXISTS receipt_number BIGINT,
  ADD COLUMN IF NOT EXISTS installment_no INT,
  ADD COLUMN IF NOT EXISTS installment_count INT;

COMMENT ON COLUMN billing_records.currency IS
  'Snapshot ISO 4217 da moeda do tenant no momento da criação. Registros antigos não mudam quando o tenant troca de moeda.';
COMMENT ON COLUMN billing_records.receipt_number IS
  'Numeração sequencial de recibo por tenant (alocada na Fase 2 ao registrar recebimento).';

-- Registros históricos nasceram na era BRL-only
UPDATE billing_records SET currency = 'BRL' WHERE currency IS NULL;

-- Status: liberar 'canceled' (o app já grava; o CHECK vivo rejeitava)
ALTER TABLE billing_records DROP CONSTRAINT IF EXISTS billing_records_status_check;
ALTER TABLE billing_records ADD CONSTRAINT billing_records_status_check
  CHECK (status IN ('pending','paid','overdue','refunded','canceled'));

-- Índices de operação do caixa e conciliação Stripe
CREATE INDEX IF NOT EXISTS idx_billing_records_tenant_status
  ON billing_records (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_billing_records_tenant_due
  ON billing_records (tenant_id, due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_records_stripe_session
  ON billing_records (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_records_stripe_pi
  ON billing_records (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;


-- ── 3. Moeda default no INSERT (rede de segurança) ─────────
-- Se o app não mandar currency, herda a moeda efetiva do tenant
-- (tenants.currency, senão a moeda do país, senão BRL).
-- SECURITY DEFINER: o membro que insere nem sempre tem SELECT
-- em todas as colunas de tenants via RLS.
CREATE OR REPLACE FUNCTION billing_records_set_currency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.currency IS NULL THEN
    SELECT COALESCE(
             t.currency,
             CASE UPPER(COALESCE(t.country, 'BR'))
               WHEN 'US' THEN 'USD'
               WHEN 'NZ' THEN 'NZD'
               WHEN 'MX' THEN 'MXN'
               ELSE 'BRL'
             END
           )
      INTO NEW.currency
      FROM tenants t
     WHERE t.id = NEW.tenant_id;
    NEW.currency := COALESCE(NEW.currency, 'BRL');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_records_set_currency ON billing_records;
CREATE TRIGGER trg_billing_records_set_currency
  BEFORE INSERT ON billing_records
  FOR EACH ROW EXECUTE FUNCTION billing_records_set_currency();


-- ── 4. updated_at automático ───────────────────────────────
CREATE OR REPLACE FUNCTION update_billing_records_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_records_updated_at ON billing_records;
CREATE TRIGGER trg_billing_records_updated_at
  BEFORE UPDATE ON billing_records
  FOR EACH ROW EXECUTE FUNCTION update_billing_records_updated_at();
