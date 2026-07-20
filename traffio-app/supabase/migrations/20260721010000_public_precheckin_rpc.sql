-- Migration: Public Pre-Checkin RPC functions (Bulletproof schema-independent implementation using to_jsonb)
-- Grants anon users secure access to load appointment & complete check-in without exposing entire tables

CREATE OR REPLACE FUNCTION get_public_precheckin_data(p_appointment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_apt RECORD;
    v_patient RECORD;
    v_tenant RECORD;
    v_locations JSONB;
    v_result JSONB;
BEGIN
    -- 1. Fetch Appointment
    SELECT * INTO v_apt
    FROM public.appointments
    WHERE id = p_appointment_id;

    IF v_apt.id IS NULL THEN
        RAISE EXCEPTION 'Appointment not found';
    END IF;

    -- 2. Fetch Patient
    SELECT * INTO v_patient
    FROM public.patients
    WHERE id = v_apt.patient_id;

    -- 3. Fetch Tenant
    SELECT * INTO v_tenant
    FROM public.tenants
    WHERE id = v_apt.tenant_id;

    -- 4. Fetch Active Locations with Coordinates
    SELECT COALESCE(jsonb_agg(to_jsonb(l)), '[]'::jsonb) INTO v_locations
    FROM public.locations l
    WHERE l.tenant_id = v_apt.tenant_id
      AND l.is_active = TRUE
      AND l.latitude IS NOT NULL
      AND l.longitude IS NOT NULL;

    -- 5. Build Result JSON using to_jsonb (prevents 42703 undefined_column errors)
    v_result := jsonb_build_object(
        'appointment', to_jsonb(v_apt),
        'patient', to_jsonb(v_patient),
        'tenant', to_jsonb(v_tenant),
        'locations', v_locations
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_precheckin_data(UUID) TO anon, authenticated;

-- Confirm check-in RPC
CREATE OR REPLACE FUNCTION confirm_public_checkin(p_appointment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.appointments
    SET status = 'confirmed',
        updated_at = NOW()
    WHERE id = p_appointment_id;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_public_checkin(UUID) TO anon, authenticated;
