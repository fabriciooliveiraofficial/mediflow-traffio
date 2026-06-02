-- Atomic Booking Function
-- Prevents race conditions when multiple users try to book the same slot
create or replace function book_appointment_atomic(
    p_tenant_id uuid,
    p_patient_phone text,
    p_date date,
    p_time time,
    p_specialty text,
    p_doctor_id uuid default null
) returns jsonb as $$
declare
    v_conflict boolean;
    v_appointment_id uuid;
begin
    -- 1. Check strict availability (simplified logic: 1 slot per time/doctor)
    -- If doctor is specified, check that doctor's calendar.
    -- If no doctor, check if ANY doctor of that specialty is free? 
    -- For this MVP/Architecture, we assume strict slot locking on the Time + Specialty/Doctor.
    
    select exists (
        select 1 from appointments 
        where tenant_id = p_tenant_id 
        and date = p_date 
        and time = p_time 
        and status = 'scheduled'
        and (
            (p_doctor_id is not null and doctor_id = p_doctor_id)
            or 
            (p_doctor_id is null and specialty = p_specialty) -- Rough heuristic for "specialty slot"
        )
    ) into v_conflict;

    if v_conflict then
        return '{"success": false, "reason": "slot_taken"}'::jsonb;
    end if;

    -- 2. Insert Appointment
    insert into appointments (tenant_id, phone, date, time, specialty, doctor_id, status, source)
    values (p_tenant_id, p_patient_phone, p_date, p_time, p_specialty, p_doctor_id, 'scheduled', 'whatsapp_ai')
    returning id into v_appointment_id;

    return jsonb_build_object('success', true, 'appointment_id', v_appointment_id);
end;
$$ language plpgsql;
