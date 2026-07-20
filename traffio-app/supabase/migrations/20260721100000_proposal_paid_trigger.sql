-- Reconciliação approved → paid via trigger de banco (independente do caminho
-- que registrou o pagamento — recibo manual, futuro checkout Stripe Connect, etc.).
-- Antes disto a única reconciliação era client-side (ProposalService.syncPaidStatus),
-- que só rodava se o próprio código do app chamasse essa função.

CREATE OR REPLACE FUNCTION public.billing_records_sync_proposal_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_cents BIGINT;
  v_paid_cents BIGINT;
BEGIN
  IF NEW.proposal_id IS NULL OR NEW.status IS DISTINCT FROM 'paid' THEN
    RETURN NEW;
  END IF;

  SELECT total_cents INTO v_total_cents
    FROM public.commercial_proposals
   WHERE id = NEW.proposal_id;

  IF v_total_cents IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_paid_cents
    FROM public.billing_records
   WHERE proposal_id = NEW.proposal_id
     AND status = 'paid';

  IF v_paid_cents >= v_total_cents THEN
    UPDATE public.commercial_proposals
       SET status = 'paid', paid_at = NOW()
     WHERE id = NEW.proposal_id
       AND status = 'approved';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_records_sync_proposal_paid ON public.billing_records;
CREATE TRIGGER trg_billing_records_sync_proposal_paid
  AFTER INSERT OR UPDATE OF status, proposal_id ON public.billing_records
  FOR EACH ROW EXECUTE FUNCTION public.billing_records_sync_proposal_paid();
