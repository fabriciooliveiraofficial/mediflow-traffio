-- =============================================================================
-- TRAFFIO MEDICAL - UPGRADE: SLOTS BLOQUEADOS E MÚLTIPLOS BLOCOS
-- =============================================================================

-- 1. ADICIONAR COLUNA block_type (se não existir) E ATUALIZAR CONSTRAINT
-- Garante que 'blocked' seja um tipo válido.
ALTER TABLE doctor_availability 
    ADD COLUMN IF NOT EXISTS block_type TEXT DEFAULT 'regular';

-- Ajustar a constraint UNIQUE para permitir múltiplos blocos no mesmo dia e local
-- (Agora diferenciados pelo horário de início)
ALTER TABLE doctor_availability 
    DROP CONSTRAINT IF EXISTS doctor_avail_unique;

ALTER TABLE doctor_availability 
    ADD CONSTRAINT doctor_avail_start_unique 
    UNIQUE(doctor_id, tenant_id, location_id, day_of_week, start_time);


-- 2. ATUALIZAR get_available_slots PARA SUPORTAR MÚLTIPLOS BLOCOS E FILTRAR BLOQUEIOS
-- Essa função agora percorre TODOS os blocos do dia que NÃO são 'blocked'.
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
    v_slots := ARRAY[]::JSON[];

    -- Loop por todos os blocos de disponibilidade do médico (exceto bloqueios)
    FOR v_availability IN 
        SELECT start_time, end_time 
        FROM doctor_availability
        WHERE doctor_id = p_doctor_id
          AND tenant_id = p_tenant_id
          AND location_id = p_location_id
          AND day_of_week = EXTRACT(DOW FROM p_date)::integer
          AND block_type != 'blocked'
          AND is_active = true
        ORDER BY start_time
    LOOP
        v_current_time := v_availability.start_time;

        WHILE v_current_time + (p_slot_duration || ' minutes')::interval <= v_availability.end_time LOOP
            -- Verificar se o slot está livre de agendamentos
            SELECT NOT EXISTS (
                SELECT 1 FROM appointments
                WHERE doctor_id = p_doctor_id
                  AND tenant_id = p_tenant_id
                  AND date = p_date
                  AND status NOT IN ('canceled', 'noshow')
                  AND start_time < (v_current_time + (p_slot_duration || ' minutes')::interval)
                  AND end_time > v_current_time
            ) INTO v_is_free;

            -- Adicionar slot à lista
            v_slots := array_append(v_slots, json_build_object(
                'time', v_current_time::text,
                'end_time', (v_current_time + (p_slot_duration || ' minutes')::interval)::text,
                'available', v_is_free
            ));

            v_current_time := v_current_time + (p_slot_duration || ' minutes')::interval;
        END LOOP;
    END LOOP;

    RETURN json_build_object('success', true, 'slots', array_to_json(v_slots));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. ATUALIZAR find_next_available_dates (V2) PARA FILTRAR BLOQUEIOS
-- Utilizada pelo Agente IA (clinicalAgent.ts).
CREATE OR REPLACE FUNCTION find_next_available_dates(
    p_doctor_id      UUID,
    p_from_date      DATE    DEFAULT CURRENT_DATE,
    p_limit          INTEGER DEFAULT 3,
    p_duration_minutes INTEGER DEFAULT 30
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH
    candidate_dates AS (
        SELECT d::date AS check_date
        FROM generate_series(p_from_date, p_from_date + 180, '1 day'::interval) d
    ),
    dates_with_availability AS (
        SELECT
            cd.check_date,
            da.start_time,
            da.end_time,
            da.location_id
        FROM candidate_dates cd
        JOIN doctor_availability da
          ON da.doctor_id = p_doctor_id
         AND da.is_active = true
         AND da.block_type != 'blocked' -- FILTRO DE BLOQUEIO ADICIONADO AQUI
         AND (
               da.day_of_week = EXTRACT(ISODOW FROM cd.check_date)::int
            OR (EXTRACT(ISODOW FROM cd.check_date)::int = 7 AND da.day_of_week = 0)
         )
    ),
    all_slots AS (
        SELECT
            dwa.check_date,
            slot_ts::time AS slot_start,
            (slot_ts + (p_duration_minutes || ' minutes')::interval)::time AS slot_end,
            dwa.location_id
        FROM dates_with_availability dwa,
             generate_series(
                 ('2000-01-01'::date + dwa.start_time)::timestamp,
                 ('2000-01-01'::date + dwa.end_time
                      - (p_duration_minutes || ' minutes')::interval)::timestamp,
                 (p_duration_minutes || ' minutes')::interval
             ) AS slot_ts
    ),
    free_slots AS (
        SELECT
            s.check_date,
            to_char(s.slot_start, 'HH24:MI') AS slot_time,
            s.location_id
        FROM all_slots s
        WHERE NOT EXISTS (
            SELECT 1
            FROM appointments a
            WHERE a.doctor_id = p_doctor_id
              AND a.date       = s.check_date
              AND a.status NOT IN ('canceled', 'cancelled', 'noshow', 'no_show')
              AND a.start_time < s.slot_end
              AND a.end_time   > s.slot_start
        )
    ),
    dates_with_slots AS (
        SELECT
            fs.check_date,
            fs.location_id,
            l.name AS location_name,
            json_agg(fs.slot_time ORDER BY fs.slot_time) AS slots,
            COUNT(*)::int AS slot_count
        FROM free_slots fs
        JOIN locations l ON l.id = fs.location_id
        GROUP BY fs.check_date, fs.location_id, l.name
        HAVING COUNT(*) > 0
        ORDER BY fs.check_date, l.name
    ),
    limited_dates AS (
        SELECT DISTINCT check_date
        FROM dates_with_slots
        ORDER BY check_date
        LIMIT p_limit
    )
    SELECT json_agg(
        json_build_object(
            'date',          to_char(dws.check_date, 'YYYY-MM-DD'),
            'location_id',   dws.location_id,
            'location_name', dws.location_name,
            'slots',         dws.slots,
            'slot_count',    dws.slot_count
        )
        ORDER BY dws.check_date, dws.location_name
    )
    INTO v_result
    FROM dates_with_slots dws
    JOIN limited_dates ld ON ld.check_date = dws.check_date;

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;
