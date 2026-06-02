-- ##########################################################
-- CLINIC INTELLIGENCE - FAQ & RULES
-- ##########################################################

CREATE TABLE IF NOT EXISTS clinic_info (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT DEFAULT 'general', -- 'logistics', 'amenities', 'policies', 'faq'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, key)
);

-- Habilitar RLS
ALTER TABLE clinic_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants look up clinic info"
  ON clinic_info FOR SELECT
  USING (true); -- Publicly readable for the bot (restricted by tenant_id in code)

-- Inserir alguns exemplos de dados para teste (opcional)
-- INSERT INTO clinic_info (tenant_id, key, value, category) VALUES 
-- ('YOUR_TENANT_ID', 'estacionamento', 'Temos estacionamento gratuito no local com manobrista.', 'logistics'),
-- ('YOUR_TENANT_ID', 'wifi', 'A senha do Wi-Fi na recepção é medflow2024.', 'amenities');
