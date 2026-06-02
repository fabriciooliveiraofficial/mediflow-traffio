-- FASE 3.3 — Ativação dos Cron Jobs
-- Objetivo: Garantir que os workers rodem de forma autônoma em segundo plano.

-- 1. Processador de Fila de Saída (Outbound) - Roda a cada 1 minuto
SELECT cron.schedule(
  'process-outbound-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vdrfgtasbqqfzhvghrzo.supabase.co/functions/v1/process-outbound',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- 2. Agendador de Lembretes e NPS - Roda a cada 1 hora
SELECT cron.schedule(
  'schedule-reminders-every-hour',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vdrfgtasbqqfzhvghrzo.supabase.co/functions/v1/schedule-reminders',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- 3. Limpeza Automática da Fila - Roda todo dia à meia-noite
SELECT cron.schedule(
  'cleanup-outbound-queue-daily',
  '0 0 * * *',
  $$
  SELECT public.cleanup_outbound_queue();
  $$
);
