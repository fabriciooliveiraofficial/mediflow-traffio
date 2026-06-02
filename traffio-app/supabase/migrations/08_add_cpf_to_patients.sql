-- Adiciona coluna CPF à tabela patients (se não existir)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS cpf TEXT;
CREATE INDEX IF NOT EXISTS idx_patients_cpf ON patients (cpf) WHERE cpf IS NOT NULL;
