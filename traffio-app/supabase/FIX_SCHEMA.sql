-- ##########################################################
-- TRAFFIO MEDICAL - FIX SCHEMA (MIGRAÇÃO FORÇADA)
-- ##########################################################
-- Execute este script para corrigir o erro "column tenant_id does not exist".
-- Ele força a atualização das tabelas existentes.

-- 1. Garantir que a extensão UUID existe
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- 2. Forçar criação/atualização da tabela TENANTS
CREATE TABLE IF NOT EXISTS tenants (id UUID PRIMARY KEY DEFAULT uuid_generate_v4());
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS geofence_radius INTEGER DEFAULT 100;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS color_primary TEXT DEFAULT '#1152d4';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS color_secondary TEXT DEFAULT '#0A0A0B';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS zapi_instance_id TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS zapi_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS zapi_client_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_status TEXT DEFAULT 'DISCONNECTED';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS asaas_api_key TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS asaas_wallet_id TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Forçar atualização de PROFILES
CREATE TABLE IF NOT EXISTS profiles (id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Forçar atualização de MEMBERS
CREATE TABLE IF NOT EXISTS members (id UUID PRIMARY KEY DEFAULT uuid_generate_v4());
ALTER TABLE members ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS role TEXT CHECK (role IN ('owner', 'admin', 'doctor', 'staff'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 5. Forçar atualização de PATIENTS
CREATE TABLE IF NOT EXISTS patients (id UUID PRIMARY KEY DEFAULT uuid_generate_v4());
ALTER TABLE patients ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_provider TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_card_number TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS address_json JSONB;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE patients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 6. Forçar atualização de DOCTORS
CREATE TABLE IF NOT EXISTS doctors (id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE);
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS crm TEXT UNIQUE;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS specialty TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS rqe TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 7. Forçar atualização de APPOINTMENT_TYPES
CREATE TABLE IF NOT EXISTS appointment_types (id UUID PRIMARY KEY DEFAULT uuid_generate_v4());
ALTER TABLE appointment_types ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE appointment_types ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE appointment_types ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 30;
ALTER TABLE appointment_types ADD COLUMN IF NOT EXISTS price_cents INTEGER;
ALTER TABLE appointment_types ADD COLUMN IF NOT EXISTS color_hex TEXT;
ALTER TABLE appointment_types ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 8. Forçar atualização de APPOINTMENTS
CREATE TABLE IF NOT EXISTS appointments (id UUID PRIMARY KEY DEFAULT uuid_generate_v4());
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS type_id UUID REFERENCES appointment_types(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booked_by TEXT DEFAULT 'user';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checkin_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checkin_method TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 9. Forçar atualização de DOCTOR_AVAILABILITY
CREATE TABLE IF NOT EXISTS doctor_availability (id UUID PRIMARY KEY DEFAULT uuid_generate_v4());
ALTER TABLE doctor_availability ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE;
ALTER TABLE doctor_availability ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE doctor_availability ADD COLUMN IF NOT EXISTS day_of_week INTEGER;
ALTER TABLE doctor_availability ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE doctor_availability ADD COLUMN IF NOT EXISTS end_time TIME;

-- 10. DROP e RECRIAR Policies (Garante que referências a colunas existam)
-- Dropando todas as policies antigas para evitar conflitos
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "tenants_select_member" ON tenants;
DROP POLICY IF EXISTS "tenants_update_owner" ON tenants;
DROP POLICY IF EXISTS "members_select_tenant" ON members;
DROP POLICY IF EXISTS "members_manage_admin" ON members;
DROP POLICY IF EXISTS "patients_tenant_access" ON patients;
DROP POLICY IF EXISTS "appointments_tenant_access" ON appointments;
DROP POLICY IF EXISTS "doctors_select_tenant" ON doctors;
DROP POLICY IF EXISTS "doctors_manage_self" ON doctors;
DROP POLICY IF EXISTS "availability_tenant_access" ON doctor_availability;

-- Habilitar RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_availability ENABLE ROW LEVEL SECURITY;

-- Helper Function
CREATE OR REPLACE FUNCTION get_my_tenant_ids()
RETURNS SETOF UUID AS $$
    SELECT tenant_id FROM members WHERE user_id = auth.uid() AND is_active = TRUE;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Recriar Policies (Agora seguro pois as colunas existem)
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "tenants_select_member" ON tenants FOR SELECT USING (id IN (SELECT get_my_tenant_ids()));

CREATE POLICY "members_select_tenant" ON members FOR SELECT USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY "patients_tenant_access" ON patients FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY "appointments_tenant_access" ON appointments FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

CREATE POLICY "doctors_select_tenant" ON doctors FOR SELECT USING (id IN (SELECT user_id FROM members WHERE tenant_id IN (SELECT get_my_tenant_ids())));

CREATE POLICY "availability_tenant_access" ON doctor_availability FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- RPCs
CREATE OR REPLACE FUNCTION book_appointment(
    p_tenant_id UUID,
    p_patient_id UUID,
    p_doctor_id UUID,
    p_type_id UUID,
    p_date DATE,
    p_start_time TIME,
    p_end_time TIME DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_booked_by TEXT DEFAULT 'user'
) RETURNS JSON AS $$
DECLARE
    v_conflict_count INTEGER;
    v_new_id UUID;
    v_actual_end TIME;
    v_duration INTEGER;
BEGIN
    IF p_end_time IS NULL THEN
        SELECT duration_minutes INTO v_duration FROM appointment_types WHERE id = p_type_id;
        v_actual_end := p_start_time + (COALESCE(v_duration, 30) || ' minutes')::interval;
    ELSE
        v_actual_end := p_end_time;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_doctor_id::text || p_date::text));

    SELECT COUNT(*) INTO v_conflict_count
    FROM appointments
    WHERE doctor_id = p_doctor_id
      AND tenant_id = p_tenant_id
      AND date = p_date
      AND status NOT IN ('canceled', 'noshow')
      AND ((start_time < v_actual_end AND end_time > p_start_time));

    IF v_conflict_count > 0 THEN
        RETURN json_build_object('success', false, 'error', 'SLOT_CONFLICT', 'message', 'Horário ocupado.');
    END IF;

    INSERT INTO appointments (
        tenant_id, patient_id, doctor_id, type_id,
        date, start_time, end_time, status, notes, booked_by
    ) VALUES (
        p_tenant_id, p_patient_id, p_doctor_id, p_type_id,
        p_date, p_start_time, v_actual_end, 'scheduled', p_notes, p_booked_by
    ) RETURNING id INTO v_new_id;

    RETURN json_build_object('success', true, 'appointment_id', v_new_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger Profile
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.raw_user_meta_data->>'role', 'staff'))
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
