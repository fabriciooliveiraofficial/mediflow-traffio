-- =============================================================================
-- MIGRAÇÃO 07: Serviço por Local (doctor_service_locations)
--
-- doctor_services tem colunas: (tenant_id, doctor_id, service_id)
-- onde service_id → appointment_types.id
--
-- Solução: adicionar location_id à tabela doctor_services, tornando-a uma
-- relação 3-way: médico × serviço × local.
-- =============================================================================

-- Adiciona location_id à tabela doctor_services (nullable para não quebrar
-- registros existentes que não têm local definido ainda)
ALTER TABLE doctor_services
    ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;

-- Índice para a query mais comum: dado doctor_id + service_id, quais locais?
CREATE INDEX IF NOT EXISTS idx_doctor_services_type_location
    ON doctor_services (doctor_id, service_id)
    WHERE location_id IS NOT NULL;

-- Índice para listar serviços de um médico em um local específico
CREATE INDEX IF NOT EXISTS idx_doctor_services_location
    ON doctor_services (doctor_id, location_id)
    WHERE location_id IS NOT NULL;
