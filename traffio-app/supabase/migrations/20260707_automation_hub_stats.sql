-- =============================================================================
-- MIGRAÇÃO: RPC de estatísticas do Automation Hub (página Inteligência)
-- Totais de mensagens Enviadas × Pendentes por categoria de automação:
--   no_show  → Prevenção de No-Show (lembretes de agendamento sem vídeo)
--   videos   → Vídeos de Confirmação (lembretes com media_type = 'video')
--   nps      → Pesquisa NPS
--   recovery → Recuperação de Faltas (cadência D0/D2/D7 + recall)
-- data: 2026-07-07
-- =============================================================================

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
  FROM outbound_message_queue q
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

GRANT EXECUTE ON FUNCTION public.get_automation_hub_stats(uuid) TO authenticated;
