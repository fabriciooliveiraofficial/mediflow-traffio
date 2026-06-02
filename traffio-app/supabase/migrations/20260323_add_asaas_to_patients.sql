-- ##########################################################
-- ASAAS INTEGRATION - PATIENT ENHANCEMENT
-- ##########################################################

-- Adiciona asaas_customer_id para evitar duplicidade de clientes no Asaas
ALTER TABLE patients ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

-- Adiciona index para busca rápida de faturas
CREATE INDEX IF NOT EXISTS idx_billing_asaas_id ON billing_records (asaas_billing_id);

COMMENT ON COLUMN patients.asaas_customer_id IS 'ID do cliente no sistema Asaas para integração de pagamentos.';
