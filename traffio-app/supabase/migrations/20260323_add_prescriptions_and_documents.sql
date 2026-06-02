-- Migration: Add Prescriptions and Documents tables (FIXED VERSION)
-- Drops existing tables to ensure they have the correct columns

-- 1. DROP EXISTING IF THEY EXIST (To avoid partial states)
DROP TABLE IF EXISTS public.prescriptions CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;

-- 2. Create Prescriptions Table
CREATE TABLE public.prescriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
    content_json JSONB DEFAULT '{}'::jsonb, 
    pdf_url TEXT,
    external_provider_id TEXT, 
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Documents Table (Exams, IDs, etc)
CREATE TABLE public.documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
    medical_record_id UUID REFERENCES public.medical_records(id),
    filename TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_type TEXT,
    category TEXT CHECK (category IN ('exam_result', 'prescription', 'id_card', 'other')),
    uploaded_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Enable RLS
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies (Tenant Isolation)
CREATE POLICY "Members can see tenant prescriptions" ON public.prescriptions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = prescriptions.tenant_id
            AND members.user_id = auth.uid()
        )
    );

CREATE POLICY "Members can insert tenant prescriptions" ON public.prescriptions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = prescriptions.tenant_id
            AND members.user_id = auth.uid()
        )
    );

CREATE POLICY "Members can see tenant documents" ON public.documents
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = documents.tenant_id
            AND members.user_id = auth.uid()
        )
    );

CREATE POLICY "Members can insert tenant documents" ON public.documents
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = documents.tenant_id
            AND members.user_id = auth.uid()
        )
    );
