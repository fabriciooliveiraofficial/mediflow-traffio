-- =============================================================================
-- MIGRAÇÃO: Adiciona suporte a configurações dinâmicas de Live Chat por Tenant
-- data: 2026-07-06
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tenant_livechat_configs (
    id               UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    primary_color    TEXT NOT NULL DEFAULT '#1152d4',
    welcome_title    TEXT NOT NULL DEFAULT 'Iniciar Atendimento',
    welcome_subtitle TEXT NOT NULL DEFAULT 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.',
    pill_text        TEXT NOT NULL DEFAULT 'Fale conosco',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de busca
CREATE INDEX IF NOT EXISTS idx_tenant_livechat_configs_tenant 
    ON public.tenant_livechat_configs(tenant_id);

-- Habilitar RLS
ALTER TABLE public.tenant_livechat_configs ENABLE ROW LEVEL SECURITY;

-- Remover políticas antigas se existirem
DROP POLICY IF EXISTS "Tenants can manage own livechat configs" ON public.tenant_livechat_configs;
DROP POLICY IF EXISTS "Allow public read of active livechat configs" ON public.tenant_livechat_configs;
DROP POLICY IF EXISTS "Allow public read of all livechat configs" ON public.tenant_livechat_configs;
DROP POLICY IF EXISTS "Super admins can manage all livechat configs" ON public.tenant_livechat_configs;
DROP POLICY IF EXISTS "service_role_full_access" ON public.tenant_livechat_configs;

-- Criar Políticas
CREATE POLICY "Tenants can manage own livechat configs"
    ON public.tenant_livechat_configs
    FOR ALL
    TO authenticated
    USING (
        tenant_id IN (
            SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Super admins can manage all livechat configs"
    ON public.tenant_livechat_configs
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'super_admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'super_admin'
        )
    );

CREATE POLICY "Allow public read of all livechat configs"
    ON public.tenant_livechat_configs
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "service_role_full_access" 
    ON public.tenant_livechat_configs
    FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

-- Permissões
GRANT ALL ON public.tenant_livechat_configs TO service_role;
GRANT SELECT ON public.tenant_livechat_configs TO anon, authenticated;
GRANT ALL ON public.tenant_livechat_configs TO authenticated;

-- Trigger para updated_at automático
DROP TRIGGER IF EXISTS tr_tenant_livechat_configs_updated_at ON public.tenant_livechat_configs;
CREATE TRIGGER tr_tenant_livechat_configs_updated_at
    BEFORE UPDATE ON public.tenant_livechat_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill: Criar configuração inicial para todos os tenants existentes
INSERT INTO public.tenant_livechat_configs (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;
