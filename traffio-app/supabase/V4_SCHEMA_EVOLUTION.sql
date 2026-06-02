-- ##########################################################
-- TRAFFIO MEDICAL - DEPLOY SCHEMA V4 EVOLUTION (2026-02-25)
-- ##########################################################
-- Execute this file in the Supabase SQL Editor to upgrade from V3.

-- 1. locations table
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

-- Habilitar RLS
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "locations_tenant_access" ON locations
    FOR ALL USING (tenant_id IN (SELECT get_my_tenant_ids()));

-- 2. doctor_locations junction (N:N)
CREATE TABLE IF NOT EXISTS doctor_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT FALSE,
    UNIQUE(doctor_id, location_id)
);

-- Habilitar RLS
ALTER TABLE doctor_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "doctor_locations_tenant_access" ON doctor_locations
    FOR ALL USING (location_id IN (SELECT id FROM locations WHERE tenant_id IN (SELECT get_my_tenant_ids())));

-- 3. Migration for existing appointments & availability
-- a. Create a default location for each existing tenant
INSERT INTO locations (tenant_id, name)
SELECT id, 'Local Padrão' FROM tenants
ON CONFLICT DO NOTHING;

-- b. Add location_id to appointments (nullable initially)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id);

-- c. Update existing appointments to use the tenant's default location
UPDATE appointments a
SET location_id = (SELECT id FROM locations l WHERE l.tenant_id = a.tenant_id LIMIT 1)
WHERE location_id IS NULL;

-- d. Make location_id NOT NULL on appointments
ALTER TABLE appointments ALTER COLUMN location_id SET NOT NULL;

-- e. Add location_id to doctor_availability
ALTER TABLE doctor_availability ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id);

-- f. Update existing doctor_availability to use the tenant's default location
UPDATE doctor_availability da
SET location_id = (SELECT id FROM locations l WHERE l.tenant_id = da.tenant_id LIMIT 1)
WHERE location_id IS NULL;

-- g. Update unique constraint on doctor_availability
ALTER TABLE doctor_availability DROP CONSTRAINT IF EXISTS doctor_avail_unique;
ALTER TABLE doctor_availability DROP CONSTRAINT IF EXISTS doctor_availability_doctor_id_tenant_id_day_of_week_key;

ALTER TABLE doctor_availability ADD CONSTRAINT 
    doctor_avail_unique UNIQUE(doctor_id, tenant_id, location_id, day_of_week);

-- 4. Create missing master_config table
CREATE TABLE IF NOT EXISTS master_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE master_config ENABLE ROW LEVEL SECURITY;
-- App accesses via Service Role Key typically, but allow read-only for authenticated maybe?
-- Creating permissive read-only just in case edge functions need user auth access
CREATE POLICY "public_master_config_read" ON master_config FOR SELECT USING (true);


-- ============================================================
-- 5. RPC: book_appointment (Concurrency-Safe, Location-Aware)
-- ============================================================
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

    -- Calcular end_time se não fornecido
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

    -- 4. Verificar disponibilidade do médico no local e horário
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
-- 6. RPC: get_available_slots (Location-Aware)
-- ============================================================
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
    -- Buscar disponibilidade do médico para o dia da semana e local
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
