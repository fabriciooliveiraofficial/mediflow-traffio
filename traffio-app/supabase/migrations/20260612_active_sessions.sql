-- ================================================================
-- SESSÕES ATIVAS: rastreio de dispositivos + sessão única
-- Executado no SQL Editor em 2026-06-12 (Migration 3)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.active_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id    TEXT NOT NULL UNIQUE,   -- claim session_id do JWT
    tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    device_label  TEXT,                   -- ex: "Chrome · Windows"
    user_agent    TEXT,
    ip_address    TEXT,
    is_current    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user
    ON public.active_sessions (user_id, is_current);
CREATE INDEX IF NOT EXISTS idx_active_sessions_tenant
    ON public.active_sessions (tenant_id);

ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;

-- Usuário vê e gerencia apenas as próprias sessões
CREATE POLICY "sessions_own_select" ON public.active_sessions
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "sessions_own_insert" ON public.active_sessions
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "sessions_own_update" ON public.active_sessions
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "sessions_own_delete" ON public.active_sessions
    FOR DELETE USING (user_id = auth.uid());

-- Ao registrar nova sessão corrente, desativa as anteriores do usuário
CREATE OR REPLACE FUNCTION public.deactivate_previous_sessions()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_current = TRUE THEN
        UPDATE public.active_sessions
           SET is_current = FALSE
         WHERE user_id = NEW.user_id
           AND id <> NEW.id
           AND is_current = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deactivate_previous_sessions ON public.active_sessions;
CREATE TRIGGER trg_deactivate_previous_sessions
    AFTER INSERT ON public.active_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.deactivate_previous_sessions();

-- Limpeza de sessões mortas (> 7 dias sem heartbeat)
-- Agendar via pg_cron ou edge function diária:
-- DELETE FROM public.active_sessions WHERE last_seen_at < NOW() - INTERVAL '7 days';
