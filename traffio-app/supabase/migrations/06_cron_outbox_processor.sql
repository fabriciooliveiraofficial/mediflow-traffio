-- =============================================================================
-- MIGRAÇÃO 06: pg_cron — Processador automático do Message Outbox
--
-- Configura um job pg_cron que chama a Edge Function process-outbox a cada 30s.
-- Isso garante que mensagens enfileiradas na message_outbox sejam entregues
-- via Z-API mesmo se o envio inicial falhou (fallback com retry).
--
-- PRÉ-REQUISITO: Supabase Pro+ (pg_cron está habilitado por padrão no hosted).
-- Para ativar localmente: adicionar 'pg_cron' em supabase/config.toml [db.extensions]
-- =============================================================================

-- Habilitar extensão pg_cron (idempotente)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Garantir que o schema net (http) está disponível para chamar Edge Functions
CREATE EXTENSION IF NOT EXISTS http;

-- Remover job anterior se existir (idempotente para re-execuções da migration)
SELECT cron.unschedule('process-outbox-job')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-outbox-job'
);

-- Criar job: a cada 30 segundos, chama a Edge Function process-outbox via HTTP
-- NOTA: substituir 'YOUR_PROJECT_REF' pelo project ref real do Supabase
--       ou usar a variável de ambiente SUPABASE_URL via pg_net.
--
-- Formato cron: "*/1 * * * *" = a cada 1 minuto (mínimo pg_cron)
-- Para sub-minuto, usar 2 jobs com delay:
SELECT cron.schedule(
  'process-outbox-job-00',    -- job name
  '* * * * *',                -- a cada 1 minuto (slot :00)
  $$
    SELECT net.http_post(
      url    := current_setting('app.supabase_functions_url') || '/process-outbox',
      body   := '{}',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      )
    );
  $$
);

SELECT cron.schedule(
  'process-outbox-job-30',    -- segundo job com delay de 30s no slot :30
  '* * * * *',
  $$
    SELECT pg_sleep(30);
    SELECT net.http_post(
      url    := current_setting('app.supabase_functions_url') || '/process-outbox',
      body   := '{}',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      )
    );
  $$
);

-- =============================================================================
-- Configurar as variáveis de app (executar separadamente com seus valores reais):
--
--   ALTER DATABASE postgres SET app.supabase_functions_url = 'https://SEU_PROJECT_REF.supabase.co/functions/v1';
--   ALTER DATABASE postgres SET app.service_role_key = 'SEU_SERVICE_ROLE_KEY';
--
-- Ou via Supabase Dashboard → Settings → Database → Configuration
-- =============================================================================

-- Limpeza de webhooks processados com mais de 24h (evita crescimento ilimitado da tabela)
SELECT cron.schedule(
  'cleanup-processed-webhooks',
  '0 3 * * *',  -- diariamente às 03:00
  $$
    DELETE FROM processed_webhooks
    WHERE processed_at < now() - interval '24 hours';
  $$
);

-- Limpeza de sessões inativas por mais de 2 horas (Cleanup de memória)
SELECT cron.schedule(
  'cleanup-stale-sessions',
  '0 * * * *',  -- a cada hora (no minuto 0)
  $$
    UPDATE conversation_sessions SET
      recent_messages = '[]'::jsonb,
      context = '{}'::jsonb,
      current_state = 'INIT'
    WHERE updated_at < now() - interval '2 hours'
      AND (recent_messages != '[]'::jsonb OR context != '{}'::jsonb);
  $$
);
