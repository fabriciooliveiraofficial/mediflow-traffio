-- =============================================================================
-- CONFIGURAÇÃO OBRIGATÓRIA — Execute este SQL no Supabase SQL Editor
-- Sem isso, os cron jobs não conseguem autenticar nas Edge Functions
-- =============================================================================

-- PASSO 1: Configurar a URL das Edge Functions
-- (substitua pelo ID do seu projeto se diferente de fyyhxmugxcfqhvoevuwf)
ALTER DATABASE postgres
  SET app.supabase_functions_url = 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1';

-- PASSO 2: Configurar o service role key
-- Obtenha em: https://supabase.com/dashboard/project/fyyhxmugxcfqhvoevuwf/settings/api
-- → seção "Project API Keys" → "service_role" (secret)
-- ⚠️ SUBSTITUA O VALOR ABAIXO PELA SUA CHAVE REAL ANTES DE EXECUTAR
ALTER DATABASE postgres
  SET app.service_role_key = 'COLE_AQUI_SEU_SERVICE_ROLE_KEY';

-- PASSO 3: Verificar se ficou correto
SELECT
  current_setting('app.supabase_functions_url', true) AS functions_url,
  CASE
    WHEN current_setting('app.service_role_key', true) IS NOT NULL
     AND current_setting('app.service_role_key', true) != ''
     AND current_setting('app.service_role_key', true) != 'COLE_AQUI_SEU_SERVICE_ROLE_KEY'
    THEN 'CONFIGURADO ✓'
    ELSE 'FALTANDO ✗ — substitua o valor no PASSO 2'
  END AS service_key_status;

-- PASSO 4: Verificar que os cron jobs existem e estão ativos
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'process-outbound-every-minute',
  'schedule-reminders-every-hour',
  'cleanup-outbound-queue-daily'
)
ORDER BY jobname;

-- PASSO 5: Disparar o process-outbound manualmente agora para testar
-- (envia as mensagens que estão pending na fila imediatamente)
SELECT net.http_post(
  url     := current_setting('app.supabase_functions_url') || '/process-outbound',
  body    := '{}',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || current_setting('app.service_role_key')
  )
);

-- PASSO 6: Verificar resultado após disparo manual (aguarde 5 segundos e execute)
SELECT
  patient_phone,
  template_key,
  status,
  attempts,
  sent_at,
  error_message
FROM outbound_message_queue
WHERE scheduled_at <= now()
ORDER BY created_at DESC
LIMIT 20;
