-- =============================================================================
-- CRM — Fase 2: orçamentos e pagamentos fecham o ciclo no banco
--
--   Orçamento enviado/visualizado  -> Orçamento (abre nova oportunidade, inclusive
--                                     para paciente Fechado/Arquivado)
--   Orçamento aprovado (ou pago)   -> Fechado, somando o valor e com o título como
--                                     procedimento (valor contado uma única vez)
--   Orçamento pago                 -> evento de venda (para as cadências por pagamento)
--   Orçamento perdido              -> Arquivado com motivo, só se o card está em
--                                     Orçamento e não há outro orçamento ativo
--   Pagamento avulso               -> Fechado somando o valor (decisão aprovada em
--   (sem orçamento e sem consulta)    15/09/2026: venda de balcão/produto)
--   Pagamento de consulta          -> só registra a venda no histórico
--
-- Antes: mover o card dependia do navegador (proposalService), falhava em silêncio
-- fora das etapas "certas", não levava o valor e não registrava venda.
--
-- Rollback: supabase/rollbacks/20260915_crm_phase2_rollback.sql
-- =============================================================================

-- 1. Novos tipos de evento ------------------------------------------------------
ALTER TABLE public.crm_journey_events DROP CONSTRAINT IF EXISTS crm_journey_events_event_type_check;
ALTER TABLE public.crm_journey_events ADD CONSTRAINT crm_journey_events_event_type_check CHECK (event_type = ANY (ARRAY[
  'journey_created','stage_changed','appointment_created','appointment_confirmed',
  'checked_in','appointment_completed','no_show','appointment_cancelled',
  'message_received','message_sent','sale_recorded','note_added',
  'automation_fired','automation_stopped','journey_merged',
  'appointment_rescheduled','sync_blocked',
  'proposal_sent','proposal_approved','proposal_lost'
]));

-- 2. crm_sync_stage ganha motivo (para Arquivado) --------------------------------
DROP FUNCTION IF EXISTS public.crm_sync_stage(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.crm_sync_stage(p_journey_id uuid, p_to_stage text, p_actor text, p_source text, p_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM set_config('crm.system_fact', 'on', true);
    PERFORM public.crm_move_stage(p_journey_id, p_to_stage, p_actor, p_reason, jsonb_build_object('source', p_source));
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

REVOKE ALL ON FUNCTION public.crm_sync_stage(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- 3. Card do paciente: aberto > último fechado > novo ----------------------------
CREATE OR REPLACE FUNCTION public.crm_journey_for_patient(p_tenant_id uuid, p_patient_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_phone text;
BEGIN
  IF p_patient_id IS NULL OR p_tenant_id IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM public.crm_journeys
  WHERE tenant_id = p_tenant_id AND patient_id = p_patient_id AND stage_id NOT IN ('won','lost')
  ORDER BY last_event_at DESC LIMIT 1;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.crm_journeys
    WHERE tenant_id = p_tenant_id AND patient_id = p_patient_id
    ORDER BY last_event_at DESC LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    SELECT phone INTO v_phone FROM public.patients WHERE id = p_patient_id;
    v_id := public.crm_ensure_journey(p_tenant_id, p_patient_id, v_phone, NULL, 'manual');
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_journey_for_patient(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 4. Orçamentos -> CRM -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_trg_commercial_proposals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_journey_id uuid;
  v_stage text;
  v_actor text;
  v_total numeric;
  v_other_active int;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'draft' THEN RETURN NEW; END IF;

  v_actor := CASE WHEN auth.uid() IS NOT NULL THEN 'user' ELSE 'system' END;

  IF NEW.crm_journey_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.crm_journeys WHERE id = NEW.crm_journey_id) THEN
    v_journey_id := NEW.crm_journey_id;
  ELSE
    v_journey_id := public.crm_journey_for_patient(NEW.tenant_id, NEW.patient_id);
    IF v_journey_id IS NOT NULL THEN
      UPDATE public.commercial_proposals SET crm_journey_id = v_journey_id WHERE id = NEW.id;
    END IF;
  END IF;
  IF v_journey_id IS NULL THEN RETURN NEW; END IF;

  SELECT stage_id INTO v_stage FROM public.crm_journeys WHERE id = v_journey_id;
  v_total := NEW.total_cents / 100.0;

  IF NEW.status IN ('sent','viewed') THEN
    IF TG_OP = 'INSERT' OR OLD.status NOT IN ('sent','viewed') THEN
      PERFORM public.crm_log_event(v_journey_id, 'proposal_sent',
        jsonb_build_object('proposal_id', NEW.id, 'preview', NEW.title, 'total', v_total), v_actor);
      IF v_stage <> 'proposal' THEN
        PERFORM public.crm_sync_stage(v_journey_id, 'proposal', v_actor, 'orcamentos');
      END IF;
    END IF;

  ELSIF NEW.status IN ('approved','paid') THEN
    -- Valor entra uma vez só: na primeira vez que o orçamento fecha
    IF TG_OP = 'INSERT' OR OLD.status NOT IN ('approved','paid') THEN
      PERFORM public.crm_log_event(v_journey_id, 'proposal_approved',
        jsonb_build_object('proposal_id', NEW.id, 'preview', NEW.title, 'total', v_total), v_actor);
      UPDATE public.crm_journeys
      SET revenue_estimated = COALESCE(revenue_estimated, 0) + v_total,
          procedure_name    = NEW.title
      WHERE id = v_journey_id;
      IF v_stage <> 'won' THEN
        PERFORM public.crm_sync_stage(v_journey_id, 'won', v_actor, 'orcamentos');
      END IF;
    END IF;
    IF NEW.status = 'paid' THEN
      PERFORM public.crm_log_event(v_journey_id, 'sale_recorded',
        jsonb_build_object('proposal_id', NEW.id, 'preview', NEW.title, 'total', v_total), v_actor);
    END IF;

  ELSIF NEW.status = 'lost' THEN
    PERFORM public.crm_log_event(v_journey_id, 'proposal_lost',
      jsonb_build_object('proposal_id', NEW.id, 'preview', NEW.title, 'reason', NEW.lost_reason), v_actor);

    SELECT count(*) INTO v_other_active FROM public.commercial_proposals
    WHERE tenant_id = NEW.tenant_id AND patient_id = NEW.patient_id AND id <> NEW.id
      AND status IN ('sent','viewed','approved');

    IF v_stage = 'proposal' AND v_other_active = 0 THEN
      PERFORM public.crm_sync_stage(v_journey_id, 'lost', v_actor, 'orcamentos', COALESCE(NEW.lost_reason, 'other'));
    END IF;
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[crm_trg_commercial_proposals] proposal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_crm_commercial_proposals ON public.commercial_proposals;
CREATE TRIGGER tr_crm_commercial_proposals
  AFTER INSERT OR UPDATE OF status ON public.commercial_proposals
  FOR EACH ROW EXECUTE FUNCTION public.crm_trg_commercial_proposals();

-- 5. Recebimentos -> CRM ---------------------------------------------------------
-- Recebimento de orçamento é tratado pelo gatilho acima (via
-- billing_records_sync_proposal_paid, que marca o orçamento como pago).
CREATE OR REPLACE FUNCTION public.crm_trg_billing_records()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_journey_id uuid;
  v_stage text;
  v_actor text;
  v_amount numeric;
BEGIN
  IF NEW.status IS DISTINCT FROM 'paid' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN RETURN NEW; END IF;
  IF NEW.proposal_id IS NOT NULL OR NEW.patient_id IS NULL THEN RETURN NEW; END IF;

  v_tenant_id := COALESCE(NEW.tenant_id, (SELECT tenant_id FROM public.patients WHERE id = NEW.patient_id));
  v_journey_id := public.crm_journey_for_patient(v_tenant_id, NEW.patient_id);
  IF v_journey_id IS NULL THEN RETURN NEW; END IF;

  v_actor  := CASE WHEN auth.uid() IS NOT NULL THEN 'user' ELSE 'system' END;
  v_amount := NEW.amount_cents / 100.0;

  PERFORM public.crm_log_event(v_journey_id, 'sale_recorded',
    jsonb_build_object('billing_record_id', NEW.id, 'total', v_amount,
      'kind', CASE WHEN NEW.appointment_id IS NULL THEN 'avulso' ELSE 'consulta' END,
      'preview', NEW.notes), v_actor);

  -- Venda avulsa (balcão/produto): fecha o card e soma o valor
  IF NEW.appointment_id IS NULL THEN
    SELECT stage_id INTO v_stage FROM public.crm_journeys WHERE id = v_journey_id;
    UPDATE public.crm_journeys
    SET revenue_estimated = COALESCE(revenue_estimated, 0) + v_amount
    WHERE id = v_journey_id;
    IF v_stage <> 'won' THEN
      PERFORM public.crm_sync_stage(v_journey_id, 'won', v_actor, 'financeiro');
    END IF;
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[crm_trg_billing_records] billing %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_crm_billing_records ON public.billing_records;
CREATE TRIGGER tr_crm_billing_records
  AFTER INSERT OR UPDATE OF status ON public.billing_records
  FOR EACH ROW EXECUTE FUNCTION public.crm_trg_billing_records();
