-- =============================================================================
-- MIGRAÇÃO: Infraestrutura de Comunicações (Telnyx + Meta Messaging)
-- Data: 2026-06-05
-- Idempotente: pode ser re-executada sem erros.
-- =============================================================================

-- ============================================================
-- 1. patient_channel_preferences
-- ============================================================
CREATE TABLE IF NOT EXISTS public.patient_channel_preferences (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_phone         TEXT NOT NULL,
    preferred_channel     TEXT NOT NULL DEFAULT 'whatsapp'
                          CHECK (preferred_channel IN ('whatsapp', 'instagram', 'facebook', 'sms')),
    instagram_user_id     TEXT,
    instagram_username    TEXT,
    facebook_user_id      TEXT,
    facebook_name         TEXT,
    whatsapp_phone        TEXT,
    sms_phone             TEXT,
    updated_by            TEXT NOT NULL DEFAULT 'auto'
                          CHECK (updated_by IN ('auto', 'manual')),
    last_auto_detected_at  TIMESTAMPTZ,
    last_manual_updated_at TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ DEFAULT NOW(),
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, patient_phone)
);

CREATE INDEX IF NOT EXISTS idx_patient_channel_prefs_tenant
    ON public.patient_channel_preferences (tenant_id);

CREATE INDEX IF NOT EXISTS idx_patient_channel_prefs_phone
    ON public.patient_channel_preferences (tenant_id, patient_phone);

ALTER TABLE public.patient_channel_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view patient channel preferences" ON public.patient_channel_preferences;
CREATE POLICY "Members can view patient channel preferences"
    ON public.patient_channel_preferences FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = patient_channel_preferences.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Members can manage patient channel preferences" ON public.patient_channel_preferences;
CREATE POLICY "Members can manage patient channel preferences"
    ON public.patient_channel_preferences FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = patient_channel_preferences.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Service role full access to patient_channel_preferences" ON public.patient_channel_preferences;
CREATE POLICY "Service role full access to patient_channel_preferences"
    ON public.patient_channel_preferences FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 2. tenant_phone_numbers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_phone_numbers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    phone_number      TEXT NOT NULL,
    telnyx_number_id  TEXT,
    friendly_name     TEXT,
    country_code      TEXT DEFAULT 'BR',
    is_active         BOOLEAN NOT NULL DEFAULT true,
    capabilities      JSONB DEFAULT '{"voice": true, "sms": true}'::jsonb,
    released_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_tenant_phone_numbers_tenant
    ON public.tenant_phone_numbers (tenant_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_tenant_phone_numbers_phone
    ON public.tenant_phone_numbers (phone_number) WHERE is_active = true;

ALTER TABLE public.tenant_phone_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view tenant phone numbers" ON public.tenant_phone_numbers;
CREATE POLICY "Members can view tenant phone numbers"
    ON public.tenant_phone_numbers FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = tenant_phone_numbers.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Admins can manage tenant phone numbers" ON public.tenant_phone_numbers;
CREATE POLICY "Admins can manage tenant phone numbers"
    ON public.tenant_phone_numbers FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = tenant_phone_numbers.tenant_id
          AND members.user_id = auth.uid()
          AND members.role IN ('owner', 'admin')
    ));

DROP POLICY IF EXISTS "Service role full access to tenant_phone_numbers" ON public.tenant_phone_numbers;
CREATE POLICY "Service role full access to tenant_phone_numbers"
    ON public.tenant_phone_numbers FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 3. tenant_meta_pages
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_meta_pages (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    page_id               TEXT NOT NULL,
    page_name             TEXT NOT NULL,
    page_access_token     TEXT NOT NULL,
    page_category         TEXT,
    instagram_account_id  TEXT,
    instagram_username    TEXT,
    token_type            TEXT DEFAULT 'page',
    expires_at            TIMESTAMPTZ,
    last_refreshed_at     TIMESTAMPTZ,
    is_active             BOOLEAN NOT NULL DEFAULT true,
    scope_granted         TEXT[] DEFAULT '{}',
    updated_at            TIMESTAMPTZ DEFAULT NOW(),
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_meta_pages_tenant
    ON public.tenant_meta_pages (tenant_id) WHERE is_active = true;

ALTER TABLE public.tenant_meta_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view meta pages" ON public.tenant_meta_pages;
CREATE POLICY "Members can view meta pages"
    ON public.tenant_meta_pages FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = tenant_meta_pages.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Admins can manage meta pages" ON public.tenant_meta_pages;
CREATE POLICY "Admins can manage meta pages"
    ON public.tenant_meta_pages FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = tenant_meta_pages.tenant_id
          AND members.user_id = auth.uid()
          AND members.role IN ('owner', 'admin')
    ));

DROP POLICY IF EXISTS "Service role full access to tenant_meta_pages" ON public.tenant_meta_pages;
CREATE POLICY "Service role full access to tenant_meta_pages"
    ON public.tenant_meta_pages FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 4. call_routing_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS public.call_routing_rules (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    tenant_phone_number_id  UUID REFERENCES public.tenant_phone_numbers(id) ON DELETE CASCADE,
    auto_record             BOOLEAN NOT NULL DEFAULT true,
    agent_user_ids          UUID[] DEFAULT '{}',
    ring_timeout_seconds    INTEGER DEFAULT 30,
    is_active               BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.call_routing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view routing rules" ON public.call_routing_rules;
CREATE POLICY "Members can view routing rules"
    ON public.call_routing_rules FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = call_routing_rules.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Admins can manage routing rules" ON public.call_routing_rules;
CREATE POLICY "Admins can manage routing rules"
    ON public.call_routing_rules FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = call_routing_rules.tenant_id
          AND members.user_id = auth.uid()
          AND members.role IN ('owner', 'admin')
    ));

DROP POLICY IF EXISTS "Service role full access to call_routing_rules" ON public.call_routing_rules;
CREATE POLICY "Service role full access to call_routing_rules"
    ON public.call_routing_rules FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 5. call_records
-- ============================================================
CREATE TABLE IF NOT EXISTS public.call_records (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    telnyx_call_control_id      TEXT UNIQUE,
    telnyx_call_leg_id          TEXT,
    direction                   TEXT NOT NULL DEFAULT 'inbound'
                                CHECK (direction IN ('inbound', 'outbound')),
    from_number                 TEXT,
    to_number                   TEXT,
    tenant_phone_number_id      UUID REFERENCES public.tenant_phone_numbers(id),
    status                      TEXT NOT NULL DEFAULT 'ringing'
                                CHECK (status IN ('ringing', 'answered', 'completed', 'missed', 'failed')),
    started_at                  TIMESTAMPTZ,
    answered_at                 TIMESTAMPTZ,
    ended_at                    TIMESTAMPTZ,
    duration_seconds            INTEGER,
    recording_url               TEXT,
    recording_duration_seconds  INTEGER,
    created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_records_tenant
    ON public.call_records (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_records_control_id
    ON public.call_records (telnyx_call_control_id);

ALTER TABLE public.call_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view call records" ON public.call_records;
CREATE POLICY "Members can view call records"
    ON public.call_records FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = call_records.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Service role full access to call_records" ON public.call_records;
CREATE POLICY "Service role full access to call_records"
    ON public.call_records FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 6. tenant_usage_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_usage_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    resource_type       TEXT NOT NULL
                        CHECK (resource_type IN ('call_inbound', 'call_outbound', 'sms_inbound', 'sms_outbound')),
    resource_id         UUID,
    quantity            DECIMAL(10, 4) DEFAULT 1,
    unit_cost_usd       DECIMAL(10, 6) DEFAULT 0,
    total_cost_usd      DECIMAL(10, 6) DEFAULT 0,
    billing_period      TEXT,
    tenant_phone_number TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_log_tenant_period
    ON public.tenant_usage_log (tenant_id, billing_period);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_log_created
    ON public.tenant_usage_log (tenant_id, created_at DESC);

ALTER TABLE public.tenant_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view usage log" ON public.tenant_usage_log;
CREATE POLICY "Members can view usage log"
    ON public.tenant_usage_log FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.members
        WHERE members.tenant_id = tenant_usage_log.tenant_id
          AND members.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Service role full access to tenant_usage_log" ON public.tenant_usage_log;
CREATE POLICY "Service role full access to tenant_usage_log"
    ON public.tenant_usage_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 7. outbound_message_queue — adicionar notification_channel
-- ============================================================
ALTER TABLE public.outbound_message_queue
    ADD COLUMN IF NOT EXISTS notification_channel TEXT DEFAULT 'whatsapp'
    CHECK (notification_channel IN ('whatsapp', 'instagram', 'facebook', 'sms'));

-- ============================================================
-- 8. conversation_sessions — adicionar 'sms' ao canal check
-- ============================================================
ALTER TABLE public.conversation_sessions
    DROP CONSTRAINT IF EXISTS conversation_sessions_channel_check;

ALTER TABLE public.conversation_sessions
    ADD CONSTRAINT conversation_sessions_channel_check
    CHECK (channel IN ('whatsapp', 'livechat', 'instagram', 'facebook', 'sms'));
