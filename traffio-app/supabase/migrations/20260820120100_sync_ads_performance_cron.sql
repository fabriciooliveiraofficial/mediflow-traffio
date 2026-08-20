-- =============================================================================
-- MIGRATION: Automated Ads Performance Sync (Marketing API Access Tier)
--
-- A Meta rejeitou o pedido de "Marketing API Access Tier" no App Review porque
-- não havia volume suficiente de chamadas à Ads API nos últimos 15 dias — a
-- sincronização (sync-ads-performance) só era disparada manualmente (botão
-- "Sincronizar agora") ou ao conectar uma conta nova, nunca em background.
--
-- Segue o padrão seguro pós-incidente 20260331 (nunca cron.schedule solto no
-- SQL Editor, sempre via migração versionada; current_setting(..., true) para
-- nunca lançar exceção se a GUC de URL/service key ainda não estiver setada).
-- =============================================================================

BEGIN;

SELECT cron.unschedule('sync-ads-performance-hourly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-ads-performance-hourly');

SELECT cron.schedule(
  'sync-ads-performance-hourly',
  '15 * * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url', true) || '/sync-ads-performance',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      )
    );
  $$
);

COMMIT;
