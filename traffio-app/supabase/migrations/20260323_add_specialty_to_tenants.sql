-- Migration: Add specialty to tenants and initialize data

-- 1. Add specialty column
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS specialty TEXT CHECK (specialty IN ('general', 'dental')) DEFAULT 'general';

-- 2. Update existing tenants to 'general' (if any)
UPDATE public.tenants SET specialty = 'general' WHERE specialty IS NULL;

-- 3. (Optional) Helpful view or index if needed later
CREATE INDEX IF NOT EXISTS idx_tenants_specialty ON public.tenants(specialty);
