-- =============================================================================
-- MIGRATION: Cron dos comentários da Página do Facebook
--
-- NOTA: current_setting('app.supabase_functions_url'/'app.service_role_key')
-- NÃO funciona neste projeto — a GUC nunca foi configurada de fato e não há
-- permissão para configurá-la via SQL (ALTER DATABASE dá "permission denied
-- to set parameter"). Ver cron_guc_pattern_broken.md na memória do projeto.
-- Ao aplicar esta migração de verdade, substitua o placeholder abaixo pela
-- service_role_key real (visível em qualquer cron job já funcionando, ex.
-- `SELECT command FROM cron.job WHERE jobname='process-inbox-a'`).
-- =============================================================================

BEGIN;

SELECT cron.unschedule('sync-facebook-comments-1min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='sync-facebook-comments-1min');

SELECT cron.schedule(
  'sync-facebook-comments-1min',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/sync-facebook-comments',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <<<SERVICE_ROLE_KEY_REAL_AQUI>>>'
      )
    );
  $$
);

SELECT cron.unschedule('ai-reply-facebook-comments-1min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='ai-reply-facebook-comments-1min');

SELECT cron.schedule(
  'ai-reply-facebook-comments-1min',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/ai-reply-facebook-comments',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <<<SERVICE_ROLE_KEY_REAL_AQUI>>>'
      ),
      timeout_milliseconds := 30000
    );
  $$
);

COMMIT;
