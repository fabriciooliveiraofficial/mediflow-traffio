-- ##########################################################
-- TRAFFIO — Fix conversation_messages schema
-- Migration: 20260413_fix_conversation_messages_schema
--
-- Fixes:
--   1. Role CHECK constraint missing 'human' and 'internal' roles
--      (sessionManager.logMessage fails silently for human messages)
--   2. Missing whatsapp_message_id column (needed for quoted replies)
--   3. Missing replied_to_id column (needed for quoted replies)
-- ##########################################################

-- 1. Drop old role CHECK and replace with expanded one
ALTER TABLE conversation_messages DROP CONSTRAINT IF EXISTS conversation_messages_role_check;
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_role_check
    CHECK (role IN ('user', 'assistant', 'system', 'human', 'internal'));

-- 2. Add whatsapp_message_id column (for linking to WhatsApp message IDs)
ALTER TABLE conversation_messages
    ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;

-- 3. Add replied_to_id column (for quoted reply threading)
ALTER TABLE conversation_messages
    ADD COLUMN IF NOT EXISTS replied_to_id TEXT;

-- 4. Index for quick lookup by whatsapp_message_id (quoted replies need this)
CREATE INDEX IF NOT EXISTS idx_conv_messages_wa_msg_id
    ON conversation_messages(whatsapp_message_id)
    WHERE whatsapp_message_id IS NOT NULL;
