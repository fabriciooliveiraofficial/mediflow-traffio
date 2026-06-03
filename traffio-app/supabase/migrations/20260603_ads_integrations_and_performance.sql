-- Migration: Ads Integrations and Performance Tracking

CREATE TABLE IF NOT EXISTS public.ad_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('meta', 'google')),
    access_token TEXT,
    refresh_token TEXT,
    settings JSONB DEFAULT '{}'::jsonB,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (tenant_id, platform)
);

CREATE TABLE IF NOT EXISTS public.ad_performance_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('meta', 'google')),
    ad_account_id TEXT,
    campaign_id TEXT,
    campaign_name TEXT,
    date DATE NOT NULL,
    spend_cents BIGINT NOT NULL DEFAULT 0,
    revenue_cents BIGINT NOT NULL DEFAULT 0,
    leads_count INTEGER NOT NULL DEFAULT 0,
    conversion_count INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (tenant_id, platform, date, campaign_id)
);

-- Enable Row Level Security
ALTER TABLE public.ad_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_performance_daily ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ad_integrations
CREATE POLICY "Members can view tenant integrations" ON public.ad_integrations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = ad_integrations.tenant_id
            AND members.user_id = auth.uid()
        )
    );

CREATE POLICY "Members can manage tenant integrations" ON public.ad_integrations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = ad_integrations.tenant_id
            AND members.user_id = auth.uid()
        )
    );

CREATE POLICY "Service role full access to ad_integrations" ON public.ad_integrations
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS Policies for ad_performance_daily
CREATE POLICY "Members can view tenant ad performance" ON public.ad_performance_daily
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = ad_performance_daily.tenant_id
            AND members.user_id = auth.uid()
        )
    );

CREATE POLICY "Service role full access to ad_performance_daily" ON public.ad_performance_daily
    FOR ALL TO service_role USING (true) WITH CHECK (true);
