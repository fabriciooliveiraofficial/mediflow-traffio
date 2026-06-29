-- =============================================================================
-- MIGRAÇÃO: Adicionar coluna email em patient_channel_preferences
-- Data: 2026-06-29
-- =============================================================================

ALTER TABLE public.patient_channel_preferences 
    ADD COLUMN IF NOT EXISTS email TEXT;
