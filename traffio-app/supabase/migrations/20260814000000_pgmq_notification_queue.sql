-- =============================================================================
-- Migração da fila de notificações para pgmq (fila nativa do Postgres)
-- Data: 2026-08-14
--
-- Contexto: outbound_message_queue (tabela + pg_cron + SQL de limpeza escrito
-- à mão) sofreu 3 incidentes reais na mesma sessão de debugging: um DELETE sem
-- filtro que apagava lembretes vencendo no exato minuto do envio, uma janela
-- de silêncio fixa que ignorava a configuração do tenant, e um guard sem
-- tolerância que descartava lembretes por uma corrida de milissegundos.
-- Decisão do usuário: mover a MECÂNICA de entrega (claim, retry, reaper,
-- visibilidade) para pgmq — testado pelo mercado — e manter uma tabela
-- pequena (`outbound_reminder_registry`) só para o ESTADO DE NEGÓCIO que o
-- frontend já lê/edita hoje (status, template_vars, timeline, métricas).
--
-- pgmq cuida de: claim atômico (visibility timeout), reaper automático (uma
-- mensagem não confirmada reaparece sozinha, sem UPDATE de reaper escrito à
-- mão), histórico de envio (pgmq.archive, com archived_at).
--
-- outbound_reminder_registry cuida de: dedup (mesmo índice único de hoje),
-- status visível ao usuário, template_vars editável, e o mapeamento
-- registry.id -> queue_msg_id (necessário para cancelar/reenviar uma
-- mensagem específica via pgmq.delete()/pgmq.set_vt(), nunca um DELETE de
-- tabela inteira).
-- =============================================================================

BEGIN;

-- 1. Extensão + fila -----------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgmq;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'pgmq' AND tablename = 'q_outbound_notifications'
  ) THEN
    PERFORM pgmq.create('outbound_notifications');
  END IF;
END $$;

-- 2. Tabela de registro (estado de negócio) -------------------------------------
-- Espelha as colunas de outbound_message_queue que o frontend já lê hoje
-- (useOutboundQueue, useAutomacaoMetrics, usePatientAutomationJourney,
-- usePatientFunnel, NotificationsPage) — a migração do frontend troca só o
-- nome da tabela nas leituras, sem mudar nenhuma coluna.

CREATE TABLE IF NOT EXISTS public.outbound_reminder_registry (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_phone         TEXT NOT NULL,
    message_type          TEXT NOT NULL,
    template_key          TEXT NOT NULL,
    template_vars         JSONB NOT NULL DEFAULT '{}'::jsonb,
    scheduled_at          TIMESTAMPTZ NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    sent_at               TIMESTAMPTZ,
    attempts              INT NOT NULL DEFAULT 0,
    error_message         TEXT,
    reference_id          UUID,
    reference_type        TEXT,
    media_url             TEXT,
    media_type            TEXT,
    is_edited              BOOLEAN NOT NULL DEFAULT false,
    notification_channel  TEXT NOT NULL DEFAULT 'whatsapp'
                             CHECK (notification_channel IN ('whatsapp', 'instagram', 'facebook', 'sms', 'mms', 'email')),
    channel_recipient_id  TEXT,
    confirmation_status   TEXT,
    -- Ponte para a mecânica de entrega: qual mensagem, dentro da fila pgmq,
    -- corresponde a esta linha de negócio agora. NULL depois que a mensagem
    -- é arquivada pelo pgmq (sent/failed definitivo) — o desfecho já está
    -- gravado em `status`, não precisa mais apontar pra fila.
    queue_msg_id          BIGINT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mesma deduplicação de hoje: mesmo tenant/paciente/tipo/referência/canal não
-- entra duas vezes na fila (schedule-reminders roda a cada minuto e recalcula
-- os mesmos lembretes repetidamente — o ON CONFLICT DO NOTHING é o que evita
-- duplicata, não uma checagem em código).
CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_unique_msg
ON public.outbound_reminder_registry (tenant_id, patient_phone, message_type, reference_id, notification_channel);

CREATE INDEX IF NOT EXISTS idx_registry_tenant_status
ON public.outbound_reminder_registry (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_registry_scheduled_at
ON public.outbound_reminder_registry (scheduled_at);

CREATE INDEX IF NOT EXISTS idx_registry_reference
ON public.outbound_reminder_registry (reference_id, reference_type)
WHERE reference_id IS NOT NULL;

-- 3. RLS --------------------------------------------------------------------
-- Diferença deliberada em relação a outbound_message_queue: membros só têm
-- SELECT. INSERT/UPDATE/DELETE diretos permitiam (via devtools do navegador)
-- deixar o registro e a fila pgmq dessincronizados — ex.: reabrir uma linha
-- 'cancelled' sem recriar a mensagem correspondente no pgmq. Toda mutação
-- passa pelas RPCs SECURITY DEFINER da migração seguinte, que sempre tocam
-- registro + pgmq na mesma transação.

ALTER TABLE public.outbound_reminder_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only access"
ON public.outbound_reminder_registry
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Members can view their tenant registry"
ON public.outbound_reminder_registry
FOR SELECT
USING (
    tenant_id IN (
        SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
    )
);

COMMIT;

SELECT 'pgmq instalado + outbound_reminder_registry criada.' AS resultado;
