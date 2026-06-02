-- ============================================================
-- find_next_available_dates V2
-- Enhancements:
--   1. Expands search window from 90 → 180 days
--   2. Returns location_id + location_name per slot group
--   3. Groups results by (date, location) for multi-unit comparison
-- ============================================================

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

    -- 1. Generate candidate dates for the next 180 days
    candidate_dates AS (
        SELECT d::date AS check_date
        FROM generate_series(p_from_date, p_from_date + 180, '1 day'::interval) d
    ),

    -- 2. Match each date to the doctor's availability blocks for that day of week.
    --    Uses ISODOW (Mon=1..Sat=6, Sun=7) consistent with get_available_slots().
    --    Also handles legacy Sunday stored as 0 (DOW convention).
    --    NOW includes location_id from the availability record.
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
         AND (
               da.day_of_week = EXTRACT(ISODOW FROM cd.check_date)::int
               -- Sunday: ISODOW=7 but may be stored as 0
            OR (EXTRACT(ISODOW FROM cd.check_date)::int = 7 AND da.day_of_week = 0)
         )
    ),

    -- 3. Generate every slot inside each availability block
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

    -- 4. Filter to slots that are NOT already booked
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

    -- 5. Group by (date, location), aggregate slots
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

    -- 6. Pick the first p_limit distinct dates (may have multiple locations per date)
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

-- Grant execution to the service role used by Edge Functions
GRANT EXECUTE ON FUNCTION find_next_available_dates(UUID, DATE, INTEGER, INTEGER)
    TO service_role;
