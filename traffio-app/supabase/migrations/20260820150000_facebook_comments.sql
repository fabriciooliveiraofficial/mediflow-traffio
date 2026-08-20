-- =============================================================================
-- MIGRATION: Facebook Page Comments Inbox
-- Espelha instagram_comments (ver 20260820120000_instagram_comments.sql) —
-- tabela separada por plataforma, unificada só na camada de serviço/UI, para
-- não arriscar o código já testado do Instagram. Permissão necessária:
-- pages_manage_engagement (+ pages_read_engagement, pages_messaging já
-- concedidas). Ver docs.facebook.com/docs/pages-api/comments-mentions/ e
-- .../messenger-platform/discovery/private-replies
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.facebook_comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  comment_id          TEXT NOT NULL,
  post_id             TEXT,
  parent_comment_id   TEXT,
  page_id             TEXT,
  from_id             TEXT,
  from_name           TEXT,
  text                TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'replied', 'ignored')),
  reply_text          TEXT,
  replied_at          TIMESTAMPTZ,
  replied_by_user_id  UUID REFERENCES public.profiles(id),
  ai_generated        BOOLEAN NOT NULL DEFAULT false,
  private_reply_text        TEXT,
  private_reply_sent_at     TIMESTAMPTZ,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_facebook_comments_tenant_status
  ON public.facebook_comments (tenant_id, status, received_at DESC);

ALTER TABLE public.facebook_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenants manage their Facebook comments" ON public.facebook_comments;
CREATE POLICY "Tenants manage their Facebook comments" ON public.facebook_comments
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role writes Facebook comments" ON public.facebook_comments;
CREATE POLICY "Service role writes Facebook comments" ON public.facebook_comments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
