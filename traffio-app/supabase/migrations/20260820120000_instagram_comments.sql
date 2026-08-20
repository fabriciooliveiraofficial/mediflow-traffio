-- =============================================================================
-- MIGRATION: Instagram Comments Inbox
-- Suporte à permissão Meta `instagram_manage_comments` — recebe comentários de
-- posts do Instagram via webhook e permite que atendentes humanos respondam
-- pelo painel do Traffio.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.instagram_comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  comment_id          TEXT NOT NULL,
  media_id            TEXT,
  parent_comment_id   TEXT,
  ig_account_id       TEXT,
  from_id             TEXT,
  from_username       TEXT,
  text                TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'replied', 'ignored')),
  reply_text          TEXT,
  replied_at          TIMESTAMPTZ,
  replied_by_user_id  UUID REFERENCES public.profiles(id),
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_instagram_comments_tenant_status
  ON public.instagram_comments (tenant_id, status, received_at DESC);

ALTER TABLE public.instagram_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenants manage their Instagram comments" ON public.instagram_comments;
CREATE POLICY "Tenants manage their Instagram comments" ON public.instagram_comments
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role writes Instagram comments" ON public.instagram_comments;
CREATE POLICY "Service role writes Instagram comments" ON public.instagram_comments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
