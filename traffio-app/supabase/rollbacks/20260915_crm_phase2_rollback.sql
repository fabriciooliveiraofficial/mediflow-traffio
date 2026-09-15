-- ROLLBACK da Fase 2 (orçamentos e pagamentos -> CRM).
-- Volta ao estado da Fase 1. Aplicar com:
--   npx supabase db query --linked -f supabase/rollbacks/20260915_crm_phase2_rollback.sql

DROP TRIGGER IF EXISTS tr_crm_billing_records ON public.billing_records;
DROP FUNCTION IF EXISTS public.crm_trg_billing_records();

DROP TRIGGER IF EXISTS tr_crm_commercial_proposals ON public.commercial_proposals;
DROP FUNCTION IF EXISTS public.crm_trg_commercial_proposals();

DROP FUNCTION IF EXISTS public.crm_journey_for_patient(uuid, uuid);

DROP FUNCTION IF EXISTS public.crm_sync_stage(uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION public.crm_sync_stage(p_journey_id uuid, p_to_stage text, p_actor text, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM set_config('crm.system_fact', 'on', true);
    PERFORM public.crm_move_stage(p_journey_id, p_to_stage, p_actor, NULL, jsonb_build_object('source', p_source));
    PERFORM set_config('crm.system_fact', 'off', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('crm.system_fact', 'off', true);
    BEGIN
      PERFORM public.crm_log_event(p_journey_id, 'sync_blocked',
        jsonb_build_object('to', p_to_stage, 'source', p_source, 'error', SQLERRM), 'system');
      UPDATE public.crm_journeys SET needs_action = true WHERE id = p_journey_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[crm_sync_stage] journey % -> %: %', p_journey_id, p_to_stage, SQLERRM;
    END;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_sync_stage(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- Tipos de evento da Fase 2 ficam permitidos (NOT VALID não rejeita linhas antigas);
-- remover a restrição nova só se nenhum evento proposal_* tiver sido gravado.
