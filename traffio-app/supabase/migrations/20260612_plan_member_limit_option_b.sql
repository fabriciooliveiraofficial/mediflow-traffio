-- ================================================================
-- AJUSTE: limite de membros por plano — OPÇÃO B (decisão 10.1)
-- Substitui a versão anterior (Opção A, que contava só 'doctor').
-- Agora TODOS os membros ativos do tenant contam no limite
-- max_professionals do plano, independente do papel.
-- Executar no SQL Editor (Migration 2b)
-- ================================================================

CREATE OR REPLACE FUNCTION public.enforce_member_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_max_members   INT;
    v_current_count INT;
BEGIN
    -- Só valida ativações
    IF (NEW.is_active IS DISTINCT FROM TRUE) THEN
        RETURN NEW;
    END IF;

    -- Limite do plano do tenant (NULL = ilimitado)
    SELECT p.max_professionals
      INTO v_max_members
      FROM public.tenants t
      JOIN public.plans p ON p.id = t.plan
     WHERE t.id = NEW.tenant_id;

    IF v_max_members IS NULL THEN
        RETURN NEW;  -- plano Rede: ilimitado
    END IF;

    -- OPÇÃO B: conta TODOS os membros ativos do tenant (qualquer role)
    SELECT COUNT(*)
      INTO v_current_count
      FROM public.members
     WHERE tenant_id = NEW.tenant_id
       AND is_active = TRUE
       AND id IS DISTINCT FROM NEW.id; -- não contar o próprio registro em UPDATE

    IF v_current_count >= v_max_members THEN
        RAISE EXCEPTION 'PLAN_LIMIT_REACHED: o plano atual permite % usuário(s) ativo(s). Faça upgrade para adicionar mais.', v_max_members
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recriar o trigger SEM o filtro de colunas (qualquer INSERT/UPDATE
-- que ative um membro passa pela validação, independente do role)
DROP TRIGGER IF EXISTS trg_enforce_member_limit ON public.members;
CREATE TRIGGER trg_enforce_member_limit
    BEFORE INSERT OR UPDATE OF is_active, role, tenant_id ON public.members
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_member_limit();
