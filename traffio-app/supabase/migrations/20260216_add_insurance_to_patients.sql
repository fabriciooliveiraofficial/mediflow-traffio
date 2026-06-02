-- Adicionar campos de Convênio/Particular na tabela de pacientes
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'particular' CHECK (type IN ('particular', 'insurance')),
ADD COLUMN IF NOT EXISTS insurance_provider TEXT,
ADD COLUMN IF NOT EXISTS insurance_card TEXT;

-- Adicionar campo para especialidade clínica (para suportar médicos, dentistas, etc)
ALTER TABLE patients
ADD COLUMN IF NOT EXISTS medical_notes TEXT; -- Notas gerais fixas (ex: Alergias)

-- Garantir que as evoluções SOAP tenham campos individuais se necessário, 
-- mas o master_schema já usa campos subject/object/assessment/plan.
-- Vamos garantir que medical_records suporte anexos no futuro.
ALTER TABLE medical_records
ADD COLUMN IF NOT EXISTS attachments_json JSONB DEFAULT '[]'::jsonb;
