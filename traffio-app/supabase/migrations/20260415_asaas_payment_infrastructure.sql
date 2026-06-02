-- ##########################################################
-- ASAAS PAYMENT INFRASTRUCTURE
-- Adds payment gateway columns to tenants and creates the
-- billing_records table (referenced by asaas-webhook).
-- ##########################################################


-- ── 1. TENANTS: gateway credentials ──────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS asaas_api_key       TEXT,
  ADD COLUMN IF NOT EXISTS asaas_wallet_id     TEXT,     -- walletId da subconta (para split)
  ADD COLUMN IF NOT EXISTS asaas_account_id    TEXT,     -- ID da subconta no Asaas
  ADD COLUMN IF NOT EXISTS drcash_api_key      TEXT,
  ADD COLUMN IF NOT EXISTS pagarme_access_token TEXT,    -- mantido para retrocompatibilidade
  ADD COLUMN IF NOT EXISTS payment_config      JSONB DEFAULT '{}'::JSONB;

COMMENT ON COLUMN tenants.asaas_api_key       IS 'Chave de API da subconta Asaas desta clínica (criada automaticamente no onboarding).';
COMMENT ON COLUMN tenants.asaas_wallet_id     IS 'walletId Asaas — usado para split de recebíveis.';
COMMENT ON COLUMN tenants.asaas_account_id    IS 'ID interno da subconta Asaas (retornado ao criar a subconta).';
COMMENT ON COLUMN tenants.drcash_api_key      IS 'Chave de API Dr. Cash para financiamento em boleto em até 24x.';
COMMENT ON COLUMN tenants.payment_config      IS 'Configurações extras de pagamento: { enable_cc, enable_financing, split_enabled }.';


-- ── 2. BILLING RECORDS ────────────────────────────────────
-- Tabela central de cobranças geradas via Asaas.
-- Referenciada pelo asaas-webhook para atualização de status.
CREATE TABLE IF NOT EXISTS billing_records (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id        UUID        REFERENCES patients(id) ON DELETE SET NULL,
  appointment_id    UUID        REFERENCES appointments(id) ON DELETE SET NULL,

  -- Asaas identifiers
  asaas_billing_id  TEXT        UNIQUE,              -- payment.id retornado pela API Asaas
  asaas_customer_id TEXT,                            -- customer.id no Asaas

  -- Financial data
  amount            NUMERIC(10,2) NOT NULL,
  billing_type      TEXT        NOT NULL             -- PIX | CREDIT_CARD | BOLETO | UNDEFINED
                    CHECK (billing_type IN ('PIX','CREDIT_CARD','BOLETO','UNDEFINED')),
  installment_count INT         DEFAULT 1,           -- nº de parcelas (1 = à vista)
  installment_value NUMERIC(10,2),                   -- valor de cada parcela

  -- Status lifecycle
  status            TEXT        NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','RECEIVED','CONFIRMED','OVERDUE','REFUNDED','CANCELLED')),

  -- Metadata
  description       TEXT,
  due_date          DATE,
  invoice_url       TEXT,
  bank_slip_url     TEXT,
  pix_qr_code       TEXT,
  pix_copy_paste    TEXT,

  -- Audit
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_billing_asaas_id     ON billing_records (asaas_billing_id);
CREATE INDEX IF NOT EXISTS idx_billing_tenant        ON billing_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_patient       ON billing_records (patient_id);
CREATE INDEX IF NOT EXISTS idx_billing_appointment   ON billing_records (appointment_id);
CREATE INDEX IF NOT EXISTS idx_billing_status        ON billing_records (status);

-- RLS
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view their billing records"
  ON billing_records FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can do anything on billing_records"
  ON billing_records FOR ALL
  USING (auth.role() = 'service_role');

-- Auto-update updated_at
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


-- ── 3. INSTALLMENT RECORDS (parcelas individuais) ─────────
-- Cada linha de billing_records com installment_count > 1
-- gera N parcelas registradas aqui para rastreio individual.
CREATE TABLE IF NOT EXISTS billing_installments (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  billing_record_id UUID        NOT NULL REFERENCES billing_records(id) ON DELETE CASCADE,
  asaas_payment_id  TEXT        UNIQUE,              -- ID de cada cobrança individual no Asaas
  installment_index INT         NOT NULL,            -- 1, 2, 3 ... N
  amount            NUMERIC(10,2) NOT NULL,
  due_date          DATE,
  status            TEXT        NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','RECEIVED','CONFIRMED','OVERDUE','REFUNDED','CANCELLED')),
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_installment_billing   ON billing_installments (billing_record_id);
CREATE INDEX IF NOT EXISTS idx_installment_asaas_id  ON billing_installments (asaas_payment_id);

ALTER TABLE billing_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can do anything on billing_installments"
  ON billing_installments FOR ALL
  USING (auth.role() = 'service_role');
