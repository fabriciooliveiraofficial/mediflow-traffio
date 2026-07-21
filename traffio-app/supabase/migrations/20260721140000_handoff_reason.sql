-- Migration: 20260721140000_handoff_reason.sql
-- Description: Adds handoff_reason, handoff_kind, and handoff_at to conversation_sessions for reversible handoff tracking.

ALTER TABLE public.conversation_sessions
    ADD COLUMN IF NOT EXISTS handoff_reason TEXT;

ALTER TABLE public.conversation_sessions
    ADD COLUMN IF NOT EXISTS handoff_kind TEXT CHECK (handoff_kind IN ('soft', 'hard'));

ALTER TABLE public.conversation_sessions
    ADD COLUMN IF NOT EXISTS handoff_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_handoff_open
    ON public.conversation_sessions (tenant_id, handoff_at DESC)
    WHERE human_handoff = true;
