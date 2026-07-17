-- Disponibilidade com relógio LOCAL da clínica + buffer configurável.
--
-- Bugs corrigidos (vistos em produção 2026-07-16, tenant Pacific/Auckland):
--  1. O filtro de "passado" comparava com CURRENT_DATE (UTC do servidor). Para
--     clínicas com data local ≠ data UTC (ex.: Auckland UTC+12), TODOS os slots
--     do dia local passavam — o agente oferecia horários no passado.
--     Agora compara com p_from_date, que o caller envia como o "hoje" LOCAL.
--  2. p_current_time nunca era enviado pelos callers e o buffer era fixo em
--     30min. Novo p_buffer_minutes (default 30) permite respeitar
--     tenants.booking_min_lead_minutes (Settings > Clínicas).
--
-- DROP + CREATE (não OR REPLACE) para não deixar overload ambíguo no PostgREST.

DROP FUNCTION IF EXISTS public.find_next_available_dates(uuid, date, integer, integer, uuid, time without time zone);

CREATE FUNCTION public.find_next_available_dates(
    p_doctor_id uuid,
    p_from_date date DEFAULT CURRENT_DATE,
    p_limit integer DEFAULT 3,
    p_duration_minutes integer DEFAULT 30,
    p_location_id uuid DEFAULT NULL::uuid,
    p_current_time time without time zone DEFAULT NULL::time without time zone,
    p_buffer_minutes integer DEFAULT 30
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_result JSON;
    v_buffer TIME;
BEGIN
    IF p_current_time IS NULL THEN
        v_buffer := '00:00'::time;
    ELSE
        v_buffer := p_current_time + make_interval(mins => GREATEST(COALESCE(p_buffer_minutes, 30), 0));
        -- time + interval dá wrap na meia-noite: 23:50 + 30min = 00:20.
        -- Se deu wrap, nada de hoje serve mais.
        IF v_buffer < p_current_time THEN
            v_buffer := '23:59:59'::time;
        END IF;
    END IF;

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
            da.location_id,
            COALESCE(da.block_type, 'regular') AS block_type
        FROM candidate_dates cd
        JOIN doctor_availability da
          ON  da.doctor_id   = p_doctor_id
         AND  da.is_active   = true
         AND  COALESCE(da.block_type, 'regular') != 'blocked'
         AND  (p_location_id IS NULL OR da.location_id = p_location_id)
         AND  (
                   da.day_of_week = EXTRACT(ISODOW FROM cd.check_date)::int
               OR (EXTRACT(ISODOW FROM cd.check_date)::int = 7 AND da.day_of_week = 0)
              )
    ),
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
                 interval '15 minutes'
             ) AS slot_ts
        -- p_from_date é o "hoje" LOCAL da clínica (enviado pelo caller no fuso
        -- do tenant) — nunca CURRENT_DATE, que é UTC.
        WHERE dwa.check_date > p_from_date
           OR (dwa.check_date = p_from_date AND slot_ts::time >= v_buffer)
    ),
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
    dates_with_slots AS (
        SELECT
            swa.check_date,
            swa.location_id,
            COALESCE(l.name, 'Principal')                                          AS location_name,
            json_agg(
                json_build_object(
                    'time',       swa.slot_time,
                    'available',  swa.available,
                    'block_type', swa.block_type
                ) ORDER BY swa.slot_time
            )                                                                      AS slots,
            EXTRACT(HOUR FROM MIN(swa.slot_start))::int                            AS start_hour,
            EXTRACT(HOUR FROM MAX(swa.slot_start))::int                            AS end_hour,
            COUNT(*) FILTER (WHERE swa.available)::int                             AS slot_count
        FROM slots_with_availability swa
        LEFT JOIN locations l ON l.id = swa.location_id
        GROUP BY swa.check_date, swa.location_id, l.name
        HAVING COUNT(*) FILTER (WHERE swa.available) > 0
        ORDER BY swa.check_date, l.name
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
$function$;
