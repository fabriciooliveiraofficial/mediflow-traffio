-- ##########################################################
-- MÓDULO ORÇAMENTOS (COMMERCIAL PROPOSALS)
-- Pipeline comercial rascunho→enviado→visualizado→aprovado→
-- pago/perdido, com itens de linha, moeda do tenant (mesmo
-- domínio operacional de billing_records/useTenantMoney) e
-- sincronização com o funil de CRM via crm_move_stage().
--
-- Nomenclatura: evita colisão com dental_budgets (vertical
-- odonto, feature paralela — não tocar) e financing_proposals
-- (Dr. Cash, tabela legada sem migration rastreável).
--
-- Verificado contra produção em 16/07/2026 antes de escrever
-- esta migration: billing_records.amount_cents/currency existem,
-- crm_ensure_journey()/crm_move_stage() existem com as assinaturas
-- usadas abaixo, crm_stage_transitions só tem showed_up→proposal
-- como entrada no estágio 'proposal' (PK (from_stage,to_stage)).
-- ##########################################################

-- ── 1. COMMERCIAL_PROPOSALS ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.commercial_proposals (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id        UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,

  title             TEXT        NOT NULL,
  notes             TEXT,
  valid_until       DATE,

  status            TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','viewed','approved','lost','paid')),

  -- Moeda operacional (snapshot, mesmo padrão de billing_records.currency)
  currency          TEXT        CHECK (currency ~ '^[A-Z]{3}$'),

  -- Cache do total, mantido por trigger a partir de commercial_proposal_items
  total_cents       INTEGER     NOT NULL DEFAULT 0,

  -- Timeline do pipeline
  sent_at           TIMESTAMPTZ,
  viewed_at         TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  lost_at           TIMESTAMPTZ,
  lost_reason       TEXT        CHECK (lost_reason IN ('price','competitor','no_response','gave_up','other')),
  paid_at           TIMESTAMPTZ,

  -- Link com o funil de CRM (jornada movida ao enviar/aprovar/perder)
  crm_journey_id    UUID        REFERENCES public.crm_journeys(id) ON DELETE SET NULL,

  created_by        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.commercial_proposals IS
  'Orçamentos/propostas comerciais (pipeline draft→sent→viewed→approved→paid/lost). Não confundir com dental_budgets (vertical odonto) nem financing_proposals (Dr. Cash).';
COMMENT ON COLUMN public.commercial_proposals.currency IS
  'Snapshot ISO 4217 da moeda do tenant na criação — mesmo comportamento de billing_records.currency. Nunca reconverter ao exibir.';
COMMENT ON COLUMN public.commercial_proposals.total_cents IS
  'Cache mantido por trigger (trg_proposal_items_recalc) a partir da soma de commercial_proposal_items.total_cents — nunca escrever direto pela aplicação.';

CREATE INDEX IF NOT EXISTS idx_commercial_proposals_tenant_status
  ON public.commercial_proposals (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_commercial_proposals_patient
  ON public.commercial_proposals (patient_id);
CREATE INDEX IF NOT EXISTS idx_commercial_proposals_journey
  ON public.commercial_proposals (crm_journey_id);


-- ── 2. COMMERCIAL_PROPOSAL_ITEMS ──────────────────────────
CREATE TABLE IF NOT EXISTS public.commercial_proposal_items (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id       UUID        NOT NULL REFERENCES public.commercial_proposals(id) ON DELETE CASCADE,
  description       TEXT        NOT NULL,
  quantity          NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents  INTEGER     NOT NULL CHECK (unit_price_cents >= 0),
  total_cents       INTEGER     GENERATED ALWAYS AS (ROUND(quantity * unit_price_cents)::INTEGER) STORED,
  sort_order        INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commercial_proposal_items_proposal
  ON public.commercial_proposal_items (proposal_id);


-- ── 3. Trigger: recalcula o total do orçamento pai ────────
CREATE OR REPLACE FUNCTION public.commercial_proposal_items_recalc_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal_id UUID := COALESCE(NEW.proposal_id, OLD.proposal_id);
BEGIN
  UPDATE public.commercial_proposals
  SET total_cents = COALESCE(
        (SELECT SUM(total_cents) FROM public.commercial_proposal_items WHERE proposal_id = v_proposal_id),
        0
      ),
      updated_at = NOW()
  WHERE id = v_proposal_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposal_items_recalc ON public.commercial_proposal_items;
CREATE TRIGGER trg_proposal_items_recalc
  AFTER INSERT OR UPDATE OF quantity, unit_price_cents OR DELETE ON public.commercial_proposal_items
  FOR EACH ROW EXECUTE FUNCTION public.commercial_proposal_items_recalc_total();


-- ── 4. Trigger: moeda herdada do tenant (espelha billing_records_set_currency) ─
CREATE OR REPLACE FUNCTION public.commercial_proposals_set_currency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.currency IS NULL THEN
    SELECT COALESCE(
             t.currency,
             CASE UPPER(COALESCE(t.country, 'BR'))
               WHEN 'US' THEN 'USD'
               WHEN 'NZ' THEN 'NZD'
               WHEN 'MX' THEN 'MXN'
               ELSE 'BRL'
             END
           )
      INTO NEW.currency
      FROM public.tenants t
     WHERE t.id = NEW.tenant_id;
    NEW.currency := COALESCE(NEW.currency, 'BRL');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commercial_proposals_set_currency ON public.commercial_proposals;
CREATE TRIGGER trg_commercial_proposals_set_currency
  BEFORE INSERT ON public.commercial_proposals
  FOR EACH ROW EXECUTE FUNCTION public.commercial_proposals_set_currency();


-- ── 5. Trigger updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.commercial_proposals_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commercial_proposals_updated_at ON public.commercial_proposals;
CREATE TRIGGER trg_commercial_proposals_updated_at
  BEFORE UPDATE ON public.commercial_proposals
  FOR EACH ROW EXECUTE FUNCTION public.commercial_proposals_set_updated_at();


-- ── 6. RPC atômico de criação (proposta + itens numa única transação) ─
CREATE OR REPLACE FUNCTION public.commercial_proposals_create(
  p_tenant_id UUID, p_patient_id UUID, p_title TEXT,
  p_notes TEXT, p_valid_until DATE, p_items JSONB
) RETURNS public.commercial_proposals
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_proposal public.commercial_proposals;
  v_item JSONB;
BEGIN
  INSERT INTO public.commercial_proposals (tenant_id, patient_id, title, notes, valid_until, created_by)
  VALUES (p_tenant_id, p_patient_id, p_title, p_notes, p_valid_until, auth.uid())
  RETURNING * INTO v_proposal;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    INSERT INTO public.commercial_proposal_items (proposal_id, description, quantity, unit_price_cents, sort_order)
    VALUES (
      v_proposal.id,
      v_item->>'description',
      COALESCE((v_item->>'quantity')::numeric, 1),
      (v_item->>'unit_price_cents')::integer,
      COALESCE((v_item->>'sort_order')::int, 0)
    );
  END LOOP;

  SELECT * INTO v_proposal FROM public.commercial_proposals WHERE id = v_proposal.id;
  RETURN v_proposal;
END;
$$;


-- ── 7. RLS ──────────────────────────────────────────────────
ALTER TABLE public.commercial_proposals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_proposal_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Tenant members manage proposals') THEN
    CREATE POLICY "Tenant members manage proposals" ON public.commercial_proposals
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.members WHERE tenant_id = commercial_proposals.tenant_id AND user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.members WHERE tenant_id = commercial_proposals.tenant_id AND user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role bypass proposals') THEN
    CREATE POLICY "Service role bypass proposals" ON public.commercial_proposals
      FOR ALL USING (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Tenant members manage proposal items') THEN
    CREATE POLICY "Tenant members manage proposal items" ON public.commercial_proposal_items
      FOR ALL
      USING (EXISTS (
        SELECT 1 FROM public.commercial_proposals p
        JOIN public.members m ON m.tenant_id = p.tenant_id
        WHERE p.id = commercial_proposal_items.proposal_id AND m.user_id = auth.uid()
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.commercial_proposals p
        JOIN public.members m ON m.tenant_id = p.tenant_id
        WHERE p.id = commercial_proposal_items.proposal_id AND m.user_id = auth.uid()
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role bypass proposal items') THEN
    CREATE POLICY "Service role bypass proposal items" ON public.commercial_proposal_items
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;


-- ── 8. billing_records: link opcional a um orçamento ──────
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS proposal_id UUID REFERENCES public.commercial_proposals(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.billing_records.proposal_id IS
  'Vincula um recebimento a um orçamento aprovado (opcional). Permite ver quanto já foi pago de um orçamento e marcar o orçamento como paid quando a soma bate o total (ProposalService.syncPaidStatus).';

CREATE INDEX IF NOT EXISTS idx_billing_records_proposal ON public.billing_records (proposal_id);


-- ── 9. crm_stage_transitions: liberar entrada em 'proposal' ─
-- Hoje só showed_up→proposal existe (verificado em produção,
-- 16/07/2026). Um orçamento pode ser enviado a um paciente que
-- ainda não compareceu (cotação remota) ou cuja jornada acabou
-- de ser criada por crm_ensure_journey (nasce em 'new_lead') —
-- sem isso, crm_move_stage(journey_id,'proposal') lançaria
-- exceção para esses casos. PK confirmada: (from_stage, to_stage).
INSERT INTO public.crm_stage_transitions (from_stage, to_stage) VALUES
  ('new_lead','proposal'),
  ('in_contact','proposal'),
  ('scheduled','proposal')
ON CONFLICT DO NOTHING;

SELECT 'Módulo Orçamentos (commercial_proposals) aplicado.' AS resultado;
