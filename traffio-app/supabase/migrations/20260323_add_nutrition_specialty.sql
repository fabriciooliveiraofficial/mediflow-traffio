-- Update the specialty check constraint to include nutrition
ALTER TABLE public.tenants 
DROP CONSTRAINT IF EXISTS tenants_specialty_check;

ALTER TABLE public.tenants 
ADD CONSTRAINT tenants_specialty_check 
CHECK (specialty IN ('general', 'dental', 'nutrition'));

-- Create table for anthropometric evaluations
CREATE TABLE IF NOT EXISTS public.nutri_evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    weight DECIMAL(5,2), -- kg
    height DECIMAL(5,2), -- cm
    bmi DECIMAL(4,2),
    body_fat_pct DECIMAL(4,2),
    waist_circ DECIMAL(5,2), -- cm
    hip_circ DECIMAL(5,2), -- cm
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_nutri_evaluations_patient_id ON public.nutri_evaluations(patient_id);
