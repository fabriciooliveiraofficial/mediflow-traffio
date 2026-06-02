-- Create dental_records table
CREATE TABLE IF NOT EXISTS public.dental_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    tooth_number INTEGER NOT NULL, -- 11-18, 21-28, 31-38, 41-48
    plane TEXT NOT NULL, -- 'vestibular', 'lingual', 'mesial', 'distal', 'occlusal'
    condition TEXT NOT NULL, -- 'caries', 'restored', 'missing', 'etc'
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Basic indexes for performance
CREATE INDEX idx_dental_records_patient ON public.dental_records(patient_id);
CREATE INDEX idx_dental_records_tenant ON public.dental_records(tenant_id);

-- RLS
ALTER TABLE public.dental_records ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view internal dental records"
    ON public.dental_records FOR SELECT
    USING (auth.uid() IN (
        SELECT user_id FROM public.members WHERE tenant_id = dental_records.tenant_id
    ));

CREATE POLICY "Users can insert dental records"
    ON public.dental_records FOR INSERT
    WITH CHECK (auth.uid() IN (
        SELECT user_id FROM public.members WHERE tenant_id = dental_records.tenant_id
    ));

CREATE POLICY "Users can update their clinic's dental records"
    ON public.dental_records FOR UPDATE
    USING (auth.uid() IN (
        SELECT user_id FROM public.members WHERE tenant_id = dental_records.tenant_id
    ));
