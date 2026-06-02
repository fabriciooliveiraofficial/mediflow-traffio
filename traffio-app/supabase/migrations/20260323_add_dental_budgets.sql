-- Table for Dental Budgets
CREATE TABLE IF NOT EXISTS public.dental_budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'sent', 'approved', 'rejected'
    total_amount DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    valid_until DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for Individual Budget Items (mapped to teeth/procedures)
CREATE TABLE IF NOT EXISTS public.dental_budget_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    budget_id UUID NOT NULL REFERENCES public.dental_budgets(id) ON DELETE CASCADE,
    tooth_number INTEGER,
    plane TEXT,
    procedure_name TEXT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    quantity INTEGER DEFAULT 1,
    total_price DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dental_budgets_patient ON public.dental_budgets(patient_id);
CREATE INDEX IF NOT EXISTS idx_dental_budget_items_budget ON public.dental_budget_items(budget_id);

-- RLS
ALTER TABLE public.dental_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dental_budget_items ENABLE ROW LEVEL SECURITY;

-- Policies for Budgets
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view budgets') THEN
        CREATE POLICY "Users can view budgets" ON public.dental_budgets FOR SELECT
        USING (auth.uid() IN (SELECT user_id FROM public.members WHERE tenant_id = dental_budgets.tenant_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert budgets') THEN
        CREATE POLICY "Users can insert budgets" ON public.dental_budgets FOR INSERT
        WITH CHECK (auth.uid() IN (SELECT user_id FROM public.members WHERE tenant_id = dental_budgets.tenant_id));
    END IF;
END $$;

-- Policies for Budget Items
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view budget items') THEN
        CREATE POLICY "Users can view budget items" ON public.dental_budget_items FOR SELECT
        USING (EXISTS (
            SELECT 1 FROM public.dental_budgets 
            WHERE id = dental_budget_items.budget_id 
            AND tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid())
        ));
    END IF;
END $$;
