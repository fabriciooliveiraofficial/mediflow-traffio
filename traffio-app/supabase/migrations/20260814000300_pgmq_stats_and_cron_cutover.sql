-- =============================================================================
-- Migração pgmq — parte 4: stats RPC + cron
-- Data: 2026-08-14
-- =============================================================================

BEGIN;

-- 1. get_automation_hub_stats — mesma forma de retorno, troca só a tabela ------

CREATE OR REPLACE FUNCTION public.get_automation_hub_stats(p_tenant_id uuid)
RETURNS TABLE(category text, sent_count bigint, pending_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.category,
         COUNT(*) FILTER (WHERE q.status = 'sent')    AS sent_count,
         COUNT(*) FILTER (WHERE q.status = 'pending') AS pending_count
  FROM outbound_reminder_registry q
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN q.template_key = 'nps_survey' THEN 'nps'
      WHEN q.template_key IN ('recovery_immediate','recovery_48h','recovery_7d','recall_immediate','recall') THEN 'recovery'
      WHEN q.template_key LIKE 'appointment_reminder%' AND q.media_type = 'video' THEN 'videos'
      WHEN q.template_key LIKE 'appointment_reminder%' THEN 'no_show'
      ELSE NULL
    END AS category
  ) c
  WHERE q.tenant_id = p_tenant_id
    AND c.category IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM public.members m
              WHERE m.user_id = auth.uid() AND m.tenant_id = p_tenant_id)
      OR EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.role = 'super_admin')
    )
  GROUP BY c.category;
$$;

-- 2. Limpeza diária — poda o registro + o arquivo do pgmq -----------------------
-- Mesma condição/janela de hoje (90 dias). unschedule/schedule em vez de
-- CREATE OR REPLACE: cron.schedule já é upsert por nome, mas manter o padrão
-- explícito documentado nas migrações anteriores deste job.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cleanup-outbound-queue-daily';

SELECT cron.schedule(
  'cleanup-outbound-queue-daily',
  '0 2 * * *',
  $$
    DELETE FROM public.outbound_reminder_registry
    WHERE status IN ('sent', 'cancelled', 'failed')
      AND created_at < now() - interval '90 days';

    DELETE FROM pgmq.a_outbound_notifications
    WHERE archived_at < now() - interval '90 days';
  $$
);

-- 3. Remove o cron duplicado (mesma cadência */5, mesma função, dois jobs) -----
-- Achado durante a auditoria desta migração: schedule-reminders-every-5-mins
-- (job criado em 20260701_outbound_fair_claim.sql-era) e
-- schedule-reminders-every-hour (nome desatualizado, cron real também */5,
-- de 20260630_nps_recall_engine.sql) chamam a MESMA função a cada minuto — só
-- dobra a corrida de escrita sem nenhum benefício. Mantém o primeiro
-- (schedule-reminders-every-5-mins, nome correto), remove o segundo.
-- Feito via migration normal (pipeline de deploy), nunca query solta no SQL
-- Editor — respeita o incidente já registrado na memória do projeto sobre
-- alterar pg_cron fora do fluxo de migração.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'schedule-reminders-every-hour';

COMMIT;

SELECT 'Stats RPC migrada + cron de limpeza/duplicidade ajustado.' AS resultado;
