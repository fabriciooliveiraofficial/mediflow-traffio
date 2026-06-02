-- Drop the conflicting overload that has a different parameter order
-- (p_doctor_id, p_location_id, p_duration_minutes, p_limit, p_from_date, p_current_time)
-- which conflicts with the canonical v5 signature
DROP FUNCTION IF EXISTS find_next_available_dates(UUID, UUID, INTEGER, INTEGER, DATE, TIME);
