-- =============================================================================
-- FIX: Allow multiple cancelled rows for the same (tenant, phone, template, session)
--
-- The previous non-partial index blocked INSERT of fresh follow-ups after cancellation
-- because cancelled rows still occupied the unique slots.
--
-- Solution: unique index only on PENDING/PROCESSING/SENT rows (not cancelled/failed).
-- This allows cancelling + re-inserting freely, while still preventing duplicate
-- active sends for the same event.
-- =============================================================================

DROP INDEX IF EXISTS idx_outbound_queue_unique_msg;

CREATE UNIQUE INDEX idx_outbound_queue_unique_msg
ON public.outbound_message_queue (tenant_id, patient_phone, template_key, reference_id)
WHERE status IN ('pending', 'processing', 'sent');
