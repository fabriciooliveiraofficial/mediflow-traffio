-- =============================================================================
-- TRAFFIO MEDICAL - Advisory Lock RPCs + process-inbox Cron
-- =============================================================================

-- 1. Wrapper RPC: pg_try_advisory_lock
CREATE OR REPLACE FUNCTION pg_try_advisory_lock(key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT pg_try_advisory_lock(key);
$$;

-- 2. Wrapper RPC: pg_advisory_unlock
CREATE OR REPLACE FUNCTION pg_advisory_unlock(key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT pg_advisory_unlock(key);
$$;

GRANT EXECUTE ON FUNCTION pg_try_advisory_lock(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION pg_advisory_unlock(bigint) TO service_role;

-- =============================================================================
-- 3. Schedule process-inbox cron jobs
-- pg_cron minimum = 1 minute. We schedule 3 staggered jobs to get ~20s polling.
-- Pattern identical to process-outbox-job (uses current_setting, not vault).
-- =============================================================================

SELECT cron.unschedule('process-inbox-a') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-inbox-a');
SELECT cron.unschedule('process-inbox-b') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-inbox-b');
SELECT cron.unschedule('process-inbox-c') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-inbox-c');

SELECT cron.schedule(
  'process-inbox-a',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url') || '/process-inbox',
      body    := '{}',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      )
    );
  $$
);

SELECT cron.schedule(
  'process-inbox-b',
  '* * * * *',
  $$
    SELECT pg_sleep(20);
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url') || '/process-inbox',
      body    := '{}',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      )
    );
  $$
);

SELECT cron.schedule(
  'process-inbox-c',
  '* * * * *',
  $$
    SELECT pg_sleep(40);
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url') || '/process-inbox',
      body    := '{}',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      )
    );
  $$
);

-- =============================================================================
-- 4. Cleanup cron: remove processed messages older than 24h
-- =============================================================================
SELECT cron.unschedule('cleanup-message-inbox') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-message-inbox');

SELECT cron.schedule(
  'cleanup-message-inbox',
  '0 3 * * *',
  $$ SELECT cleanup_message_inbox(); $$
);
