-- =============================================================================
-- CRM Identity Resolution — Auto-merge determinístico ao vincular paciente
-- Data: 2026-07-02
-- Pré-requisito: 20260702a_crm_identity_resolution.sql
--
-- Gancho: HumanInboxPage "Vincular Paciente" grava conversation_sessions.patient_id
-- (HumanInboxPage.tsx:3209). Nesse momento temos a prova determinística de que o
-- contato do canal social É aquele paciente — padrão HubSpot: identificador
-- compartilhado aparece → merge automático, sem intervenção humana.
--
-- Cenário resolvido: Daiane contata por Instagram (card B, id da plataforma) e
-- já tem card A (patient/WhatsApp). Atendente vincula a conversa de IG ao
-- cadastro dela → card B funde automaticamente no card A, identidade de
-- Instagram passa a pertencer ao card A.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.crm_trg_session_patient_link()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session_journey uuid;  -- card criado pelo canal (ex.: Instagram)
  v_patient_journey uuid;  -- card já existente do paciente
BEGIN
  -- Só reage a vinculação nova (NULL → uuid ou troca de paciente)
  IF NEW.patient_id IS NULL OR NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_session_journey
  FROM public.crm_journeys
  WHERE session_id = NEW.id AND stage_id NOT IN ('won','lost')
  LIMIT 1;

  SELECT id INTO v_patient_journey
  FROM public.crm_journeys
  WHERE tenant_id = NEW.tenant_id
    AND patient_id = NEW.patient_id
    AND stage_id NOT IN ('won','lost')
    AND (v_session_journey IS NULL OR id <> v_session_journey)
  LIMIT 1;

  IF v_session_journey IS NOT NULL AND v_patient_journey IS NOT NULL THEN
    -- Ambos existem: funde o card do canal no card do paciente
    BEGIN
      PERFORM public.crm_merge_journeys(v_patient_journey, v_session_journey, 'system');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[crm_trg_session_patient_link] merge falhou (%->%): %',
        v_session_journey, v_patient_journey, SQLERRM;
    END;
  ELSIF v_session_journey IS NOT NULL THEN
    -- Só existe o card do canal: upgrade com o patient_id
    UPDATE public.crm_journeys
    SET patient_id = NEW.patient_id, updated_at = now()
    WHERE id = v_session_journey;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_crm_session_patient_link ON public.conversation_sessions;
CREATE TRIGGER tr_crm_session_patient_link
  AFTER UPDATE OF patient_id ON public.conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.crm_trg_session_patient_link();

SELECT 'CRM Auto-merge on patient link aplicado.' AS resultado;
