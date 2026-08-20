-- =============================================================================
-- MIGRATION: Instagram Comments Polling Cron (fallback do webhook bloqueado)
--
-- A Meta bloqueia a assinatura em tempo real do campo "comments" (erro #3,
-- capability não liberada — provavelmente ligado a instagram_manage_comments
-- ainda não ter Advanced Access aprovado). A leitura via Graph API funciona
-- normalmente, então este cron faz polling das últimas mídias de cada conta
-- conectada, a cada 5 minutos, como fallback até o webhook ser liberado.
-- =============================================================================

BEGIN;

SELECT cron.unschedule('sync-instagram-comments-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-instagram-comments-5min');

SELECT cron.schedule(
  'sync-instagram-comments-5min',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url', true) || '/sync-instagram-comments',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      )
    );
  $$
);

COMMIT;
