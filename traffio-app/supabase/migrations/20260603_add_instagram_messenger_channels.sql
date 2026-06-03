-- =============================================================================
-- MIGRAÇÃO: Adiciona suporte a canais Instagram Direct e Facebook Messenger
-- data: 2026-06-03
-- =============================================================================

-- Remover a restrição check atual
ALTER TABLE public.conversation_sessions
  DROP CONSTRAINT IF EXISTS conversation_sessions_channel_check;

-- Adicionar a nova restrição check com suporte a instagram e facebook
ALTER TABLE public.conversation_sessions
  ADD CONSTRAINT conversation_sessions_channel_check 
  CHECK (channel IN ('whatsapp', 'livechat', 'instagram', 'facebook'));
