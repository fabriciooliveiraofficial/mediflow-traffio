-- =============================================================================
-- MIGRATION: Cron da resposta automática por IA a comentários do Instagram
--
-- Roda a cada 5 minutos, defasado 2min do sync-instagram-comments-5min, para
-- garantir que os comentários mais recentes já estejam na tabela antes da IA
-- tentar responder. Opt-in por tenant (ver ai-reply-instagram-comments).
-- =============================================================================

BEGIN;

SELECT cron.unschedule('ai-reply-instagram-comments-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-reply-instagram-comments-5min');

SELECT cron.schedule(
  'ai-reply-instagram-comments-5min',
  '2-59/5 * * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url', true) || '/ai-reply-instagram-comments',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      )
    );
  $$
);

COMMIT;
