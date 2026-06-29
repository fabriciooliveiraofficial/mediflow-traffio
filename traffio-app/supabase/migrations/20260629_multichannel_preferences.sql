-- =============================================================================
-- MIGRAÇÃO: Suporte a Multi-canal em patient_channel_preferences
-- Data: 2026-06-29
-- =============================================================================

-- 1. Remover check constraint de canal único no patient_channel_preferences
ALTER TABLE public.patient_channel_preferences 
    DROP CONSTRAINT IF EXISTS patient_channel_preferences_preferred_channel_check;

-- 2. Atualizar check constraint do canal na fila de mensagens outbound para incluir novos canais
ALTER TABLE public.outbound_message_queue 
    DROP CONSTRAINT IF EXISTS outbound_message_queue_notification_channel_check;

ALTER TABLE public.outbound_message_queue 
    ADD CONSTRAINT outbound_message_queue_notification_channel_check 
    CHECK (notification_channel IN ('whatsapp', 'instagram', 'facebook', 'sms', 'email', 'mms'));

-- 3. Atualizar o índice de unicidade da fila de mensagens outbound
-- Permite agendar a mesma notificação (ex: reminder_24h) para o mesmo paciente/consulta em múltiplos canais simultaneamente
DROP INDEX IF EXISTS public.idx_outbound_queue_unique_msg;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_queue_unique_msg 
ON public.outbound_message_queue (tenant_id, patient_phone, message_type, reference_id, notification_channel)
WHERE status != 'cancelled';
