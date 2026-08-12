-- =============================================================================
-- MIGRATION: Database Performance Optimization & Resource Leak Fix
-- Target: Supabase PostgreSQL (Fixing 75% RAM & 48% CPU on test instance)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. REMOVE BLOCKING PG_SLEEP CRON JOBS
-- pg_sleep(20) and pg_sleep(40) hold active DB worker backends open 24/7,
-- starving CPU threads and connection slots.
-- -----------------------------------------------------------------------------
SELECT cron.unschedule('process-inbox-b') 
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-inbox-b');

SELECT cron.unschedule('process-inbox-c') 
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-inbox-c');

-- Ensure process-inbox-a runs cleanly without sleep blocking
SELECT cron.unschedule('process-inbox-a') 
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-inbox-a');

SELECT cron.schedule(
  'process-inbox-a',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url', true) || '/process-inbox',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      )
    );
  $$
);

-- -----------------------------------------------------------------------------
-- 2. PG_NET LOG MAINTENANCE
-- Clean up accumulated pg_net responses to free up WAL & memory buffer bloat.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'net' AND tablename = '_http_response') THEN
    DELETE FROM net._http_response WHERE created < now() - interval '1 day';
  END IF;
END $$;

-- Schedule daily net response cleanup
SELECT cron.unschedule('cleanup-pg-net-responses') 
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-pg-net-responses');

SELECT cron.schedule(
  'cleanup-pg-net-responses',
  '0 4 * * *',
  $$
    DELETE FROM net._http_response WHERE created < now() - interval '1 day';
  $$
);

-- -----------------------------------------------------------------------------
-- 3. HIGH-PERFORMANCE COMPOUND INDEXES
-- Eliminate Sequential Scans (Seq Scans) and memory sorting on rapid queries.
-- -----------------------------------------------------------------------------

-- Index for conversation messages (5s polling & inbox rendering)
CREATE INDEX IF NOT EXISTS idx_messages_session_created_asc 
  ON public.conversation_messages (session_id, created_at ASC);

-- Index for patient appointment lookups
CREATE INDEX IF NOT EXISTS idx_appointments_patient_tenant_date 
  ON public.appointments (tenant_id, patient_id, status, date ASC);

-- Index for outbound message queue claiming
CREATE INDEX IF NOT EXISTS idx_outbound_queue_pending_v2 
  ON public.outbound_message_queue (scheduled_at, attempts) 
  WHERE status = 'pending';

-- Index for CRM SLA sweeps
CREATE INDEX IF NOT EXISTS idx_crm_journeys_sla_sweep 
  ON public.crm_journeys (stage_id, next_action_at) 
  WHERE stage_id NOT IN ('won', 'lost');

-- Index for active sessions heartbeat lookup
CREATE INDEX IF NOT EXISTS idx_active_sessions_lookup 
  ON public.active_sessions (user_id, is_current);

-- -----------------------------------------------------------------------------
-- 4. VACUUM AND ANALYZE KEY TABLES
-- Update statistics for planner optimization and reclaim dead tuple space.
-- -----------------------------------------------------------------------------
ANALYZE public.conversation_messages;
ANALYZE public.conversation_sessions;
ANALYZE public.outbound_message_queue;
ANALYZE public.appointments;
ANALYZE public.crm_journeys;
ANALYZE public.patients;

COMMIT;
