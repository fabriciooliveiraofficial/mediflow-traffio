-- Add preparation_instructions column to appointment_types
ALTER TABLE appointment_types ADD COLUMN IF NOT EXISTS preparation_instructions TEXT;

-- Update RLS if necessary (usually not needed if table already enabled)
COMMENT ON COLUMN appointment_types.preparation_instructions IS 'Instruções de preparo que o bot enviará ao confirmar o agendamento.';
