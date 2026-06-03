-- Add per-tenant timezone support for multi-international deployments.
-- All scheduling, reminders, WhatsApp/Messenger/Instagram messages,
-- and cron-based operations will read this value instead of assuming Brazil time.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

COMMENT ON COLUMN tenants.timezone IS
  'IANA timezone identifier (e.g. America/Sao_Paulo, Europe/London, Asia/Tokyo). '
  'Used by schedule-reminders, process-outbound, appointment booking and all '
  'time-dependent features to localise dates for each clinic.';
