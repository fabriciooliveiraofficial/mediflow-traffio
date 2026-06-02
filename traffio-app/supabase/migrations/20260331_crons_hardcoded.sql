-- =============================================================================
-- CRON JOBS — URL e key embutidos diretamente (sem current_setting)
-- Supabase SQL Editor não tem permissão para ALTER DATABASE
-- =============================================================================

-- PASSO 1: Substituir <<<SEU_SERVICE_ROLE_KEY>>> pela chave real
-- Obtenha em: Settings → API → "service_role" (começa com eyJ...)
-- A URL já está correta para o projeto fyyhxmugxcfqhvoevuwf

-- Remove os cron jobs existentes (se houver)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN (
  'process-outbound-every-minute',
  'schedule-reminders-every-hour',
  'cleanup-outbound-queue-daily'
);

-- process-outbound: a cada 1 minuto
SELECT cron.schedule(
  'process-outbound-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/process-outbound',
      body    := '{}',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer <<<SEU_SERVICE_ROLE_KEY>>>"}'::jsonb
    );
  $$
);

-- schedule-reminders: a cada hora
SELECT cron.schedule(
  'schedule-reminders-every-hour',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/schedule-reminders',
      body    := '{}',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer <<<SEU_SERVICE_ROLE_KEY>>>"}'::jsonb
    );
  $$
);

-- cleanup: todo dia às 2h da manhã
SELECT cron.schedule(
  'cleanup-outbound-queue-daily',
  '0 2 * * *',
  $$
    DELETE FROM outbound_message_queue
    WHERE status IN ('sent', 'cancelled', 'failed')
      AND created_at < now() - interval '90 days';
  $$
);

-- PASSO 2: Verificar que foram criados
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'process-outbound-every-minute',
  'schedule-reminders-every-hour',
  'cleanup-outbound-queue-daily'
)
ORDER BY jobname;

-- PASSO 3: Disparar process-outbound manualmente agora para testar
-- (substitua <<<SEU_SERVICE_ROLE_KEY>>> aqui também)
SELECT net.http_post(
  url     := 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/process-outbound',
  body    := '{}',
  headers := '{"Content-Type":"application/json","Authorization":"Bearer <<<SEU_SERVICE_ROLE_KEY>>>"}'::jsonb
);
