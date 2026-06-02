-- ##########################################################
-- TRAFFIO MEDICAL - DEPLOY SCHEMA V3 (2026-02-17)
-- ##########################################################
-- Execute este arquivo INTEIRO no SQL Editor do Supabase.
-- Inclui: Tabelas + RPC Atômica + Constraints + RLS Policies.

-- ============================================================
-- 0. EXTENSÕES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ============================================================
-- 1. SISTEMA & MULTI-TENANCY
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    logo_url TEXT,
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    geofence_radius INTEGER DEFAULT 100,
    color_primary TEXT DEFAULT '#1152d4',
    color_secondary TEXT DEFAULT '#0A0A0B',
    zapi_instance_id TEXT UNIQUE,
    zapi_token TEXT,
    zapi_client_token TEXT,
    whatsapp_status TEXT DEFAULT 'DISCONNECTED',
    asaas_api_key TEXT,
    asaas_wallet_id TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    avatar_url TEXT,
    role TEXT CHECK (role IN ('doctor', 'staff', 'patient', 'super_admin', 'owner', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('owner', 'admin', 'doctor', 'staff')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_active BOOLEAN DEFAULT TRUE,
    type TEXT DEFAULT 'consultorio',
    operating_hours JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. CRM & PACIENTES
-- ============================================================

CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    cpf TEXT,
    email TEXT,
    phone TEXT,
    birth_date DATE,
    gender TEXT,
    insurance_provider TEXT,
    insurance_card_number TEXT,
    address_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'failed')),
    message_template TEXT NOT NULL,
    target_audience_json JSONB,
    scheduled_for TIMESTAMPTZ,
    stats_sent INTEGER DEFAULT 0,
    stats_read INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. AGENDA & DOCTORS
-- ============================================================

CREATE TABLE IF NOT EXISTS doctors (
    id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    crm TEXT UNIQUE,
    specialty TEXT,
    bio TEXT,
    rqe TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT FALSE,
    UNIQUE(doctor_id, location_id)
);

CREATE TABLE IF NOT EXISTS appointment_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    price_cents INTEGER,
    color_hex TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    location_id UUID REFERENCES locations(id) NOT NULL,
    type_id UUID REFERENCES appointment_types(id),
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME,
    status TEXT CHECK (status IN ('scheduled', 'confirmed', 'checkin_done', 'waiting', 'in_progress', 'completed', 'canceled', 'noshow')),
    notes TEXT,
    booked_by TEXT DEFAULT 'user', -- 'user' | 'ai_agent'
    checkin_at TIMESTAMPTZ,
    checkin_method TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    location_id UUID REFERENCES locations(id) NOT NULL,
    day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    UNIQUE(doctor_id, tenant_id, location_id, day_of_week)
);

-- ============================================================
-- 4. PRONTUÁRIO & DOCUMENTOS
-- ============================================================

CREATE TABLE IF NOT EXISTS medical_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id),
    soap_json JSONB,
    is_signed BOOLEAN DEFAULT FALSE,
    signed_at TIMESTAMPTZ,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prescriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medical_record_id UUID REFERENCES medical_records(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    content_json JSONB,
    pdf_url TEXT,
    external_provider_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    medical_record_id UUID REFERENCES medical_records(id),
    filename TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_type TEXT,
    category TEXT CHECK (category IN ('exam_result', 'prescription', 'id_card', 'other')),
    uploaded_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. COMUNICAÇÃO & LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id),
    external_id TEXT,
    state_json JSONB,
    last_interaction TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id),
    channel TEXT CHECK (channel IN ('whatsapp', 'email', 'sms')),
    type TEXT,
    content TEXT,
    status TEXT CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    external_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS master_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. FINANCEIRO
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id),
    amount_cents INTEGER NOT NULL,
    status TEXT CHECK (status IN ('pending', 'paid', 'overdue', 'refunded')),
    asaas_billing_id TEXT,
    payment_method TEXT,
    paid_at TIMESTAMPTZ,
    invoice_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. AUDITORIA
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id),
    action TEXT NOT NULL,
    table_name TEXT,
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. EXCLUSION CONSTRAINT (Anti-Sobreposição de Horários)
-- ============================================================
-- Previne fisicamente que dois agendamentos ocupem o mesmo slot
-- para o mesmo médico no mesmo tenant.

-- Nota: usamos DO $$ para evitar erro se a constraint já existir
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'no_overlap_appointments'
    ) THEN
        ALTER TABLE appointments ADD CONSTRAINT no_overlap_appointments
            EXCLUDE USING gist (
                doctor_id WITH =,
                tenant_id WITH =,
                date WITH =,
                tsrange(
                    (date + start_time)::timestamp,
                    (date + COALESCE(end_time, start_time + interval '30 minutes'))::timestamp
                ) WITH &&
            ) WHERE (status NOT IN ('canceled', 'noshow'));
    END IF;
END $$;

-- ============================================================
-- 9. RPC: book_appointment (Concurrency-Safe)
-- ============================================================
-- ÚNICA forma de criar agendamentos. Tanto o frontend quanto
-- o agente IA chamam esta função. Advisory lock impede race condition.

CREATE OR REPLACE FUNCTION book_appointment(
    p_tenant_id UUID,
    p_patient_id UUID,
    p_doctor_id UUID,
    p_type_id UUID,
    p_date DATE,
    p_start_time TIME,
    p_end_time TIME DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_booked_by TEXT DEFAULT 'user',
    p_location_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_conflict_count INTEGER;
    v_new_id UUID;
    v_actual_end TIME;
    v_duration INTEGER;
BEGIN
    -- Require location_id
    IF p_location_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'MISSING_LOCATION', 'message', 'Local de atendimento é obrigatório.');
    END IF;

    -- Validate that doctor actually attends that location
    IF NOT EXISTS (
        SELECT 1 FROM doctor_locations 
        WHERE doctor_id = p_doctor_id AND location_id = p_location_id
    ) THEN
        RETURN json_build_object('success', false, 'error', 'INVALID_LOCATION', 'message', 'O médico não atende neste local.');
    END IF;

    -- Calcular end_time se não fornecido (usa duração do appointment_type)
    IF p_end_time IS NULL THEN
        SELECT duration_minutes INTO v_duration
        FROM appointment_types WHERE id = p_type_id;
        v_actual_end := p_start_time + (COALESCE(v_duration, 30) || ' minutes')::interval;
    ELSE
        v_actual_end := p_end_time;
    END IF;

    -- 1. Advisory Lock por médico+data (serializa requests concorrentes)
    PERFORM pg_advisory_xact_lock(
        hashtext(p_doctor_id::text || p_date::text)
    );

    -- 2. Verificar conflito DENTRO do lock
    SELECT COUNT(*) INTO v_conflict_count
    FROM appointments
    WHERE doctor_id = p_doctor_id
      AND tenant_id = p_tenant_id
      AND date = p_date
      AND status NOT IN ('canceled', 'noshow')
      AND (
          (start_time < v_actual_end AND end_time > p_start_time)
      );

    -- 3. Conflito detectado
    IF v_conflict_count > 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'SLOT_CONFLICT',
            'message', 'Este horário já está ocupado. Por favor, escolha outro.'
        );
    END IF;

    -- 4. Verificar disponibilidade do médico (dia da semana e local)
    IF NOT EXISTS (
        SELECT 1 FROM doctor_availability
        WHERE doctor_id = p_doctor_id
          AND tenant_id = p_tenant_id
          AND location_id = p_location_id
          AND day_of_week = EXTRACT(DOW FROM p_date)::integer
          AND start_time <= p_start_time
          AND end_time >= v_actual_end
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'OUTSIDE_AVAILABILITY',
            'message', 'O médico não atende neste local e horário.'
        );
    END IF;

    -- 5. Inserir agendamento
    INSERT INTO appointments (
        tenant_id, patient_id, doctor_id, location_id, type_id,
        date, start_time, end_time, status, notes, booked_by
    ) VALUES (
        p_tenant_id, p_patient_id, p_doctor_id, p_location_id, p_type_id,
        p_date, p_start_time, v_actual_end, 'scheduled', p_notes, p_booked_by
    ) RETURNING id INTO v_new_id;

    -- 6. Sucesso
    RETURN json_build_object(
        'success', true,
        'appointment_id', v_new_id,
        'message', 'Agendamento criado com sucesso.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 10. RPC: get_available_slots (Leitura de horários livres)
-- ============================================================
-- Usada pelo Agente IA e pelo frontend para listar slots livres.

CREATE OR REPLACE FUNCTION get_available_slots(
    p_tenant_id UUID,
    p_doctor_id UUID,
    p_location_id UUID,
    p_date DATE,
    p_slot_duration INTEGER DEFAULT 30
) RETURNS JSON AS $$
DECLARE
    v_availability RECORD;
    v_slots JSON[];
    v_current_time TIME;
    v_is_free BOOLEAN;
BEGIN
    -- Buscar disponibilidade do médico para o dia da semana no local específico
    SELECT start_time, end_time INTO v_availability
    FROM doctor_availability
    WHERE doctor_id = p_doctor_id
      AND tenant_id = p_tenant_id
      AND location_id = p_location_id
      AND day_of_week = EXTRACT(DOW FROM p_date)::integer;

    IF v_availability IS NULL THEN
        RETURN json_build_object('success', true, 'slots', '[]'::json);
    END IF;

    -- Gerar slots e verificar disponibilidade
    v_current_time := v_availability.start_time;
    v_slots := ARRAY[]::JSON[];

    WHILE v_current_time + (p_slot_duration || ' minutes')::interval <= v_availability.end_time LOOP
        -- Verificar se o slot está livre
        SELECT NOT EXISTS (
            SELECT 1 FROM appointments
            WHERE doctor_id = p_doctor_id
              AND tenant_id = p_tenant_id
              AND date = p_date
              AND status NOT IN ('canceled', 'noshow')
              AND start_time < (v_current_time + (p_slot_duration || ' minutes')::interval)
              AND end_time > v_current_time
        ) INTO v_is_free;

        v_slots := array_append(v_slots, json_build_object(
            'time', v_current_time::text,
            'end_time', (v_current_time + (p_slot_duration || ' minutes')::interval)::text,
            'available', v_is_free
        ));

        v_current_time := v_current_time + (p_slot_duration || ' minutes')::interval;
    END LOOP;

    RETURN json_build_object('success', true, 'slots', array_to_json(v_slots));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 11. RLS (ROW LEVEL SECURITY) + POLICIES
-- ============================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_config ENABLE ROW LEVEL SECURITY;

-- Helper: Buscar tenant_ids do usuário autenticado
CREATE OR REPLACE FUNCTION get_my_tenant_ids()
RETURNS SETOF UUID AS $$
    SELECT tenant_id FROM members WHERE user_id = auth.uid() AND is_active = TRUE;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- -------------------------------------------------------
-- PROFILES: Usuário pode ver/editar seu próprio perfil
-- -------------------------------------------------------
CREATE POLICY "profiles_select_own" ON profiles
    FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_update_own" ON profiles
    FOR UPDATE USING (id = auth.uid());
CREATE POLICY "profiles_insert_own" ON profiles
    FOR INSERT WITH CHECK (id = auth.uid());

-- -------------------------------------------------------
-- TENANTS: Membros do tenant podem ler
-- -------------------------------------------------------
CREATE POLICY "tenants_select_member" ON tenants
    FOR SELECT USING (id IN (SELECT get_my_tenant_ids()));
CREATE POLICY "tenants_update_owner" ON tenants
    FOR UPDATE USING (
        id IN (SELECT tenant_id FROM members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

-- -------------------------------------------------------
-- MEMBERS: Membros do mesmo tenant podem ver
-- -------------------------------------------------------
CREATE POLICY "members_select_tenant" ON members
    FOR SELECT USING (tenant_id IN (SELECT get_my_tenant_ids()));
CREATE POLICY "members_manage_admin" ON members
    FOR ALL USING (
        tenant_id IN (SELECT tenant_id FROM members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

-- -------------------------------------------------------
-- PATIENTS: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "patients_tenant_access" ON patients
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- APPOINTMENT_TYPES: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "appt_types_tenant_access" ON appointment_types
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- APPOINTMENTS: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "appointments_tenant_access" ON appointments
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- DOCTORS: Visível para membros do mesmo tenant
-- -------------------------------------------------------
CREATE POLICY "doctors_select_tenant" ON doctors
    FOR SELECT USING (
        id IN (SELECT user_id FROM members WHERE tenant_id IN (SELECT get_my_tenant_ids()))
    );
CREATE POLICY "doctors_manage_self" ON doctors
    FOR ALL USING (id = auth.uid());

-- -------------------------------------------------------
-- DOCTOR_AVAILABILITY: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "availability_tenant_access" ON doctor_availability
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- LOCATIONS: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "locations_tenant_access" ON locations
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- DOCTOR_LOCATIONS: Visível se o local pertencer ao tenant
-- -------------------------------------------------------
CREATE POLICY "doctor_locations_tenant_access" ON doctor_locations
    FOR ALL USING (location_id IN (SELECT id FROM locations WHERE tenant_id IN (SELECT get_my_tenant_ids())));

-- -------------------------------------------------------
-- MASTER_CONFIG: Leitura pública
-- -------------------------------------------------------
CREATE POLICY "public_master_config_read" ON master_config
    FOR SELECT USING (true);

-- -------------------------------------------------------
-- MEDICAL_RECORDS: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "records_tenant_access" ON medical_records
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- PRESCRIPTIONS: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "prescriptions_tenant_access" ON prescriptions
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- DOCUMENTS: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "documents_tenant_access" ON documents
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- BILLING_RECORDS: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "billing_tenant_access" ON billing_records
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- CAMPAIGNS: Acesso por tenant (admin/owner)
-- -------------------------------------------------------
CREATE POLICY "campaigns_tenant_access" ON campaigns
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- CHAT_SESSIONS: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "chat_tenant_access" ON chat_sessions
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- NOTIFICATIONS_LOG: Acesso por tenant
-- -------------------------------------------------------
CREATE POLICY "notifications_tenant_access" ON notifications_log
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- -------------------------------------------------------
-- AUDIT_LOGS: Acesso por tenant (read-only para admins)
-- -------------------------------------------------------
CREATE POLICY "audit_tenant_select" ON audit_logs
    FOR SELECT USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- ============================================================
-- 12. TRIGGER: auto-create profile on auth.users insert
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- FIM DO DEPLOY
-- ============================================================
-- Próximo passo: Executar no SQL Editor do Supabase Dashboard.
-- URL: https://supabase.com/dashboard/project/fyyhxmugxcfqhvoevuwf/sql
