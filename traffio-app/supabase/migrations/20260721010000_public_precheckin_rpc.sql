-- Migration: Public Pre-Checkin RPC functions
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
    SELECT name, latitude, longitude, geofence_radius, address INTO v_tenant
    FROM public.tenants
    WHERE id = v_apt.tenant_id;

    -- 4. Fetch Active Locations with Coordinates
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'latitude', l.latitude,
        'longitude', l.longitude
    )), '[]'::jsonb) INTO v_locations
    FROM public.locations l
    WHERE l.tenant_id = v_apt.tenant_id
      AND l.is_active = TRUE
      AND l.latitude IS NOT NULL
      AND l.longitude IS NOT NULL;

    -- 5. Build Result JSON
    v_result := jsonb_build_object(
        'appointment', jsonb_build_object(
            'id', v_apt.id,
            'tenant_id', v_apt.tenant_id,
            'start_time', v_apt.start_time,
            'status', v_apt.status
        ),
        'patient', jsonb_build_object(
            'id', v_patient.id,
            'full_name', v_patient.full_name,
            'national_id', v_patient.national_id,
            'cpf', v_patient.cpf,
            'mobile', v_patient.mobile,
            'phone', v_patient.phone,
            'email', v_patient.email,
            'country', v_patient.country,
            'type', v_patient.type,
            'insurance_provider', v_patient.insurance_provider,
            'insurance_card', v_patient.insurance_card,
            'preferred_locale', v_patient.preferred_locale
        ),
        'tenant', jsonb_build_object(
            'name', COALESCE(v_tenant.name, ''),
            'latitude', v_tenant.latitude,
            'longitude', v_tenant.longitude,
            'geofence_radius', v_tenant.geofence_radius,
            'address', v_tenant.address
        ),
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
