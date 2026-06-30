-- Migration: Recurring Appointments and Doctor Absences
-- Date: 2026-06-30

-- 1. Alter appointments table to support recurrence fields
ALTER TABLE public.appointments
    ADD COLUMN IF NOT EXISTS recurring_group_id uuid,
    ADD COLUMN IF NOT EXISTS recurrence_pattern text,
    ADD COLUMN IF NOT EXISTS recurrence_index integer;

-- Add index for recurring group lookups
CREATE INDEX IF NOT EXISTS idx_appointments_recurring_group ON public.appointments(recurring_group_id);

-- 2. Create doctor_absences table for vacations/leaves
CREATE TABLE IF NOT EXISTS public.doctor_absences (
    id uuid primary key default uuid_generate_v4(),
    tenant_id uuid references public.tenants(id) on delete cascade not null,
    doctor_id uuid references public.profiles(id) on delete cascade not null,
    start_date date not null,
    end_date date not null,
    reason text,
    created_at timestamptz default now() not null
);

-- Enable RLS
ALTER TABLE public.doctor_absences ENABLE ROW LEVEL SECURITY;

-- Absences policy: select is allowed for authenticated users in the tenant
CREATE POLICY doctor_absences_select ON public.doctor_absences
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = doctor_absences.tenant_id
        )
    );

-- Absences policy: manage (insert, update, delete) is allowed for managers/admins
CREATE POLICY doctor_absences_manage ON public.doctor_absences
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = doctor_absences.tenant_id
              AND m.role IN ('admin', 'owner', 'manager')
        )
    );

-- Enable INSERT for tenants on outbound_message_queue to allow manual queuing
CREATE POLICY "Tenants can insert into their own queue" 
ON public.outbound_message_queue FOR INSERT 
TO authenticated 
WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- 3. Modify single book_appointment to check doctor absences
CREATE OR REPLACE FUNCTION book_appointment(
    p_tenant_id     uuid,
    p_patient_id    uuid,
    p_doctor_id     uuid,
    p_location_id   uuid,
    p_type_id       uuid,
    p_date          date,
    p_start_time    time,
    p_end_time      time DEFAULT NULL,
    p_notes         text DEFAULT NULL,
    p_booked_by     text DEFAULT 'user'
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    v_appointment_id uuid;
    v_actual_end     time;
    v_duration       integer;
BEGIN
    IF p_end_time IS NULL THEN
        SELECT duration_minutes INTO v_duration FROM appointment_types WHERE id = p_type_id;
        v_actual_end := p_start_time + (COALESCE(v_duration, 30) || ' minutes')::interval;
    ELSE
        v_actual_end := p_end_time;
    END IF;

    -- Serializa requests concorrentes para o mesmo médico+data
    PERFORM pg_advisory_xact_lock(hashtext(p_doctor_id::text || p_date::text));

    -- Overlap real por faixa de horário
    IF EXISTS (
        SELECT 1 FROM appointments
        WHERE doctor_id = p_doctor_id
          AND tenant_id = p_tenant_id
          AND date = p_date
          AND status NOT IN ('canceled', 'cancelled', 'noshow', 'no_show')
          AND start_time < v_actual_end
          AND end_time > p_start_time
    ) THEN
        RETURN jsonb_build_object('success', false, 'reason', 'SLOT_CONFLICT');
    END IF;

    -- Verificar férias/ausências do profissional
    IF EXISTS (
        SELECT 1 FROM doctor_absences
        WHERE doctor_id = p_doctor_id
          AND tenant_id = p_tenant_id
          AND p_date BETWEEN start_date AND end_date
    ) THEN
        RETURN jsonb_build_object('success', false, 'reason', 'DOCTOR_ABSENT');
    END IF;

    -- Precisa estar dentro de um bloco de disponibilidade não-bloqueado
    IF NOT EXISTS (
        SELECT 1 FROM doctor_availability
        WHERE doctor_id = p_doctor_id
          AND location_id = p_location_id
          AND COALESCE(block_type, 'regular') != 'blocked'
          AND (
                day_of_week = EXTRACT(ISODOW FROM p_date)::int
             OR (EXTRACT(ISODOW FROM p_date)::int = 7 AND day_of_week = 0)
          )
          AND start_time <= p_start_time
          AND end_time   >= v_actual_end
    ) THEN
        RETURN jsonb_build_object('success', false, 'reason', 'OUTSIDE_AVAILABILITY');
    END IF;

    INSERT INTO appointments (
        tenant_id, patient_id, doctor_id, location_id, type_id,
        date, start_time, end_time, status, notes, booked_by
    ) VALUES (
        p_tenant_id, p_patient_id, p_doctor_id, p_location_id, p_type_id,
        p_date, p_start_time, v_actual_end, 'scheduled', p_notes, p_booked_by
    ) RETURNING id INTO v_appointment_id;

    RETURN jsonb_build_object('success', true, 'appointment_id', v_appointment_id);

EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'reason', 'SLOT_CONFLICT');
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'reason', SQLERRM);
END;
$$;

-- 4. Batch booking function with rollback capability on conflict
CREATE OR REPLACE FUNCTION book_recurring_appointments(
    p_tenant_id uuid,
    p_patient_id uuid,
    p_appointments jsonb,
    p_booked_by text DEFAULT 'user'
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    v_appt jsonb;
    v_appt_id uuid;
    v_doctor_id uuid;
    v_location_id uuid;
    v_type_id uuid;
    v_date date;
    v_start_time time;
    v_end_time time;
    v_notes text;
    v_patient_type text;
    v_insurance_plan_id uuid;
    v_slot_type text;
    v_recurrence_index int;
    v_recurrence_pattern text;
    v_recurring_group_id uuid;
    v_actual_end time;
    v_duration integer;
    v_booked_ids uuid[] := array[]::uuid[];
    v_conflict_info jsonb;
BEGIN
    v_recurring_group_id := uuid_generate_v4();

    FOR v_appt IN SELECT * FROM jsonb_array_elements(p_appointments) LOOP
        v_doctor_id := (v_appt->>'doctor_id')::uuid;
        v_location_id := (v_appt->>'location_id')::uuid;
        v_type_id := (v_appt->>'type_id')::uuid;
        v_date := (v_appt->>'date')::date;
        v_start_time := (v_appt->>'start_time')::time;
        v_notes := v_appt->>'notes';
        v_patient_type := v_appt->>'patient_type';
        v_insurance_plan_id := (v_appt->>'insurance_plan_id')::uuid;
        v_slot_type := v_appt->>'slot_type';
        v_recurrence_index := (v_appt->>'recurrence_index')::int;
        v_recurrence_pattern := v_appt->>'recurrence_pattern';
        
        IF v_appt->>'end_time' IS NOT NULL THEN
            v_actual_end := (v_appt->>'end_time')::time;
        ELSE
            SELECT duration_minutes INTO v_duration FROM appointment_types WHERE id = v_type_id;
            v_actual_end := v_start_time + (COALESCE(v_duration, 30) || ' minutes')::interval;
        END IF;

        -- Serializa requests concorrentes para o mesmo médico+data
        PERFORM pg_advisory_xact_lock(hashtext(v_doctor_id::text || v_date::text));

        -- 1. Check strict conflict
        IF EXISTS (
            SELECT 1 FROM appointments
            WHERE doctor_id = v_doctor_id
              AND tenant_id = p_tenant_id
              AND date = v_date
              AND status NOT IN ('canceled', 'cancelled', 'noshow', 'no_show')
              AND start_time < v_actual_end
              AND end_time > v_start_time
        ) THEN
            v_conflict_info := jsonb_build_object(
                'success', false,
                'reason', 'SLOT_CONFLICT',
                'date', v_date,
                'start_time', v_start_time
            );
            RAISE EXCEPTION 'conflict: %', v_conflict_info::text;
        END IF;

        -- 2. Check doctor absence
        IF EXISTS (
            SELECT 1 FROM doctor_absences
            WHERE doctor_id = v_doctor_id
              AND tenant_id = p_tenant_id
              AND v_date BETWEEN start_date AND end_date
        ) THEN
            v_conflict_info := jsonb_build_object(
                'success', false,
                'reason', 'DOCTOR_ABSENT',
                'date', v_date,
                'start_time', v_start_time
            );
            RAISE EXCEPTION 'conflict: %', v_conflict_info::text;
        END IF;

        -- 3. Check availability
        IF NOT EXISTS (
            SELECT 1 FROM doctor_availability
            WHERE doctor_id = v_doctor_id
              AND location_id = v_location_id
              AND COALESCE(block_type, 'regular') != 'blocked'
              AND (
                    day_of_week = EXTRACT(ISODOW FROM v_date)::int
                 OR (EXTRACT(ISODOW FROM v_date)::int = 7 AND day_of_week = 0)
              )
              AND start_time <= v_start_time
              AND end_time   >= v_actual_end
        ) THEN
            v_conflict_info := jsonb_build_object(
                'success', false,
                'reason', 'OUTSIDE_AVAILABILITY',
                'date', v_date,
                'start_time', v_start_time
            );
            RAISE EXCEPTION 'conflict: %', v_conflict_info::text;
        END IF;

        -- 4. Insert appointment
        INSERT INTO appointments (
            tenant_id, patient_id, doctor_id, location_id, type_id,
            date, start_time, end_time, status, notes, booked_by,
            patient_type, insurance_plan_id, slot_type,
            recurring_group_id, recurrence_pattern, recurrence_index
        ) VALUES (
            p_tenant_id, p_patient_id, v_doctor_id, v_location_id, v_type_id,
            v_date, v_start_time, v_actual_end, 'scheduled', v_notes, p_booked_by,
            v_patient_type, v_insurance_plan_id, v_slot_type,
            v_recurring_group_id, v_recurrence_pattern, v_recurrence_index
        ) RETURNING id INTO v_appt_id;

        v_booked_ids := array_append(v_booked_ids, v_appt_id);
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'recurring_group_id', v_recurring_group_id,
        'appointment_ids', to_jsonb(v_booked_ids)
    );

EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE 'conflict: %' THEN
            RETURN SUBSTRING(SQLERRM FROM 11)::jsonb;
        ELSE
            RETURN jsonb_build_object('success', false, 'reason', SQLERRM);
        END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION book_recurring_appointments(uuid, uuid, jsonb, text) TO service_role, authenticated;
