-- Migration: 40_crud_engine.sql
-- Description: Standardized RPCs for Clinical Agent (World-Class CRUD)

-- 1. UPSERT PATIENT (Secure)
-- Ensures patient exists and updates contact info if needed.
CREATE OR REPLACE FUNCTION rpc_upsert_patient(
    p_phone TEXT,
    p_name TEXT DEFAULT NULL,
    p_document TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_patient_id UUID;
    v_tenant_id UUID;
BEGIN
    -- Resolve tenant from current context or fail safely (mocking tenant resolution for RPC context)
    -- In production, this might come from a session variable or be passed. 
    -- For now, we assume the phone is unique per tenant, OR we search globally if unique constraints allow.
    -- Better strategy: Search by phone first.
    
    SELECT id, tenant_id INTO v_patient_id, v_tenant_id
    FROM patients 
    WHERE phone = p_phone 
    LIMIT 1;

    IF v_patient_id IS NOT NULL THEN
        -- Update existing
        UPDATE patients 
        SET 
            full_name = COALESCE(p_name, full_name),
            document_number = COALESCE(p_document, document_number),
            updated_at = NOW()
        WHERE id = v_patient_id;
        
        RETURN jsonb_build_object('id', v_patient_id, 'status', 'updated', 'details', 'Patient info updated');
    ELSE
        -- Insert new (requires tenant_id context, usually passed or inferred. 
        -- For this RPC to be 'world class', it ideally needs tenant_id p_tenant_id.
        -- We will FAIL here if we can't infer, but for now let's return error if not found to force higher level resolution)
        RETURN jsonb_build_object('status', 'error', 'message', 'Patient not found and tenant_id not provided for creation.');
    END IF;
END;
$$;

-- Overload for creating with Tenant ID (Clean Architecture)
CREATE OR REPLACE FUNCTION rpc_register_patient(
    p_tenant_id UUID,
    p_phone TEXT,
    p_name TEXT,
    p_document TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_patient_id UUID;
BEGIN
    INSERT INTO patients (tenant_id, phone, full_name, document_number)
    VALUES (p_tenant_id, p_phone, p_name, p_document)
    ON CONFLICT (tenant_id, phone) DO UPDATE
    SET 
        full_name = EXCLUDED.full_name,
        document_number = COALESCE(EXCLUDED.document_number, patients.document_number),
        updated_at = NOW()
    RETURNING id INTO v_patient_id;

    RETURN jsonb_build_object('id', v_patient_id, 'status', 'success');
END;
$$;


-- 2. CANCEL APPOINTMENT (Secure Owner Check)
CREATE OR REPLACE FUNCTION rpc_cancel_appointment_by_patient(
    p_appointment_id UUID,
    p_patient_phone TEXT,
    p_reason TEXT DEFAULT 'Solicitado via WhatsApp'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_appt_patient_phone TEXT;
BEGIN
    -- Verify ownership
    SELECT p.phone INTO v_appt_patient_phone
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    WHERE a.id = p_appointment_id;

    IF v_appt_patient_phone IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'message', 'Appointment not found');
    END IF;

    IF v_appt_patient_phone != p_patient_phone THEN
         RETURN jsonb_build_object('status', 'error', 'message', 'Unauthorized: Phone mismatch');
    END IF;

    -- Execute Cancellation
    UPDATE appointments
    SET 
        status = 'cancelled',
        cancellation_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_appointment_id;

    RETURN jsonb_build_object('status', 'success', 'message', 'Appointment cancelled successfully');
END;
$$;


-- 3. FIND PATIENT APPOINTMENTS (Future only)
CREATE OR REPLACE FUNCTION rpc_find_patient_appointments(
    p_phone TEXT
)
RETURNS TABLE (
    appointment_id UUID,
    doctor_name TEXT,
    specialty TEXT,
    appointment_date DATE,
    start_time TIME,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        p.full_name as doctor_name,
        s.name as specialty,
        a.appointment_date,
        a.start_time,
        a.status
    FROM appointments a
    JOIN patients pat ON a.patient_id = pat.id
    JOIN professionals p ON a.professional_id = p.id
    LEFT JOIN specialties s ON p.specialty_id = s.id
    WHERE pat.phone = p_phone
      AND a.appointment_date >= CURRENT_DATE
      AND a.status NOT IN ('cancelled', 'completed')
    ORDER BY a.appointment_date ASC, a.start_time ASC;
END;
$$;


-- 4. GET PROFESSIONAL AVAILABILITY (Heatmap Logic)
-- Returns count of available slots per day for next 30 days
CREATE OR REPLACE FUNCTION rpc_get_availability_heatmap(
    p_specialty_id UUID,
    p_tenant_id UUID
)
RETURNS TABLE (
    available_date DATE,
    slots_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- This is a simplified logic. In real world, we check `slots` table or `availabilities` rules.
    -- Assuming a `slots` table exists or generating series.
    -- For this phase, we look at the master schedule generation.
    
    -- MOCK IMPLEMENTATION (replace with real slots join)
    RETURN QUERY
    SELECT 
        CURRENT_DATE + (i || ' days')::interval as available_date,
        (5 + (random() * 5)::int)::int as slots_count -- Mock data: 5-10 slots avail
    FROM generate_series(1, 14) i;
END;
$$;
