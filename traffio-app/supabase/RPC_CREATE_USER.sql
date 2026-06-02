-- ##########################################################
-- TRAFFIO MEDICAL - RPC CREATE USER (ADMIN BYPASS)
-- ##########################################################
-- Esta função permite criar usuários (Médicos) diretamente via SQL.
-- Contorna a limitação de não ter Edge Functions configuradas.

-- Habilita extensão pgcrypto para hashear senhas (se necessário)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION create_professional_user(
    p_email TEXT,
    p_password TEXT,
    p_full_name TEXT,
    p_phone TEXT,
    p_role TEXT, -- 'doctor' ou 'staff'
    p_specialty TEXT,
    p_crm TEXT,
    p_color TEXT,
    p_tenant_id UUID
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_encrypted_pw TEXT;
BEGIN
    -- 1. Gerar ID e Hash de Senha
    v_user_id := uuid_generate_v4();
    v_encrypted_pw := crypt(p_password, gen_salt('bf'));

    -- 2. Inserir em AUTH.USERS (Hack para criar user sem deslogar admin)
    -- Nota: Isso requer permissão de superuser ou bypass RLS no banco
    INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', -- Default instance_id do Supabase
        v_user_id,
        'authenticated',
        'authenticated',
        p_email,
        v_encrypted_pw,
        NOW(), -- Email confirmado automaticamente
        '{"provider": "email", "providers": ["email"]}',
        json_build_object('full_name', p_full_name, 'role', p_role),
        NOW(),
        NOW()
    );

    -- 3. Inserir em PUBLIC.PROFILES (Trigger handle_new_user pode ter criado, mas garantimos update)
    INSERT INTO public.profiles (id, full_name, email, phone, role)
    VALUES (v_user_id, p_full_name, p_email, p_phone, p_role)
    ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        role = EXCLUDED.role;

    -- 4. Inserir em PUBLIC.MEMBERS
    INSERT INTO public.members (tenant_id, user_id, role, is_active)
    VALUES (p_tenant_id, v_user_id, p_role, true);

    -- 5. Se for Médico, inserir em PUBLIC.DOCTORS e APPOINTMENT_TYPES (Agenda Padrão)
    IF p_role = 'doctor' THEN
        INSERT INTO public.doctors (id, crm, specialty)
        VALUES (v_user_id, p_crm, p_specialty);
        
        -- Criar disponibilidade padrão (Seg-Sex, 08:00 - 18:00)
        INSERT INTO public.doctor_availability (doctor_id, tenant_id, day_of_week, start_time, end_time)
        SELECT v_user_id, p_tenant_id, d, '08:00', '18:00'
        FROM generate_series(1, 5) AS d;
    END IF;

    -- 6. Sucesso
    RETURN json_build_object(
        'success', true,
        'user_id', v_user_id,
        'message', 'Profissional criado com sucesso.'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; -- Security Definer roda como Admin do Banco
