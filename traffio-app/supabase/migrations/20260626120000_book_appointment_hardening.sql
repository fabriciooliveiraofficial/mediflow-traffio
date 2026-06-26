-- ============================================================
-- book_appointment: versão única e consolidada
-- ------------------------------------------------------------
-- Corrige a brecha que permitia agendar (via UI ou API) em horários
-- bloqueados/fora do expediente do profissional, e overlaps parciais
-- (start_time diferente mas faixa de horário colidente).
--
-- O repositório tinha 3 versões divergentes desta função (migrations/
-- 05_anti_double_booking_and_omnichannel.sql, e os scripts de referência
-- DEPLOY_SCHEMA.sql / FIX_SCHEMA.sql na raiz), com proteções diferentes
-- entre si. Esta migration passa a ser a fonte única da verdade, mantendo
-- a assinatura de 10 parâmetros (com p_end_time/p_notes) já usada pelo
-- frontend em smartSchedulingService.bookAppointment().
-- ============================================================

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

    -- Overlap real por faixa de horário (não apenas start_time exato)
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

    -- Precisa estar dentro de um bloco de disponibilidade não-bloqueado
    -- que cubra a faixa inteira solicitada (lunch/blocked carve-outs incluídos)
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

GRANT EXECUTE ON FUNCTION book_appointment(uuid, uuid, uuid, uuid, uuid, date, time, time, text, text)
    TO service_role, authenticated;
