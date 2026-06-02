-- =============================================================================
-- MIGRAÇÃO: Adiciona suporte a canais de atendimento (WhatsApp e Live Chat)
-- data: 2026-06-02
-- =============================================================================

-- Adiciona a coluna 'channel' na tabela conversation_sessions com restrição CHECK
ALTER TABLE public.conversation_sessions
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp'
  CONSTRAINT conversation_sessions_channel_check CHECK (channel IN ('whatsapp', 'livechat'));

-- Cria um índice parcial para otimizar buscas e filtros por canal no painel de atendimento
CREATE INDEX IF NOT EXISTS idx_conv_sessions_channel 
  ON public.conversation_sessions(tenant_id, channel);
