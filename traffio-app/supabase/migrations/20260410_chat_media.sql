-- ##########################################################
-- TRAFFIO — Chat Media Support
-- Migration: 20260410_chat_media
-- ##########################################################

-- 1. Expandir conversation_messages com campos de mídia
ALTER TABLE conversation_messages
    ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text'
        CHECK (message_type IN ('text', 'image', 'audio', 'video', 'document', 'sticker', 'gif', 'internal')),
    ADD COLUMN IF NOT EXISTS media_url    TEXT,
    ADD COLUMN IF NOT EXISTS file_name   TEXT,
    ADD COLUMN IF NOT EXISTS mime_type   TEXT,
    ADD COLUMN IF NOT EXISTS file_size   INTEGER,
    ADD COLUMN IF NOT EXISTS caption     TEXT,
    ADD COLUMN IF NOT EXISTS duration_s  INTEGER;  -- para áudios: duração em segundos

-- 2. Expandir message_inbox com campos de mídia (mensagens recebidas do WhatsApp)
ALTER TABLE message_inbox
    ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS media_url    TEXT,
    ADD COLUMN IF NOT EXISTS file_name   TEXT,
    ADD COLUMN IF NOT EXISTS mime_type   TEXT,
    ADD COLUMN IF NOT EXISTS caption     TEXT;

-- 3. Índice para buscar mensagens com mídia de uma sessão
CREATE INDEX IF NOT EXISTS idx_conv_messages_media
    ON conversation_messages(session_id, message_type)
    WHERE message_type != 'text';
