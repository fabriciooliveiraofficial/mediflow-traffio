-- =============================================================================
-- MIGRATION: Reduz o delay de comentários do Instagram (feedback de usuário:
-- 5min + precisar clicar "Sincronizar agora" não é aceitável). Alinha com a
-- cadência de 1min já usada por process-inbox-a para o resto do Inbox.
-- =============================================================================

BEGIN;

SELECT cron.unschedule('sync-instagram-comments-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-instagram-comments-5min');

SELECT cron.schedule(
  'sync-instagram-comments-1min',
  '* * * * *',
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

SELECT cron.unschedule('ai-reply-instagram-comments-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-reply-instagram-comments-5min');

SELECT cron.schedule(
  'ai-reply-instagram-comments-1min',
  '* * * * *',
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
