-- Create short_links table
CREATE TABLE IF NOT EXISTS public.short_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    clicks INTEGER DEFAULT 0 NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Anyone can view short links" ON public.short_links;
DROP POLICY IF EXISTS "Users can insert tenant short links" ON public.short_links;
DROP POLICY IF EXISTS "Users can update tenant short links" ON public.short_links;
DROP POLICY IF EXISTS "Users can delete tenant short links" ON public.short_links;

-- Create Policies
-- Select policy: public access so external users clicking the links can resolve them
CREATE POLICY "Anyone can view short links" ON public.short_links
    FOR SELECT
    USING (true);

-- Insert/Update/Delete policies: only tenant members
CREATE POLICY "Users can insert tenant short links" ON public.short_links
    FOR INSERT
    WITH CHECK (
        tenant_id IN (
            SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update tenant short links" ON public.short_links
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

CREATE POLICY "Users can delete tenant short links" ON public.short_links
    FOR DELETE
    USING (
        tenant_id IN (
            SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
        )
    );

-- Create index for quick lookups by code
CREATE INDEX IF NOT EXISTS idx_short_links_code ON public.short_links(code);

-- Update trigger
DROP TRIGGER IF EXISTS trigger_short_links_updated_at ON public.short_links;
CREATE TRIGGER trigger_short_links_updated_at
    BEFORE UPDATE ON public.short_links
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
