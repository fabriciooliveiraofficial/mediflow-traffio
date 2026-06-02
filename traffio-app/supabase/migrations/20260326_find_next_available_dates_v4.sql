-- =============================================================================
-- TRAFFIO MEDICAL - find_next_available_dates V4
-- Yield Management: expõe prime_slots e regular_slots separados por block_type.
-- O agente IA usa esses campos para priorizar horários por tipo de paciente.
-- =============================================================================

CREATE OR REPLACE FUNCTION find_next_available_dates(
    p_doctor_id        UUID,
    p_from_date        DATE    DEFAULT CURRENT_DATE,
    p_limit            INTEGER DEFAULT 3,
    p_duration_minutes INTEGER DEFAULT 30,
    p_current_time     TIME    DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result    JSON;
    v_buffer    TIME;
BEGIN
    v_buffer := COALESCE(p_current_time + interval '30 minutes', '00:00'::time);

    WITH

    -- 1. Candidate dates over 180-day window
    candidate_dates AS (
        SELECT d::date AS check_date
        FROM generate_series(p_from_date, p_from_date + 180, '1 day'::interval) d
    ),

    -- 2. Match availability blocks (exclude 'blocked'), now including block_type
    dates_with_availability AS (
        SELECT
            cd.check_date,
            da.start_time,
            da.end_time,
            da.location_id,
            COALESCE(da.block_type, 'regular') AS block_type
        FROM candidate_dates cd
        JOIN doctor_availability da
          ON da.doctor_id = p_doctor_id
         AND da.is_active  = true
         AND COALESCE(da.block_type, 'regular') != 'blocked'
         AND (
               da.day_of_week = EXTRACT(ISODOW FROM cd.check_date)::int
            OR (EXTRACT(ISODOW FROM cd.check_date)::int = 7 AND da.day_of_week = 0)
         )
    ),

    -- 3. Generate every slot within each block, apply time buffer for today
    all_slots AS (
        SELECT
            dwa.check_date,
            slot_ts::time          AS slot_start,
            (slot_ts + (p_duration_minutes || ' minutes')::interval)::time AS slot_end,
            dwa.location_id,
            dwa.block_type
        FROM dates_with_availability dwa,
             generate_series(
                 ('2000-01-01'::date + dwa.start_time)::timestamp,
                 ('2000-01-01'::date + dwa.end_time
                      - (p_duration_minutes || ' minutes')::interval)::timestamp,
                 (p_duration_minutes || ' minutes')::interval
             ) AS slot_ts
        WHERE
            (dwa.check_date > CURRENT_DATE)
            OR (dwa.check_date = CURRENT_DATE AND slot_ts::time >= v_buffer)
    ),

    -- 4. Filter out booked slots
    free_slots AS (
        SELECT
            s.check_date,
            to_char(s.slot_start, 'HH24:MI') AS slot_time,
            s.location_id,
            s.block_type
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

    -- 5. Group by (date, location), aggregate prime and regular slots separately
    dates_with_slots AS (
        SELECT
            fs.check_date,
            fs.location_id,
            l.name AS location_name,
            json_agg(fs.slot_time ORDER BY fs.slot_time)
                FILTER (WHERE fs.block_type = 'prime')   AS prime_slots,
            json_agg(fs.slot_time ORDER BY fs.slot_time)
                FILTER (WHERE fs.block_type != 'prime')  AS regular_slots,
            COUNT(*)::int AS slot_count
        FROM free_slots fs
        JOIN locations l ON l.id = fs.location_id
        GROUP BY fs.check_date, fs.location_id, l.name
        HAVING COUNT(*) > 0
        ORDER BY fs.check_date, l.name
    ),

    -- 6. Limit to first p_limit distinct dates
    limited_dates AS (
        SELECT DISTINCT check_date
        FROM dates_with_slots
        ORDER BY check_date
        LIMIT p_limit
    )

    SELECT json_agg(
        json_build_object(
            'date',           to_char(dws.check_date, 'YYYY-MM-DD'),
            'location_id',    dws.location_id,
            'location_name',  dws.location_name,
            'prime_slots',    COALESCE(dws.prime_slots,   '[]'::json),
            'regular_slots',  COALESCE(dws.regular_slots, '[]'::json),
            'slot_count',     dws.slot_count
        )
        ORDER BY dws.check_date, dws.location_name
    )
    INTO v_result
    FROM dates_with_slots dws
    JOIN limited_dates ld ON ld.check_date = dws.check_date;

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION find_next_available_dates(UUID, DATE, INTEGER, INTEGER, TIME)
    TO service_role;
