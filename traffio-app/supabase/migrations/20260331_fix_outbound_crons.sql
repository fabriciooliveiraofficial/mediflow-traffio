-- =============================================================================
-- FIX: Outbound cron jobs were pointing to a wrong Supabase project URL
-- and using a literal placeholder "YOUR_SERVICE_ROLE_KEY" instead of
-- current_setting('app.service_role_key') — causing all automations to fail silently.
-- =============================================================================

-- 1. Remove the broken cron jobs
SELECT cron.unschedule('process-outbound-every-minute')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-outbound-every-minute');

SELECT cron.unschedule('schedule-reminders-every-hour')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'schedule-reminders-every-hour');

SELECT cron.unschedule('cleanup-outbound-queue-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-outbound-queue-daily');

-- 2. Re-schedule using current_setting (same pattern as process-inbox crons)

-- process-outbound: runs every 1 minute to send queued messages
SELECT cron.schedule(
  'process-outbound-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url') || '/process-outbound',
      body    := '{}',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      )
    );
  $$
);

-- schedule-reminders: runs every hour to enqueue appointment reminders, NPS, reactivation
SELECT cron.schedule(
  'schedule-reminders-every-hour',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url') || '/schedule-reminders',
      body    := '{}',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      )
    );
  $$
);

-- cleanup: removes sent/cancelled messages older than 90 days
SELECT cron.schedule(
  'cleanup-outbound-queue-daily',
  '0 2 * * *',
  $$
    DELETE FROM outbound_message_queue
    WHERE status IN ('sent', 'cancelled', 'failed')
      AND created_at < now() - interval '90 days';
  $$
);
