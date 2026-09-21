-- Filtro anti-spam dos canais Meta (Instagram Direct, Messenger, comentários).
-- Decisões de produto (2026-09-21): spam/fornecedor → IGNORAR em silêncio (sem
-- resposta, sem ocultar comentário), só canais Meta, tudo reversível em 1 clique.
-- Ver _shared/inboundSpamFilter.ts.

-- ── 1. Reputação de remetente — GLOBAL da plataforma ─────────────────────────
-- Sem tenant_id na chave de propósito: o spammer que atacou uma clínica já
-- chega bloqueado nas demais. 'trusted' (humano clicou "Não é spam") vence tudo.
CREATE TABLE IF NOT EXISTS public.channel_sender_reputation (
  platform          TEXT        NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  sender_id         TEXT        NOT NULL,
  verdict           TEXT        NOT NULL CHECK (verdict IN ('spam', 'vendor', 'trusted')),
  reason            TEXT,
  source            TEXT        NOT NULL CHECK (source IN ('rule', 'fingerprint', 'classifier', 'triage', 'human')),
  hits              INTEGER     NOT NULL DEFAULT 1,
  first_tenant_id   UUID        REFERENCES public.tenants(id) ON DELETE SET NULL,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, sender_id)
);

ALTER TABLE public.channel_sender_reputation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages sender reputation" ON public.channel_sender_reputation;
CREATE POLICY "Service role manages sender reputation" ON public.channel_sender_reputation
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 2. Impressão digital de texto — detecta disparo em massa ─────────────────
-- Mesmo texto (normalizado) vindo de N remetentes distintos em poucos dias.
-- Guarda só o hash, nunca o texto. Limpeza: linhas > 14 dias não contam mais.
CREATE TABLE IF NOT EXISTS public.inbound_text_fingerprints (
  text_hash   TEXT        NOT NULL,
  platform    TEXT        NOT NULL,
  sender_id   TEXT        NOT NULL,
  tenant_id   UUID        REFERENCES public.tenants(id) ON DELETE CASCADE,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (text_hash, platform, sender_id)
);
CREATE INDEX IF NOT EXISTS idx_inbound_text_fingerprints_seen ON public.inbound_text_fingerprints (text_hash, seen_at DESC);

ALTER TABLE public.inbound_text_fingerprints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages text fingerprints" ON public.inbound_text_fingerprints;
CREATE POLICY "Service role manages text fingerprints" ON public.inbound_text_fingerprints
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. Caixa de filtrados (DMs) — o que alimenta a aba "Filtrados" do Inbox ──
-- DM filtrada NÃO cria conversation_session (nem card no CRM, nem fila humana).
-- Fica aqui até alguém restaurar. Guarda o payload necessário para reinjetar
-- a mensagem em message_inbox exatamente como teria entrado.
CREATE TABLE IF NOT EXISTS public.filtered_inbound (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel       TEXT        NOT NULL CHECK (channel IN ('instagram', 'facebook')),
  sender_id     TEXT        NOT NULL,
  sender_name   TEXT,
  message_id    TEXT        NOT NULL,
  content       TEXT        NOT NULL,
  message_type  TEXT        NOT NULL DEFAULT 'text',
  media_url     TEXT,
  caption       TEXT,
  verdict       TEXT        NOT NULL CHECK (verdict IN ('spam', 'vendor')),
  reason        TEXT,
  layer         TEXT        NOT NULL CHECK (layer IN ('reputation', 'rule', 'fingerprint', 'classifier', 'triage')),
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at   TIMESTAMPTZ,
  restored_by   UUID,
  UNIQUE (tenant_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_filtered_inbound_tenant ON public.filtered_inbound (tenant_id, restored_at, received_at DESC);

ALTER TABLE public.filtered_inbound ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants read their filtered inbound" ON public.filtered_inbound;
CREATE POLICY "Tenants read their filtered inbound" ON public.filtered_inbound
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "Service role manages filtered inbound" ON public.filtered_inbound;
CREATE POLICY "Service role manages filtered inbound" ON public.filtered_inbound
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4. Comentários: por que foi ignorado ─────────────────────────────────────
-- O comentário já tem linha própria (status 'ignored'); só faltava o motivo,
-- para a aba "Filtrados" distinguir "filtro anti-spam" de "ignorado pelo humano".
ALTER TABLE public.instagram_comments ADD COLUMN IF NOT EXISTS filter_verdict TEXT;
ALTER TABLE public.instagram_comments ADD COLUMN IF NOT EXISTS filter_reason  TEXT;
ALTER TABLE public.facebook_comments  ADD COLUMN IF NOT EXISTS filter_verdict TEXT;
ALTER TABLE public.facebook_comments  ADD COLUMN IF NOT EXISTS filter_reason  TEXT;
