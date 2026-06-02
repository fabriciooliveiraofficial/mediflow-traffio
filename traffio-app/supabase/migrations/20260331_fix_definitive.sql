-- =============================================================================
-- FIX DEFINITIVO — Execute este SQL no lugar dos anteriores
-- =============================================================================

-- PASSO 1: Limpar duplicatas — manter apenas a linha mais recente por chave
DELETE FROM outbound_message_queue
WHERE id NOT IN (
  SELECT DISTINCT ON (tenant_id, patient_phone, template_key, reference_id)
    id
  FROM outbound_message_queue
  ORDER BY tenant_id, patient_phone, template_key, reference_id, created_at DESC
);

-- PASSO 2: Criar índice único parcial (só bloqueia pending/processing/sent)
DROP INDEX IF EXISTS idx_outbound_queue_unique_msg;

CREATE UNIQUE INDEX idx_outbound_queue_unique_msg
ON public.outbound_message_queue (tenant_id, patient_phone, template_key, reference_id)
WHERE status IN ('pending', 'processing', 'sent');

-- PASSO 3: Verificar se as configurações de URL estão definidas
SELECT
  current_setting('app.supabase_functions_url', true) AS functions_url,
  CASE
    WHEN current_setting('app.service_role_key', true) IS NOT NULL
     AND current_setting('app.service_role_key', true) != ''
    THEN 'CONFIGURADO ✓'
    ELSE 'FALTANDO ✗'
  END AS service_key_status;

-- PASSO 4: Ver estado atual dos cron jobs
SELECT jobid, jobname, schedule, active
FROM cron.job
ORDER BY jobname;

-- PASSO 5: Ver últimas execuções dos crons (diagnóstico)
SELECT
  j.jobname,
  d.start_time,
  d.return_message,
  d.status
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname IN ('process-outbound-every-minute', 'schedule-reminders-every-hour')
ORDER BY d.start_time DESC
LIMIT 10;

-- PASSO 6: Ver o que está na fila agora
SELECT
  patient_phone,
  template_key,
  status,
  scheduled_at,
  attempts,
  error_message,
  created_at
FROM outbound_message_queue
ORDER BY created_at DESC
LIMIT 20;
