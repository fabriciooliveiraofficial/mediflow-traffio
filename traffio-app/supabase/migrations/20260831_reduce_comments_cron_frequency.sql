-- =============================================================================
-- MIGRATION: Reduz frequência dos crons de comentários (Instagram/Facebook)
-- de 1min para 5min, com offset entre sync e ai-reply.
--
-- CONTEXTO (incidente 2026-08-31): os 4 crons de 1min introduzidos em
-- 20260820140200/20260820150100 escaneiam TODOS os tenant_meta_pages
-- conectados a cada execução (Graph API + round-trip no banco por conta).
-- Rodando a cada 1min isso multiplicou por 5x a carga sobre um compute
-- t4g.nano já saturado pelo mesmo motivo do incidente de 2026-08-13
-- (ver agent_concurrency_ceiling na memória do projeto), derrubando o pool
-- de conexões do Postgres e, com ele, o login (GoTrue roda no mesmo banco).
--
-- Volta para 5min (delay aceito antes de 20/08) cortando a carga em 5x sem
-- remover a funcionalidade. Offsets (0/1/2/3 min dentro da janela de 5min)
-- evitam que as 4 jobs disparem no mesmo instante.
--
-- SEGURANÇA: segue o padrão pós-incidente 2026-07-23 — nunca reescreve a
-- URL/service_role_key na migração. Deriva o `command` de cron.job já
-- existente (que já funciona em produção, seja com a GUC ou hardcoded) e
-- só troca o schedule. Ver cron_guc_pattern_broken.md.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_command text;
BEGIN
  -- sync-instagram-comments: 1min -> */5 (minuto 0,5,10,...)
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'sync-instagram-comments-1min';
  IF v_command IS NOT NULL THEN
    PERFORM cron.unschedule('sync-instagram-comments-1min');
    PERFORM cron.schedule('sync-instagram-comments-5min', '*/5 * * * *', v_command);
  END IF;

  -- ai-reply-instagram-comments: 1min -> 1-59/5 (minuto 1,6,11,... — 1min depois do sync)
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'ai-reply-instagram-comments-1min';
  IF v_command IS NOT NULL THEN
    PERFORM cron.unschedule('ai-reply-instagram-comments-1min');
    PERFORM cron.schedule('ai-reply-instagram-comments-5min', '1-59/5 * * * *', v_command);
  END IF;

  -- sync-facebook-comments: 1min -> 2-59/5 (minuto 2,7,12,...)
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'sync-facebook-comments-1min';
  IF v_command IS NOT NULL THEN
    PERFORM cron.unschedule('sync-facebook-comments-1min');
    PERFORM cron.schedule('sync-facebook-comments-5min', '2-59/5 * * * *', v_command);
  END IF;

  -- ai-reply-facebook-comments: 1min -> 3-59/5 (minuto 3,8,13,... — 1min depois do sync)
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'ai-reply-facebook-comments-1min';
  IF v_command IS NOT NULL THEN
    PERFORM cron.unschedule('ai-reply-facebook-comments-1min');
    PERFORM cron.schedule('ai-reply-facebook-comments-5min', '3-59/5 * * * *', v_command);
  END IF;
END $$;

COMMIT;
