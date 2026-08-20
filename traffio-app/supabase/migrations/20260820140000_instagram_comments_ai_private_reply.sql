-- =============================================================================
-- MIGRATION: Resposta privada + resposta automática por IA em comentários do Instagram
--
-- Padrão ManyChat: cada comentário recebe (1) uma resposta pública curta no
-- próprio comentário e (2) uma resposta privada via Private Replies API da
-- Meta (POST /{ig-account-id}/messages com recipient.comment_id — endpoint
-- oficial e diferente de DM comum, não abre "conversa" contínua, só permite
-- 1 envio por comentário, janela de 7 dias). Ver:
-- https://developers.facebook.com/docs/instagram-platform/private-replies/
-- =============================================================================

BEGIN;

ALTER TABLE public.instagram_comments
  ADD COLUMN IF NOT EXISTS private_reply_text TEXT,
  ADD COLUMN IF NOT EXISTS private_reply_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT false;

COMMIT;
