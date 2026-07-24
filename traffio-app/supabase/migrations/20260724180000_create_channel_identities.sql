-- ==============================================================================
-- Migração Omnicanal: Resolução de Identidade (Channel Identities)
-- ==============================================================================

-- 1. Criar a tabela de Identidades de Canal
CREATE TABLE IF NOT EXISTS public.channel_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    channel TEXT NOT NULL, -- 'whatsapp' | 'instagram' | 'messenger' | 'livechat'
    channel_user_id TEXT NOT NULL, -- telefone, igid, psid ou uuid de sessão
    patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
    platform_meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT channel_identities_tenant_channel_user_unique UNIQUE (tenant_id, channel, channel_user_id)
);

-- Índices de busca e relacionamento
CREATE INDEX IF NOT EXISTS idx_channel_identities_lookup 
    ON public.channel_identities (tenant_id, channel, channel_user_id);

CREATE INDEX IF NOT EXISTS idx_channel_identities_patient 
    ON public.channel_identities (tenant_id, patient_id) 
    WHERE patient_id IS NOT NULL;

-- 2. Atualizar a tabela conversation_sessions
ALTER TABLE public.conversation_sessions 
    ADD COLUMN IF NOT EXISTS channel_identity_id UUID REFERENCES public.channel_identities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_channel_identity 
    ON public.conversation_sessions (channel_identity_id);

-- 3. Atualizar a tabela message_inbox
ALTER TABLE public.message_inbox
    ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp',
    ADD COLUMN IF NOT EXISTS channel_user_id TEXT;

-- 4. Migração de dados legados (Backfill)
UPDATE public.message_inbox
SET channel_user_id = phone
WHERE channel_user_id IS NULL;

INSERT INTO public.channel_identities (tenant_id, channel, channel_user_id)
SELECT DISTINCT tenant_id, 'whatsapp', patient_phone
FROM public.conversation_sessions
WHERE patient_phone IS NOT NULL AND patient_phone != ''
ON CONFLICT (tenant_id, channel, channel_user_id) DO NOTHING;

UPDATE public.conversation_sessions cs
SET channel_identity_id = ci.id
FROM public.channel_identities ci
WHERE cs.tenant_id = ci.tenant_id
  AND ci.channel = 'whatsapp'
  AND cs.patient_phone = ci.channel_user_id
  AND cs.channel_identity_id IS NULL;
