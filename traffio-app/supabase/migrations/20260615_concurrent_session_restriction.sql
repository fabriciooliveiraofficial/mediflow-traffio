-- ================================================================
-- RESTRIÇÃO DE SESSÕES CONCORRENTES (ANTI-COMPARTILHAMENTO)
-- Criação de limites de sessões baseados em planos e registro de RPCs
-- ================================================================

-- 1. Adicionar coluna de limite de sessões na tabela de planos
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_sessions_per_user INT NOT NULL DEFAULT 1;

-- Atualizar limites dos planos existentes
UPDATE public.plans SET max_sessions_per_user = 1 WHERE id IN ('essencial', 'clinica');
UPDATE public.plans SET max_sessions_per_user = 2 WHERE id = 'rede';

-- 2. Tabela de logs de auditoria de login/logout/bloqueios
CREATE TABLE IF NOT EXISTS public.login_audit_log (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    event_type    TEXT NOT NULL,          -- 'login', 'logout', 'session_kicked', 'heartbeat_timeout'
    session_id    TEXT NOT NULL,
    user_agent    TEXT,
    ip_address    TEXT,
    metadata      JSONB DEFAULT '{}'::JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices e RLS para a tabela de logs
CREATE INDEX IF NOT EXISTS idx_login_audit_log_user ON public.login_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_login_audit_log_tenant ON public.login_audit_log(tenant_id);

ALTER TABLE public.login_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_own_select" ON public.login_audit_log
    FOR SELECT USING (user_id = auth.uid());

-- 3. Função para obter o limite máximo de sessões do usuário baseado no plano do seu Tenant ativo
CREATE OR REPLACE FUNCTION public.get_user_max_sessions(p_user_id UUID)
RETURNS INT AS $$
DECLARE
    v_max_sessions INT;
BEGIN
    SELECT COALESCE(p.max_sessions_per_user, 1)
      INTO v_max_sessions
      FROM public.members m
      JOIN public.tenants t ON m.tenant_id = t.id
      JOIN public.plans p ON t.plan = p.id
     WHERE m.user_id = p_user_id
       AND m.is_active = TRUE
     LIMIT 1;

    RETURN COALESCE(v_max_sessions, 1);
EXCEPTION
    WHEN OTHERS THEN
        RETURN 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Trigger de desativação de sessões excedentes (Last Login Wins)
CREATE OR REPLACE FUNCTION public.deactivate_previous_sessions()
RETURNS TRIGGER AS $$
DECLARE
    v_max_sessions INT;
    v_kicked_session_id TEXT;
    v_kicked_user_agent TEXT;
    v_kicked_ip_address TEXT;
    v_kicked_tenant_id UUID;
BEGIN
    -- Obter limite de sessões do plano do usuário
    v_max_sessions := public.get_user_max_sessions(NEW.user_id);

    -- Loop para desativar e auditar as sessões mais antigas que excedem o limite
    FOR v_kicked_session_id, v_kicked_user_agent, v_kicked_ip_address, v_kicked_tenant_id IN 
        SELECT session_id, user_agent, ip_address, tenant_id 
          FROM public.active_sessions
         WHERE user_id = NEW.user_id
           AND is_current = TRUE
           AND id <> NEW.id
         ORDER BY last_seen_at ASC, created_at ASC
         LIMIT GREATEST(0, (
             SELECT COUNT(*) 
               FROM public.active_sessions 
              WHERE user_id = NEW.user_id 
                AND is_current = TRUE
         ) - v_max_sessions)
    LOOP
        -- Marcar sessão como inativa
        UPDATE public.active_sessions
           SET is_current = FALSE
         WHERE session_id = v_kicked_session_id;

        -- Inserir log de auditoria do encerramento forçado da sessão
        INSERT INTO public.login_audit_log (
            user_id,
            tenant_id,
            event_type,
            session_id,
            user_agent,
            ip_address,
            metadata
        )
        VALUES (
            NEW.user_id,
            v_kicked_tenant_id,
            'session_kicked',
            v_kicked_session_id,
            v_kicked_user_agent,
            v_kicked_ip_address,
            jsonb_build_object('kicked_by_session_id', NEW.session_id)
        );
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Garantir que a trigger existente use a nova lógica e evite recursão rodando apenas se is_current for TRUE
DROP TRIGGER IF EXISTS trg_deactivate_previous_sessions ON public.active_sessions;
CREATE TRIGGER trg_deactivate_previous_sessions
    AFTER INSERT OR UPDATE ON public.active_sessions
    FOR EACH ROW
    WHEN (NEW.is_current = TRUE)
    EXECUTE FUNCTION public.deactivate_previous_sessions();

-- 5. RPC para registrar uma nova sessão (Frontend)
CREATE OR REPLACE FUNCTION public.register_session(
    p_session_id TEXT,
    p_tenant_id UUID,
    p_device_label TEXT,
    p_user_agent TEXT,
    p_ip_address TEXT
)
RETURNS VOID AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_agent TEXT;
    v_ip_address TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Não autenticado';
    END IF;

    -- Tentar capturar IP e User-Agent das requisições via PostgREST headers
    BEGIN
        v_user_agent := COALESCE(p_user_agent, current_setting('request.headers', true)::jsonb->>'user-agent');
        v_ip_address := COALESCE(p_ip_address, split_part(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ',', 1));
    EXCEPTION WHEN OTHERS THEN
        v_user_agent := p_user_agent;
        v_ip_address := p_ip_address;
    END;

    -- Upsert na tabela de sessões ativas
    INSERT INTO public.active_sessions (
        user_id,
        session_id,
        tenant_id,
        device_label,
        user_agent,
        ip_address,
        is_current,
        last_seen_at
    )
    VALUES (
        v_user_id,
        p_session_id,
        p_tenant_id,
        p_device_label,
        v_user_agent,
        v_ip_address,
        TRUE,
        NOW()
    )
    ON CONFLICT (session_id) DO UPDATE
    SET is_current = TRUE,
        last_seen_at = NOW(),
        device_label = COALESCE(p_device_label, active_sessions.device_label),
        user_agent = COALESCE(v_user_agent, active_sessions.user_agent),
        ip_address = COALESCE(v_ip_address, active_sessions.ip_address);

    -- Log de auditoria para o login
    INSERT INTO public.login_audit_log (
        user_id,
        tenant_id,
        event_type,
        session_id,
        user_agent,
        ip_address
    )
    VALUES (
        v_user_id,
        p_tenant_id,
        'login',
        p_session_id,
        v_user_agent,
        v_ip_address
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RPC para atualização de status (Heartbeat periódico do Frontend)
CREATE OR REPLACE FUNCTION public.session_heartbeat(p_session_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_is_current BOOLEAN;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Atualiza data de última atividade e retorna se a sessão continua ativa
    UPDATE public.active_sessions
       SET last_seen_at = NOW()
     WHERE user_id = v_user_id
       AND session_id = p_session_id
     RETURNING is_current INTO v_is_current;

    RETURN COALESCE(v_is_current, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RPC para verificação rápida de validade de sessão
CREATE OR REPLACE FUNCTION public.check_session_valid(p_session_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_is_current BOOLEAN;
BEGIN
    SELECT is_current INTO v_is_current
      FROM public.active_sessions
     WHERE session_id = p_session_id;

    RETURN COALESCE(v_is_current, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. RPC para desativar sessão manualmente no logout do usuário
CREATE OR REPLACE FUNCTION public.deactivate_session(p_session_id TEXT)
RETURNS VOID AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_tenant_id UUID;
    v_user_agent TEXT;
    v_ip_address TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Não autenticado';
    END IF;

    -- Buscar metadados antes de inativar para o log de auditoria
    SELECT tenant_id, user_agent, ip_address
      INTO v_tenant_id, v_user_agent, v_ip_address
      FROM public.active_sessions
     WHERE session_id = p_session_id;

    UPDATE public.active_sessions
       SET is_current = FALSE
     WHERE user_id = v_user_id
       AND session_id = p_session_id;

    -- Log de auditoria para o logout
    INSERT INTO public.login_audit_log (
        user_id,
        tenant_id,
        event_type,
        session_id,
        user_agent,
        ip_address
    )
    VALUES (
        v_user_id,
        v_tenant_id,
        'logout',
        p_session_id,
        v_user_agent,
        v_ip_address
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. RPC para limpeza de sessões inativas (Heartbeat expirado após 2 horas)
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS INT AS $$
DECLARE
    v_cleaned_count INT;
BEGIN
    -- Registrar log de expiração para as sessões correntes inativas a mais de 2 horas
    INSERT INTO public.login_audit_log (
        user_id,
        tenant_id,
        event_type,
        session_id,
        user_agent,
        ip_address,
        metadata
    )
    SELECT user_id, tenant_id, 'heartbeat_timeout', session_id, user_agent, ip_address, 
           jsonb_build_object('last_seen_at', last_seen_at)
      FROM public.active_sessions
     WHERE is_current = TRUE
       AND last_seen_at < NOW() - INTERVAL '2 hours';

    -- Atualizar is_current para FALSE nas sessões expiradas
    WITH updated AS (
        UPDATE public.active_sessions
           SET is_current = FALSE
         WHERE is_current = TRUE
           AND last_seen_at < NOW() - INTERVAL '2 hours'
         RETURNING 1
    )
    SELECT COUNT(*) INTO v_cleaned_count FROM updated;

    -- Deletar permanentemente registros inativos com mais de 7 dias para limpeza da tabela
    DELETE FROM public.active_sessions
     WHERE is_current = FALSE
       AND last_seen_at < NOW() - INTERVAL '7 days';

    RETURN v_cleaned_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Habilitar Supabase Realtime para a tabela active_sessions
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.active_sessions;
        EXCEPTION WHEN OTHERS THEN
            -- Ignora erro caso a tabela já esteja na publicação
            NULL;
        END;
    END IF;
END $$;
