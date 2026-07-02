-- =============================================================================
-- CRM Identity Resolution — Reconciliação retroativa de vínculos pré-existentes
-- Data: 2026-07-02
-- Pré-requisito: 20260702b_crm_auto_merge_on_patient_link.sql
--
-- O trigger tr_crm_session_patient_link só dispara em vínculos NOVOS
-- (UPDATE OF patient_id). Sessões vinculadas a pacientes ANTES do trigger
-- existir ficaram com cards duplicados no CRM (ex.: Facebook + Instagram do
-- mesmo paciente, ambos com journey próprio e patient_id NULL no journey).
-- Este script aplica retroativamente a mesma lógica do trigger.
-- Idempotente: re-execuções não encontram mais nada para reconciliar.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  v_session_journey uuid;
  v_patient_journey uuid;
  v_merged int := 0;
  v_upgraded int := 0;
BEGIN
  FOR r IN
    SELECT cs.id AS session_id, cs.tenant_id, cs.patient_id
    FROM public.conversation_sessions cs
    JOIN public.crm_journeys j ON j.session_id = cs.id
    WHERE cs.patient_id IS NOT NULL
      AND j.stage_id NOT IN ('won','lost')
      AND (j.patient_id IS NULL OR j.patient_id <> cs.patient_id)
    ORDER BY cs.updated_at
  LOOP
    v_session_journey := NULL;
    v_patient_journey := NULL;

    SELECT id INTO v_session_journey
    FROM public.crm_journeys
    WHERE session_id = r.session_id AND stage_id NOT IN ('won','lost')
    LIMIT 1;
    IF v_session_journey IS NULL THEN CONTINUE; END IF;

    SELECT id INTO v_patient_journey
    FROM public.crm_journeys
    WHERE tenant_id = r.tenant_id
      AND patient_id = r.patient_id
      AND stage_id NOT IN ('won','lost')
      AND id <> v_session_journey
    LIMIT 1;

    IF v_patient_journey IS NOT NULL THEN
      -- Card do paciente já existe: funde o card do canal nele
      BEGIN
        PERFORM public.crm_merge_journeys(v_patient_journey, v_session_journey, 'system');
        v_merged := v_merged + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[reconcile] merge falhou (% -> %): %', v_session_journey, v_patient_journey, SQLERRM;
      END;
    ELSE
      -- Não existe card do paciente: promove o card do canal
      UPDATE public.crm_journeys
      SET patient_id = r.patient_id, updated_at = now()
      WHERE id = v_session_journey;
      v_upgraded := v_upgraded + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[reconcile] % cards fundidos, % cards promovidos a paciente.', v_merged, v_upgraded;
END $$;

SELECT
  'Reconciliação concluída.' AS resultado,
  (SELECT count(*) FROM public.conversation_sessions cs
    JOIN public.crm_journeys j ON j.session_id = cs.id
    WHERE cs.patient_id IS NOT NULL
      AND j.stage_id NOT IN ('won','lost')
      AND (j.patient_id IS NULL OR j.patient_id <> cs.patient_id)
  ) AS pendentes_restantes;
