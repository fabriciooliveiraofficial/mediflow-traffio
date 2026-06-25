-- Index optimization for the outbound message queue
-- This partial index focuses only on pending messages, making background polling for scheduled reminders extremely fast.
CREATE INDEX IF NOT EXISTS idx_outbound_queue_scheduled_at_pending 
ON outbound_message_queue (scheduled_at) 
WHERE status = 'pending';
