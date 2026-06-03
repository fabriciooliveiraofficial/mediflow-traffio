-- =============================================================================
-- TRAFFIO MEDICAL — find_next_available_dates V5
--
-- Changes from v4:
--   • Adds p_location_id (optional) — filters slots to a specific location
--   • Returns unified `slots` array: [{ time, available, block_type }]
--     instead of the split prime_slots / regular_slots used by v4
--   • Returns start_hour / end_hour for the agenda grid bounds
--   • Drops the v4 signature to avoid PostgREST overload ambiguity
--
-- Consumers:
--   • SidebarBookingView (loadSlotsForDate, loadAvailableDatesMarkers)
--   • AI chatAgent (find_next_available_dates tool)
-- =============================================================================

-- Drop the old v4 signature first to prevent PostgREST ambiguity
DROP FUNCTION IF EXISTS find_next_available_dates(UUID, DATE, INTEGER, INTEGER, TIME);

CREATE OR REPLACE FUNCTION find_next_available_dates(
    p_doctor_id        UUID,
    p_from_date        DATE    DEFAULT CURRENT_DATE,
    p_limit            INTEGER DEFAULT 3,
    p_duration_minutes INTEGER DEFAULT 30,
    p_location_id      UUID    DEFAULT NULL,
    p_current_time     TIME    DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
    v_buffer TIME;
BEGIN
    -- Add a 30-minute buffer for current-day slots so we don't show slots
    -- that are in the past or about to start.
    v_buffer := COALESCE(p_current_time + interval '30 minutes', '00:00'::time);

    WITH

    -- 1. Candidate dates over a 180-day window starting from p_from_date
    candidate_dates AS (
        SELECT d::date AS check_date
        FROM generate_series(p_from_date, p_from_date + 180, '1 day'::interval) d
    ),

    -- 2. Match doctor_availability blocks for the given doctor (+ optional location filter).
    --    Handles both ISODOW convention (1=Mon...6=Sat) and JS convention (0=Sun).
    --    Excludes 'blocked' type blocks entirely.
    dates_with_availability AS (
        SELECT
            cd.check_date,
            da.start_time,
            da.end_time,
            da.location_id,
            COALESCE(da.block_type, 'regular') AS block_type
        FROM candidate_dates cd
        JOIN doctor_availability da
          ON  da.doctor_id   = p_doctor_id
         AND  COALESCE(da.block_type, 'regular') != 'blocked'
         AND  (p_location_id IS NULL OR da.location_id = p_location_id)
         AND  (
                   da.day_of_week = EXTRACT(ISODOW FROM cd.check_date)::int
               OR (EXTRACT(ISODOW FROM cd.check_date)::int = 7 AND da.day_of_week = 0)
              )
    ),

    -- 3. Generate every slot within each block.
    --    Slots from today that are before v_buffer are discarded.
    all_slots AS (
        SELECT
            dwa.check_date,
            slot_ts::time                                                          AS slot_start,
            (slot_ts + (p_duration_minutes || ' minutes')::interval)::time        AS slot_end,
            to_char(slot_ts::time, 'HH24:MI')                                     AS slot_time,
            dwa.location_id,
            dwa.block_type
        FROM dates_with_availability dwa,
             generate_series(
                 ('2000-01-01'::date + dwa.start_time)::timestamp,
                 ('2000-01-01'::date + dwa.end_time
                      - (p_duration_minutes || ' minutes')::interval)::timestamp,
                 (p_duration_minutes || ' minutes')::interval
             ) AS slot_ts
        WHERE dwa.check_date > CURRENT_DATE
           OR (dwa.check_date = CURRENT_DATE AND slot_ts::time >= v_buffer)
    ),

    -- 4. Mark each slot as available (not booked) or unavailable.
    --    A doctor cannot have two overlapping appointments regardless of location.
    slots_with_availability AS (
        SELECT
            s.check_date,
            s.slot_start,
            s.slot_time,
            s.location_id,
            s.block_type,
            NOT EXISTS (
                SELECT 1
                FROM appointments a
                WHERE a.doctor_id = p_doctor_id
                  AND a.date       = s.check_date
                  AND a.status NOT IN ('canceled', 'cancelled', 'noshow', 'no_show')
                  AND a.start_time  < s.slot_end
                  AND a.end_time    > s.slot_start
            ) AS available
        FROM all_slots s
    ),

    -- 5. Group by (date, location): build unified slots array + grid bounds.
    --    Only include dates that have at least one available slot.
    dates_with_slots AS (
        SELECT
            swa.check_date,
            swa.location_id,
            l.name                                                             AS location_name,
            json_agg(
                json_build_object(
                    'time',       swa.slot_time,
                    'available',  swa.available,
                    'block_type', swa.block_type
                ) ORDER BY swa.slot_time
            )                                                                  AS slots,
            EXTRACT(HOUR FROM MIN(swa.slot_start))::int                        AS start_hour,
            EXTRACT(HOUR FROM MAX(swa.slot_start))::int                        AS end_hour,
            COUNT(*) FILTER (WHERE swa.available)::int                         AS slot_count
        FROM slots_with_availability swa
        JOIN locations l ON l.id = swa.location_id
        GROUP BY swa.check_date, swa.location_id, l.name
        HAVING COUNT(*) FILTER (WHERE swa.available) > 0
        ORDER BY swa.check_date, l.name
    ),

    -- 6. Limit result to the first p_limit distinct dates that have availability.
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
            'start_hour',    dws.start_hour,
            'end_hour',      dws.end_hour,
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

-- Grant to both service_role (Edge Functions) and authenticated (frontend via Supabase JS)
GRANT EXECUTE ON FUNCTION find_next_available_dates(UUID, DATE, INTEGER, INTEGER, UUID, TIME)
    TO service_role, authenticated;
