-- =============================================================================
-- DIAGNÓSTICO COMPLETO — Execute no Supabase SQL Editor e cole o resultado
-- =============================================================================

-- 1. O que está na fila de automações? (todos os status)
SELECT
  id,
  patient_phone,
  message_type,
  template_key,
  status,
  scheduled_at,
  sent_at,
  attempts,
  error_message,
  created_at
FROM outbound_message_queue
ORDER BY created_at DESC
LIMIT 30;

-- 2. Os cron jobs existem e estão ativos?
SELECT jobid, jobname, schedule, active, command
FROM cron.job
ORDER BY jobname;

-- 3. Os cron jobs esteram rodando? (últimas execuções)
SELECT
  j.jobname,
  d.start_time,
  d.end_time,
  d.return_message,
  d.status
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
ORDER BY d.start_time DESC
LIMIT 20;

-- 4. As configurações de URL e service key estão definidas?
SELECT current_setting('app.supabase_functions_url', true) AS functions_url,
       CASE WHEN current_setting('app.service_role_key', true) IS NOT NULL
            AND current_setting('app.service_role_key', true) != ''
            THEN 'SET ✓'
            ELSE 'MISSING ✗'
       END AS service_key_status;

-- 5. O índice atual na tabela (partial ou não?)
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'outbound_message_queue';
