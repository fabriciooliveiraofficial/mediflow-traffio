-- Create dental_procedures table for price list
CREATE TABLE IF NOT EXISTS public.dental_procedures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    code TEXT, -- TUSS or internal code
    name TEXT NOT NULL,
    category TEXT, -- 'prevention', 'restoration', 'surgery', etc.
    base_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed some common dental procedures
INSERT INTO public.dental_procedures (tenant_id, name, category, base_price)
SELECT id, 'Limpeza e Profilaxia', 'prevention', 180.00 FROM public.tenants WHERE specialty = 'dental'
ON CONFLICT DO NOTHING;

INSERT INTO public.dental_procedures (tenant_id, name, category, base_price)
SELECT id, 'Restauração de Resina', 'restoration', 250.00 FROM public.tenants WHERE specialty = 'dental'
ON CONFLICT DO NOTHING;

INSERT INTO public.dental_procedures (tenant_id, name, category, base_price)
SELECT id, 'Extração Simples', 'surgery', 350.00 FROM public.tenants WHERE specialty = 'dental'
ON CONFLICT DO NOTHING;
