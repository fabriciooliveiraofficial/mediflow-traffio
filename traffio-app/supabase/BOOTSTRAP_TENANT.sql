-- ##########################################################
-- TRAFFIO MEDICAL - BOOTSTRAP TENANT (SELF-FIX V2)
-- ##########################################################
-- Versão atualizada para permitir passar o ID do usuário manualmente.
-- Necessário pois auth.uid() é null no SQL Editor do Supabase.

CREATE OR REPLACE FUNCTION bootstrap_my_tenant(
    p_clinic_name TEXT DEFAULT 'Minha Clínica',
    p_target_user_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_member_exists BOOLEAN;
BEGIN
    -- Tenta usar o ID passado ou o ID da sessão atual
    v_user_id := COALESCE(p_target_user_id, auth.uid());
    
    -- 1. Verificar se usuário existe/foi passado
    IF v_user_id IS NULL THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'ID do usuário obrigatório. Uso: select bootstrap_my_tenant(''Nome'', ''UUID_AQUI'');'
        );
    END IF;

    -- 2. Verificar se já tem tenant
    SELECT EXISTS (SELECT 1 FROM members WHERE user_id = v_user_id) INTO v_member_exists;
    
    IF v_member_exists THEN
        SELECT tenant_id INTO v_tenant_id FROM members WHERE user_id = v_user_id LIMIT 1;
        RETURN json_build_object(
            'success', true, 
            'message', 'Usuário já possui tenant.',
            'tenant_id', v_tenant_id
        );
    END IF;

    -- 3. Criar Tenant
    INSERT INTO tenants (name, slug, plan)
    VALUES (p_clinic_name, 'clinic-' || substr(uuid_generate_v4()::text, 1, 8), 'pro')
    RETURNING id INTO v_tenant_id;

    -- 4. Criar Member (Owner)
    INSERT INTO members (tenant_id, user_id, role, is_active)
    VALUES (v_tenant_id, v_user_id, 'owner', true);

    -- 5. Atualizar Profile
    UPDATE profiles 
    SET role = 'owner' 
    WHERE id = v_user_id;

    RETURN json_build_object(
        'success', true, 
        'message', 'Tenant criado com sucesso! Agora atualize a página (F5).',
        'tenant_id', v_tenant_id
    );
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
