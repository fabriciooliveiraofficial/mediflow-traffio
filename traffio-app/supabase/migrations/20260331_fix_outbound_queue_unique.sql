-- =============================================================================
-- FIX: outbound_message_queue unique index was partial (WHERE status != 'cancelled')
-- PostgreSQL does NOT allow partial indexes as ON CONFLICT targets.
-- All upserts were silently failing with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Additionally, the old constraint was on (tenant_id, patient_phone, message_type, reference_id)
-- but message_type = 'follow_up' for ALL follow-up steps — so follow_up_1 through follow_up_5
-- shared the same conflict key and only one would ever be inserted per session.
--
-- Fix: drop the broken partial index, create a non-partial unique index on
-- (tenant_id, patient_phone, template_key, reference_id) — template_key properly
-- distinguishes follow_up_1, follow_up_2, appointment_reminder_48h, nps_survey, etc.
-- =============================================================================

-- 1. Drop the broken partial index
DROP INDEX IF EXISTS idx_outbound_queue_unique_msg;

-- 2. Create a proper non-partial unique constraint that:
--    - Distinguishes each step in the follow-up sequence (follow_up_1 vs follow_up_2)
--    - Distinguishes each reminder type per appointment (48h vs 2h vs nps)
--    - Prevents the same template being sent twice for the same event/session
CREATE UNIQUE INDEX idx_outbound_queue_unique_msg
ON public.outbound_message_queue (tenant_id, patient_phone, template_key, reference_id);

-- 3. Also fix the cron jobs while we're here (same migration for convenience)
-- Remove broken cron jobs with hardcoded URL and placeholder auth
SELECT cron.unschedule('process-outbound-every-minute')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-outbound-every-minute');

SELECT cron.unschedule('schedule-reminders-every-hour')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'schedule-reminders-every-hour');

SELECT cron.unschedule('cleanup-outbound-queue-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-outbound-queue-daily');

-- Re-schedule using current_setting (same pattern as process-inbox crons)
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

SELECT cron.schedule(
  'cleanup-outbound-queue-daily',
  '0 2 * * *',
  $$
    DELETE FROM outbound_message_queue
    WHERE status IN ('sent', 'cancelled', 'failed')
      AND created_at < now() - interval '90 days';
  $$
);
