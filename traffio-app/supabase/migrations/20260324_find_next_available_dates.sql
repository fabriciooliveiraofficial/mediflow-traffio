-- ============================================================
-- find_next_available_dates
-- Replaces 90 sequential get_available_slots() RPC calls with
-- a single query. Returns the first `p_limit` dates that have
-- at least one free slot, along with the available slot times.
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

    -- 1. Generate candidate dates for the next 90 days
    candidate_dates AS (
        SELECT d::date AS check_date
        FROM generate_series(p_from_date, p_from_date + 90, '1 day'::interval) d
    ),

    -- 2. Match each date to the doctor's availability blocks for that day of week.
    --    Uses ISODOW (Mon=1..Sat=6, Sun=7) consistent with get_available_slots().
    --    Also handles legacy Sunday stored as 0 (DOW convention).
    dates_with_availability AS (
        SELECT
            cd.check_date,
            da.start_time,
            da.end_time
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
            (slot_ts + (p_duration_minutes || ' minutes')::interval)::time AS slot_end
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
            to_char(s.slot_start, 'HH24:MI') AS slot_time
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

    -- 5. Group by date, aggregate slots, keep only the first p_limit dates
    dates_with_slots AS (
        SELECT
            check_date,
            json_agg(slot_time ORDER BY slot_time) AS slots,
            COUNT(*)::int AS slot_count
        FROM free_slots
        GROUP BY check_date
        HAVING COUNT(*) > 0
        ORDER BY check_date
        LIMIT p_limit
    )

    SELECT json_agg(
        json_build_object(
            'date',       to_char(check_date, 'YYYY-MM-DD'),
            'slots',      slots,
            'slot_count', slot_count
        )
        ORDER BY check_date
    )
    INTO v_result
    FROM dates_with_slots;

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- Grant execution to the service role used by Edge Functions
GRANT EXECUTE ON FUNCTION find_next_available_dates(UUID, DATE, INTEGER, INTEGER)
    TO service_role;
