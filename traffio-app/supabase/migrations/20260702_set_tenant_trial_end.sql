-- ================================================================
-- SET TENANT TRIAL END (Super-Admin)
-- Complementa extend_tenant_trial (só soma dias): permite ao
-- super_admin definir a data final do trial diretamente, podendo
-- tanto estender quanto ENCURTAR. Reaproveita a tabela de auditoria
-- trial_extensions (days_added pode ser negativo quando encurta).
-- ================================================================

CREATE OR REPLACE FUNCTION public.set_tenant_trial_end(
    p_tenant_id UUID,
    p_new_end   TIMESTAMPTZ,
    p_reason    TEXT DEFAULT NULL
)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_super  BOOLEAN;
    v_old_ends  TIMESTAMPTZ;
    v_tenant    public.tenants;
    v_days      INTEGER;
BEGIN
    -- AuthZ: somente super_admin
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'super_admin'
    ) INTO v_is_super;

    IF NOT v_is_super THEN
        RAISE EXCEPTION 'forbidden: only super_admin can set trial end'
            USING ERRCODE = '42501';
    END IF;

    IF p_new_end IS NULL THEN
        RAISE EXCEPTION 'p_new_end is required'
            USING ERRCODE = '22023';
    END IF;

    -- Lock da linha + leitura do valor atual
    SELECT trial_ends_at INTO v_old_ends
    FROM public.tenants
    WHERE id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'tenant not found: %', p_tenant_id
            USING ERRCODE = 'P0002';
    END IF;

    v_days := ROUND(EXTRACT(EPOCH FROM (p_new_end - COALESCE(v_old_ends, NOW()))) / 86400);

    UPDATE public.tenants
    SET trial_ends_at        = p_new_end,
        admin_granted_trial  = TRUE,
        subscription_status  = CASE
            WHEN subscription_status = 'active' THEN subscription_status
            ELSE 'trial'
        END
    WHERE id = p_tenant_id
    RETURNING * INTO v_tenant;

    -- Auditoria (mesma tabela de extend_tenant_trial; days_added pode ser negativo aqui)
    INSERT INTO public.trial_extensions (
        tenant_id, extended_by, days_added,
        previous_trial_ends_at, new_trial_ends_at, reason
    )
    VALUES (
        p_tenant_id, auth.uid(), v_days,
        v_old_ends, p_new_end, p_reason
    );

    RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_trial_end(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_trial_end(UUID, TIMESTAMPTZ, TEXT) TO authenticated;
