-- =============================================================================
-- NPS + Recall Engine — Migration canônica
-- Data: 2026-06-30
--
-- O que esta migration faz:
--   1. Remove TODOS os cron jobs legados com URL/key errados
--   2. Recria os 4 cron jobs com a URL correta do projeto fyyhxmugxcfqhvoevuwf
--   3. Adiciona coluna completed_at em appointments
--   4. Cria a função + trigger enqueue_nps_on_completion (event-driven)
--
-- ⚠️  ANTES DE RODAR: substitua <<<SEU_SERVICE_ROLE_KEY>>> pela chave real.
--    Encontre em: Supabase Dashboard → Settings → API → service_role (começa com eyJ...)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCO 1 — Reconciliação de Cron Jobs
-- ─────────────────────────────────────────────────────────────────────────────

-- Remove TODOS os jobs existentes (safe — não falha se não existir)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN (
  'process-outbound-every-minute',
  'schedule-reminders-every-hour',
  'check-recall-daily',
  'cleanup-outbound-queue-daily'
);

-- process-outbound: a cada 1 minuto (envia mensagens da fila)
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

-- schedule-reminders: a cada hora (agenda lembretes + NPS backfill)
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

-- check-recall: todo dia às 9h UTC (6h Brasília — antes do horário comercial)
SELECT cron.schedule(
  'check-recall-daily',
  '0 9 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/check-recall',
      body    := '{}',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer <<<SEU_SERVICE_ROLE_KEY>>>"}'::jsonb
    );
  $$
);

-- cleanup: todo dia às 2h UTC (remove mensagens antigas)
SELECT cron.schedule(
  'cleanup-outbound-queue-daily',
  '0 2 * * *',
  $$
    DELETE FROM outbound_message_queue
    WHERE status IN ('sent', 'cancelled', 'failed')
      AND created_at < now() - interval '90 days';
  $$
);

-- Verificação: deve retornar 4 jobs com active = true
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'process-outbound-every-minute',
  'schedule-reminders-every-hour',
  'check-recall-daily',
  'cleanup-outbound-queue-daily'
)
ORDER BY jobname;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCO 2 — completed_at em appointments
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Índice para o backfill do schedule-reminders
CREATE INDEX IF NOT EXISTS idx_appointments_completed_at
  ON public.appointments (tenant_id, completed_at)
  WHERE completed_at IS NOT NULL;

-- Backfill histórico: usa updated_at como proxy para completed_at
UPDATE public.appointments
SET    completed_at = COALESCE(updated_at, created_at)
WHERE  status       = 'completed'
  AND  completed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCO 3 — Função enqueue_nps_on_completion
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enqueue_nps_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bot_config     jsonb;
  v_tenant_name    text;
  v_tenant_tz      text;
  v_nps_channels   jsonb;
  v_delay_minutes  int;
  v_patient_phone  text;
  v_patient_name   text;
  v_patient_locale text;
  v_scheduled_at   timestamptz;
  v_local_hour     int;
  v_channel        text;
BEGIN
  -- Dispara apenas na transição PARA 'completed' (não em re-saves)
  IF NEW.status != 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  -- Registra o timestamp de conclusão
  UPDATE public.appointments
  SET    completed_at = NOW()
  WHERE  id           = NEW.id
    AND  completed_at IS NULL;

  -- Carrega configuração do tenant
  SELECT
    COALESCE(bot_config, '{}'::jsonb),
    COALESCE(name, 'Clínica'),
    COALESCE(timezone, 'America/Sao_Paulo')
  INTO v_bot_config, v_tenant_name, v_tenant_tz
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  -- Verifica se NPS está habilitado em algum canal
  v_nps_channels := v_bot_config -> 'channel_automations';
  IF v_nps_channels IS NULL THEN RETURN NEW; END IF;

  IF NOT (
    COALESCE((v_nps_channels -> 'whatsapp' ->> 'nps')::boolean, false) OR
    COALESCE((v_nps_channels -> 'sms'      ->> 'nps')::boolean, false) OR
    COALESCE((v_nps_channels -> 'email'    ->> 'nps')::boolean, false)
  ) THEN
    RETURN NEW;
  END IF;

  -- Carrega dados do paciente
  SELECT phone, full_name, COALESCE(preferred_locale, 'pt')
  INTO   v_patient_phone, v_patient_name, v_patient_locale
  FROM   public.patients
  WHERE  id = NEW.patient_id;

  IF v_patient_phone IS NULL THEN RETURN NEW; END IF;

  -- Calcula scheduled_at com quiet hours (8h–22h no timezone do tenant)
  v_delay_minutes := COALESCE((v_bot_config ->> 'nps_delay_minutes')::int, 180);
  v_scheduled_at  := NOW() + make_interval(mins => v_delay_minutes);

  v_local_hour := EXTRACT(HOUR FROM (v_scheduled_at AT TIME ZONE v_tenant_tz))::int;
  IF v_local_hour >= 22 THEN
    -- Empurra para as 8h do dia seguinte (no timezone do tenant → UTC)
    v_scheduled_at := (
      date_trunc('day', v_scheduled_at AT TIME ZONE v_tenant_tz)
      + interval '1 day'
      + interval '8 hours'
    ) AT TIME ZONE v_tenant_tz;
  ELSIF v_local_hour < 8 THEN
    v_scheduled_at := (
      date_trunc('day', v_scheduled_at AT TIME ZONE v_tenant_tz)
      + interval '8 hours'
    ) AT TIME ZONE v_tenant_tz;
  END IF;

  -- Determina canal preferido do paciente (fallback: whatsapp)
  SELECT COALESCE(preferred_channel, 'whatsapp')
  INTO   v_channel
  FROM   public.patient_channel_preferences
  WHERE  patient_phone = v_patient_phone
  LIMIT  1;

  v_channel := COALESCE(v_channel, 'whatsapp');

  -- Se o canal preferido não tiver NPS habilitado, usa whatsapp
  IF NOT COALESCE((v_nps_channels -> v_channel ->> 'nps')::boolean, false) THEN
    v_channel := 'whatsapp';
  END IF;

  -- Enfileira NPS — idempotente via unique index (template_key, reference_id)
  INSERT INTO public.outbound_message_queue (
    tenant_id,
    patient_phone,
    message_type,
    template_key,
    template_vars,
    scheduled_at,
    reference_id,
    reference_type,
    status,
    notification_channel,
    channel_recipient_id,
    is_edited
  ) VALUES (
    NEW.tenant_id,
    v_patient_phone,
    'nps_survey',
    'nps_survey',
    jsonb_build_object(
      'patient_name', v_patient_name,
      'clinic_name',  v_tenant_name,
      'locale',       v_patient_locale
    ),
    v_scheduled_at,
    NEW.id,
    'appointment',
    'pending',
    v_channel,
    v_patient_phone,
    false
  )
  ON CONFLICT (tenant_id, patient_phone, template_key, reference_id)
  DO NOTHING;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    -- NUNCA bloqueia a atualização de status por falha na fila
    RAISE WARNING '[enqueue_nps_on_completion] Appt %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCO 4 — Instalar Trigger
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS tr_enqueue_nps_on_completion ON public.appointments;

CREATE TRIGGER tr_enqueue_nps_on_completion
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_nps_on_completion();

-- Confirmação final
SELECT 'Migration 20260630_nps_recall_engine aplicada com sucesso.' AS resultado;
