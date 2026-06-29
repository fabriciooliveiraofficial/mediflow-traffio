-- Clean up duplicate patients by tenant_id + cpf (keeping the most recently updated or created)
DELETE FROM public.patients
WHERE id IN (
  SELECT id
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id, cpf ORDER BY COALESCE(updated_at, created_at) DESC) as rn
    FROM public.patients
    WHERE cpf IS NOT NULL AND cpf <> ''
  ) t
  WHERE t.rn > 1
);

-- Clean up duplicate patients by tenant_id + national_id (keeping the most recently updated or created)
DELETE FROM public.patients
WHERE id IN (
  SELECT id
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id, national_id ORDER BY COALESCE(updated_at, created_at) DESC) as rn
    FROM public.patients
    WHERE national_id IS NOT NULL AND national_id <> ''
  ) t
  WHERE t.rn > 1
);

-- Create unique indexes to enforce uniqueness of CPF and national_id per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_cpf_unique 
ON public.patients (tenant_id, cpf) 
WHERE cpf IS NOT NULL AND cpf <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_national_id_unique 
ON public.patients (tenant_id, national_id) 
WHERE national_id IS NOT NULL AND national_id <> '';
