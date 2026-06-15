-- Migration: Campaign-level breakdown for ad_performance_daily
-- ad_performance_daily está vazia em produção (confirmado via diagnóstico) — alteração aditiva, sem dados a migrar.

ALTER TABLE public.ad_performance_daily
  ADD COLUMN IF NOT EXISTS ad_account_id TEXT,
  ADD COLUMN IF NOT EXISTS campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS campaign_name TEXT;

-- Substitui a UNIQUE (tenant_id, platform, date) por (tenant_id, platform, date, campaign_id)
-- para permitir múltiplas campanhas por dia/plataforma.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'ad_performance_daily'
    AND tc.constraint_type = 'UNIQUE'
  GROUP BY tc.constraint_name
  HAVING array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) = ARRAY['tenant_id','platform','date'];

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ad_performance_daily DROP CONSTRAINT %I', cname);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'ad_performance_daily'
      AND constraint_name = 'ad_performance_daily_tenant_platform_date_campaign_key'
  ) THEN
    ALTER TABLE public.ad_performance_daily
      ADD CONSTRAINT ad_performance_daily_tenant_platform_date_campaign_key
      UNIQUE (tenant_id, platform, date, campaign_id);
  END IF;
END $$;
