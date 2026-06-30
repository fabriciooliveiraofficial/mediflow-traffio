-- =============================================================================
-- Kanban Auto-Advance on Appointment Completion
-- Data: 2026-06-30
--
-- Trigger: quando appointments.status → 'completed', avança o kanban_stage
-- da conversation_session do paciente para 'Vendido/Procedimento'.
-- Também cobre 'no_show' → estágio de falta correspondente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.advance_kanban_on_appointment_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient_phone text;
  v_target_stage  text;
  v_session_stage text;
BEGIN
  -- Dispara apenas em mudanças relevantes de status
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- Determina o estágio alvo conforme o resultado
  IF NEW.status = 'completed' THEN
    v_target_stage := 'Vendido/Procedimento';
  ELSIF NEW.status = 'no_show' THEN
    -- O estágio de falta depende do estágio atual da sessão (avaliação vs consulta)
    -- Deixamos null para ser resolvido por sessão abaixo
    v_target_stage := NULL;
  ELSE
    RETURN NEW; -- Outros status (cancelled, confirmed, etc.) não movem o Kanban
  END IF;

  -- Busca o telefone do paciente
  SELECT phone INTO v_patient_phone
  FROM public.patients
  WHERE id = NEW.patient_id;

  IF v_patient_phone IS NULL THEN RETURN NEW; END IF;

  -- Para cada sessão ativa deste paciente/tenant
  FOR v_session_stage IN
    SELECT kanban_stage
    FROM public.conversation_sessions
    WHERE tenant_id    = NEW.tenant_id
      AND patient_phone = v_patient_phone
      AND kanban_stage NOT IN ('Vendido/Procedimento', 'Perdido')
  LOOP
    DECLARE
      v_resolved_stage text;
    BEGIN
      IF v_target_stage IS NOT NULL THEN
        v_resolved_stage := v_target_stage;
      ELSIF NEW.status = 'no_show' THEN
        -- Mapeamento de falta: Avaliação → Faltou Avaliação, Consulta → Faltou Consulta
        IF v_session_stage IN ('Avaliação', 'Reagendamento Avaliação') THEN
          v_resolved_stage := 'Faltou Avaliação';
        ELSE
          v_resolved_stage := 'Faltou Consulta';
        END IF;
      END IF;

      UPDATE public.conversation_sessions
      SET    kanban_stage = v_resolved_stage
      WHERE  tenant_id    = NEW.tenant_id
        AND  patient_phone = v_patient_phone
        AND  kanban_stage  = v_session_stage
        AND  kanban_stage NOT IN ('Vendido/Procedimento', 'Perdido');
    END;
  END LOOP;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[advance_kanban_on_appointment_outcome] Appt %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_advance_kanban_on_appointment_outcome ON public.appointments;

CREATE TRIGGER tr_advance_kanban_on_appointment_outcome
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.advance_kanban_on_appointment_outcome();

SELECT 'Migration 20260630_kanban_autocomplete aplicada.' AS resultado;
