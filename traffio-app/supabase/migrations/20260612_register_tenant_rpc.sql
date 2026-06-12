-- ================================================================
-- RPC: register_tenant — fluxo de auto-registro (/register)
-- ================================================================
-- O fluxo de cadastro do RegisterPage faz INSERT direto em
-- "tenants" e depois em "members" usando o client autenticado.
-- Isso sempre falhou com 403 (RLS): não existe policy de INSERT
-- para essas tabelas no fluxo de auto-registro, e mesmo que
-- houvesse, o ".insert().select()" do tenant falharia porque a
-- policy "tenants_select_member" exige um member já existente
-- (que só é criado no passo seguinte).
--
-- Esta função cria o tenant + o member (owner) numa única
-- transação, com SECURITY DEFINER (bypassa RLS de forma
-- controlada). Só permite que o usuário autenticado registre UM
-- tenant — se ele já pertence a algum, a função recusa.

CREATE OR REPLACE FUNCTION public.register_tenant(
    p_name          TEXT,
    p_slug          TEXT,
    p_plan          TEXT,
    p_billing_cycle TEXT
) RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant public.tenants;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;

    IF EXISTS (SELECT 1 FROM public.members WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'user already belongs to a tenant';
    END IF;

    INSERT INTO public.tenants (name, slug, plan, billing_cycle)
    VALUES (p_name, p_slug, p_plan, p_billing_cycle)
    RETURNING * INTO v_tenant;

    INSERT INTO public.members (tenant_id, user_id, role, is_active)
    VALUES (v_tenant.id, auth.uid(), 'owner', true);

    RETURN v_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_tenant(TEXT, TEXT, TEXT, TEXT) TO authenticated;
