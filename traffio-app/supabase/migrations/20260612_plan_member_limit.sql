-- ================================================================
-- ENFORCEMENT: limite de profissionais por plano (camada banco)
-- Trigger dispara em INSERT/UPDATE de members com is_active = TRUE
-- Executado no SQL Editor em 2026-06-12 (Migration 2)
-- Decisão 10.1: Opção A — limite conta membros ativos com role 'doctor'
-- ================================================================

CREATE OR REPLACE FUNCTION public.enforce_member_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_max_professionals INT;
    v_current_count     INT;
BEGIN
    -- Só valida ativações
    IF (NEW.is_active IS DISTINCT FROM TRUE) THEN
        RETURN NEW;
    END IF;

    -- Limite do plano do tenant (NULL = ilimitado)
    SELECT p.max_professionals
      INTO v_max_professionals
      FROM public.tenants t
      JOIN public.plans p ON p.id = t.plan
     WHERE t.id = NEW.tenant_id;

    IF v_max_professionals IS NULL THEN
        RETURN NEW;  -- plano Rede: ilimitado
    END IF;

    -- Conta membros ativos com papel clínico (Opção A da decisão 10.1)
    SELECT COUNT(*)
      INTO v_current_count
      FROM public.members
     WHERE tenant_id = NEW.tenant_id
       AND is_active = TRUE
       AND role IN ('doctor')
       AND id IS DISTINCT FROM NEW.id; -- não contar o próprio registro em UPDATE

    IF (NEW.role IN ('doctor')) AND v_current_count >= v_max_professionals THEN
        RAISE EXCEPTION 'PLAN_LIMIT_REACHED: o plano atual permite % profissional(is). Faça upgrade para adicionar mais.', v_max_professionals
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_member_limit ON public.members;
CREATE TRIGGER trg_enforce_member_limit
    BEFORE INSERT OR UPDATE OF is_active, role ON public.members
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_member_limit();
