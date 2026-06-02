-- FASE 0 — Fundação de Dados
-- Objetivo: Criar a infraestrutura de dados que sustenta todas as automações.

-- 1. Create the queue table
CREATE TABLE IF NOT EXISTS public.outbound_message_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_phone TEXT NOT NULL,
    message_type TEXT NOT NULL, -- follow_up, reminder_48h, reminder_2h, post_consultation, nps, reactivation
    template_key TEXT NOT NULL,
    template_vars JSONB NOT NULL DEFAULT '{}'::jsonb,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, sent, failed, cancelled
    sent_at TIMESTAMPTZ,
    attempts INT DEFAULT 0,
    error_message TEXT,
    reference_id UUID,
    reference_type TEXT, -- appointment, conversation
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_outbound_queue_pending 
ON public.outbound_message_queue (scheduled_at) 
WHERE status = 'pending';

-- 3. Uniqueness Constraint
-- Prevents duplicate follow-ups or reminders for the same event/conversation
-- Constraints help avoid spamming the patient with the same message type.
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_queue_unique_msg 
ON public.outbound_message_queue (tenant_id, patient_phone, message_type, reference_id)
WHERE status != 'cancelled';

-- 4. RLS Security (Service Role Only)
-- This table is managed by back-end workers, not the frontend.
ALTER TABLE public.outbound_message_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only access" 
ON public.outbound_message_queue 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- 5. Cleanup Function
-- Removes processed or permanently failed records older than 30 days.
CREATE OR REPLACE FUNCTION public.cleanup_outbound_queue()
RETURNS void AS $$
BEGIN
    DELETE FROM public.outbound_message_queue
    WHERE (status = 'sent' OR status = 'cancelled' OR (status = 'failed' AND attempts >= 3))
    AND created_at < now() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
