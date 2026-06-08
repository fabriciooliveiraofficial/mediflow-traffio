-- Create table if not exists
CREATE TABLE IF NOT EXISTS public.sales_scripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    shortcut TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    icon TEXT,
    attachments JSONB DEFAULT '[]'::jsonb,
    variables JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure columns exist (for existing tables)
ALTER TABLE public.sales_scripts ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE public.sales_scripts ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.sales_scripts ADD COLUMN IF NOT EXISTS variables JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.sales_scripts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.sales_scripts ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE public.sales_scripts ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.sales_scripts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Enable RLS
ALTER TABLE public.sales_scripts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view tenant sales scripts" ON public.sales_scripts;
DROP POLICY IF EXISTS "Users can insert tenant sales scripts" ON public.sales_scripts;
DROP POLICY IF EXISTS "Users can update tenant sales scripts" ON public.sales_scripts;
DROP POLICY IF EXISTS "Users can delete tenant sales scripts" ON public.sales_scripts;

-- Create Policies
CREATE POLICY "Users can view tenant sales scripts" ON public.sales_scripts
    FOR SELECT
    USING (
        tenant_id IS NULL OR 
        tenant_id IN (
            SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert tenant sales scripts" ON public.sales_scripts
    FOR INSERT
    WITH CHECK (
        tenant_id IN (
            SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update tenant sales scripts" ON public.sales_scripts
    FOR UPDATE
    USING (
        tenant_id IN (
            SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete tenant sales scripts" ON public.sales_scripts
    FOR DELETE
    USING (
        tenant_id IN (
            SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
        )
    );

-- Create Indexes
CREATE INDEX IF NOT EXISTS idx_sales_scripts_tenant_id ON public.sales_scripts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_scripts_shortcut ON public.sales_scripts(shortcut);

-- Update trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sales_scripts_updated_at ON public.sales_scripts;
CREATE TRIGGER trigger_sales_scripts_updated_at
    BEFORE UPDATE ON public.sales_scripts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
