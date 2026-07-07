-- =============================================================================
-- MIGRAÇÃO: Melhorias do Live Chat — título do cabeçalho dinâmico e
-- encerramento por inatividade configurável por tenant
-- data: 2026-07-07
-- =============================================================================

ALTER TABLE public.tenant_livechat_configs
    ADD COLUMN IF NOT EXISTS header_title TEXT NOT NULL DEFAULT 'Atendimento Online',
    ADD COLUMN IF NOT EXISTS header_subtitle TEXT NOT NULL DEFAULT 'Fale conosco',
    ADD COLUMN IF NOT EXISTS inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 30;
