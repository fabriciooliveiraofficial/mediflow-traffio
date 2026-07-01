-- =============================================================================
-- CRM Journey Engine — Fundação
-- Data: 2026-07-01
--
-- Substitui o modelo baseado em conversation_sessions.kanban_stage (string
-- solta, 1 card por conversa) por uma entidade patient-centric com máquina
-- de estados real e event log. Resolve:
--   1. Comparecimento invisível (walk-in e checkin não conectados ao CRM)
--   2. Múltiplos agendamentos do mesmo paciente invisíveis
--   3. Walk-in sem card no CRM
--   4/6/7. Estágios que misturam funil comercial + jornada clínica + eventos
--          negativos como coluna, sem máquina de transição
--   5. Automação desconectada do kanban
--
-- Compatibilidade: conversation_sessions.kanban_stage é mantido como espelho
-- sincronizado (ver 20260701_crm_journey_engine.sql) para não quebrar
-- HumanInboxPage.tsx e SidebarLeadClassifyView.tsx, que seguem lendo/gravando
-- diretamente naquela coluna.
-- =============================================================================

-- 1. Estágios (máquina de estados, i18n por chave em crm.json → kanbanV2Stages)
CREATE TABLE IF NOT EXISTS public.crm_stages (
  id          text PRIMARY KEY,
  label_key   text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('open','working','won','lost')),
  sort_order  int  NOT NULL,
  sla_hours   int,                 -- estagnação neste estágio → needs_action
  is_active   boolean NOT NULL DEFAULT true
);

INSERT INTO public.crm_stages (id, label_key, kind, sort_order, sla_hours) VALUES
  ('new_lead',    'stages.newLead',    'open',    10, 24),
  ('in_contact',  'stages.inContact',  'open',    20, 72),
  ('scheduled',   'stages.scheduled',  'open',    30, NULL),
  ('showed_up',   'stages.showedUp',   'open',    40, 48),
  ('proposal',    'stages.proposal',   'open',    50, 96),
  ('recovery',    'stages.recovery',   'working', 60, 168),
  ('recall_due',  'stages.recallDue',  'working', 65, 168),
  ('won',         'stages.won',        'won',     70, NULL),
  ('lost',        'stages.lost',       'lost',    80, NULL)
ON CONFLICT (id) DO NOTHING;

-- 2. Matriz de transições válidas — fonte única de verdade para UI e banco
CREATE TABLE IF NOT EXISTS public.crm_stage_transitions (
  from_stage text NOT NULL REFERENCES public.crm_stages(id),
  to_stage   text NOT NULL REFERENCES public.crm_stages(id),
  PRIMARY KEY (from_stage, to_stage)
);

INSERT INTO public.crm_stage_transitions (from_stage, to_stage) VALUES
  ('new_lead','in_contact'),   ('new_lead','scheduled'),   ('new_lead','lost'),
  ('in_contact','scheduled'),  ('in_contact','recovery'),  ('in_contact','lost'),
  ('scheduled','showed_up'),   ('scheduled','recovery'),   ('scheduled','lost'),
  ('scheduled','in_contact'),
  ('showed_up','proposal'),    ('showed_up','won'),        ('showed_up','recovery'),
  ('proposal','won'),          ('proposal','recovery'),    ('proposal','lost'),
  ('recovery','in_contact'),   ('recovery','scheduled'),   ('recovery','lost'),
  ('recall_due','scheduled'),  ('recall_due','in_contact'),('recall_due','lost'),
  ('won','recall_due'),                                    -- lifetime loop
  ('new_lead','recall_due'),   ('in_contact','recall_due')  -- card criado direto pelo check-recall
ON CONFLICT DO NOTHING;

-- 3. Journey: 1 card ativo por paciente (fallback por telefone para leads
--    pré-cadastro). A conversa é um anexo do card, não o card em si.
CREATE TABLE IF NOT EXISTS public.crm_journeys (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id           uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  lead_phone           text,
  session_id           uuid REFERENCES public.conversation_sessions(id) ON DELETE SET NULL,
  stage_id             text NOT NULL DEFAULT 'new_lead' REFERENCES public.crm_stages(id),
  origin               text NOT NULL DEFAULT 'conversation'
                          CHECK (origin IN ('conversation','walk_in','manual','import','recall')),
  revenue_estimated    numeric(12,2) NOT NULL DEFAULT 0,
  procedure_name       text,
  appointments_count   int NOT NULL DEFAULT 0,
  no_show_count        int NOT NULL DEFAULT 0,
  next_appointment_at  timestamptz,
  priority_score        int  NOT NULL DEFAULT 0,
  next_action_at        timestamptz,
  next_action_type      text CHECK (next_action_type IN
                           ('call','message','confirm','follow_proposal','recover','recall')),
  lost_reason           text CHECK (lost_reason IN
                           ('price','competitor','no_response','gave_up','other')),
  needs_action           boolean NOT NULL DEFAULT false,
  stage_entered_at       timestamptz NOT NULL DEFAULT now(),
  last_event_at          timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_journeys_identity CHECK (patient_id IS NOT NULL OR lead_phone IS NOT NULL)
);

-- No máximo 1 card aberto por paciente / por telefone-lead (won/lost fecham o card;
-- 'won' pode reabrir depois via recall_due, que também está fora deste filtro).
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_journeys_open_patient
  ON public.crm_journeys (tenant_id, patient_id)
  WHERE patient_id IS NOT NULL AND stage_id NOT IN ('won','lost');

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_journeys_open_phone
  ON public.crm_journeys (tenant_id, lead_phone)
  WHERE patient_id IS NULL AND lead_phone IS NOT NULL AND stage_id NOT IN ('won','lost');

CREATE INDEX IF NOT EXISTS idx_crm_journeys_board
  ON public.crm_journeys (tenant_id, stage_id, last_event_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_journeys_today
  ON public.crm_journeys (tenant_id, next_action_at, priority_score DESC)
  WHERE stage_id NOT IN ('won','lost');

CREATE INDEX IF NOT EXISTS idx_crm_journeys_session ON public.crm_journeys (session_id);
CREATE INDEX IF NOT EXISTS idx_crm_journeys_patient ON public.crm_journeys (patient_id);

-- 4. Event log imutável — alimenta a timeline e as métricas (fim do
--    "updated_at mentiroso" onde qualquer UPDATE contava como venda no período)
CREATE TABLE IF NOT EXISTS public.crm_journey_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id  uuid NOT NULL REFERENCES public.crm_journeys(id) ON DELETE CASCADE,
  event_type  text NOT NULL CHECK (event_type IN (
                'journey_created','stage_changed','appointment_created',
                'appointment_confirmed','checked_in','appointment_completed',
                'no_show','appointment_cancelled','message_received',
                'message_sent','sale_recorded','note_added','automation_fired',
                'automation_stopped')),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor       text NOT NULL DEFAULT 'system' CHECK (actor IN ('system','user','bot','patient')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_events_journey  ON public.crm_journey_events (journey_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_events_metrics  ON public.crm_journey_events (tenant_id, event_type, created_at);

-- 5. Automação por estágio (reusa outbound_message_queue + process-outbound existentes)
CREATE TABLE IF NOT EXISTS public.crm_stage_automations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES public.tenants(id) ON DELETE CASCADE, -- NULL = default global
  stage_id      text NOT NULL REFERENCES public.crm_stages(id),
  trigger_kind  text NOT NULL DEFAULT 'on_enter' CHECK (trigger_kind IN ('on_enter','on_sla')),
  delay_hours   numeric NOT NULL DEFAULT 0,
  template_key  text NOT NULL,
  stop_on       text[] NOT NULL DEFAULT ARRAY['reply','booking','payment'],
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Cadência default de Recuperação (no-show / esfriou): D0, D2, D7
INSERT INTO public.crm_stage_automations (tenant_id, stage_id, trigger_kind, delay_hours, template_key) VALUES
  (NULL, 'recovery',   'on_enter', 0,   'recovery_immediate'),
  (NULL, 'recovery',   'on_enter', 48,  'recovery_48h'),
  (NULL, 'recovery',   'on_enter', 168, 'recovery_7d'),
  (NULL, 'recall_due', 'on_enter', 0,   'recall_immediate')
ON CONFLICT DO NOTHING;

-- 6. Execuções de automação: idempotência absoluta (nunca enfileira 2x a
--    mesma regra para o mesmo ciclo de vida do card no estágio)
CREATE TABLE IF NOT EXISTS public.crm_automation_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id     uuid NOT NULL REFERENCES public.crm_journeys(id) ON DELETE CASCADE,
  automation_id  uuid NOT NULL REFERENCES public.crm_stage_automations(id) ON DELETE CASCADE,
  cycle          int  NOT NULL DEFAULT 1,     -- reentrada no estágio = novo ciclo
  outbound_id    uuid,                        -- referência lógica em outbound_message_queue
  status         text NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','sent','stopped','skipped')),
  stopped_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, automation_id, cycle)
);

CREATE INDEX IF NOT EXISTS idx_crm_runs_journey_active
  ON public.crm_automation_runs (journey_id) WHERE status = 'scheduled';

-- 7. Janela de envio por tenant (evita disparo às 2h da manhã)
CREATE TABLE IF NOT EXISTS public.crm_send_windows (
  tenant_id    uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  window_start time NOT NULL DEFAULT '08:00',
  window_end   time NOT NULL DEFAULT '20:00'
);

-- 8. RLS — segue o padrão já usado no restante do schema real (não
--    "tenant_users", que não existe neste projeto; confirmado via
--    waitlist/sales_scripts/url_shortener/register_tenant_rpc):
--    tenant_id IN (SELECT tenant_id FROM members WHERE user_id = auth.uid())
ALTER TABLE public.crm_journeys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_journey_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_stage_automations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_automation_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_send_windows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_stages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_stage_transitions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenants manage their journeys" ON public.crm_journeys;
CREATE POLICY "Tenants manage their journeys" ON public.crm_journeys
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Tenants read their journey events" ON public.crm_journey_events;
CREATE POLICY "Tenants read their journey events" ON public.crm_journey_events
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role writes journey events" ON public.crm_journey_events;
CREATE POLICY "Service role writes journey events" ON public.crm_journey_events
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Tenants read automation rules" ON public.crm_stage_automations;
CREATE POLICY "Tenants read automation rules" ON public.crm_stage_automations
  FOR SELECT USING (
    tenant_id IS NULL
    OR tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenants read automation runs" ON public.crm_automation_runs;
CREATE POLICY "Tenants read automation runs" ON public.crm_automation_runs
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role manages automation runs" ON public.crm_automation_runs;
CREATE POLICY "Service role manages automation runs" ON public.crm_automation_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Tenants manage their send window" ON public.crm_send_windows;
CREATE POLICY "Tenants manage their send window" ON public.crm_send_windows
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Anyone authenticated reads stage catalog" ON public.crm_stages;
CREATE POLICY "Anyone authenticated reads stage catalog" ON public.crm_stages
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone authenticated reads transitions" ON public.crm_stage_transitions;
CREATE POLICY "Anyone authenticated reads transitions" ON public.crm_stage_transitions
  FOR SELECT TO authenticated USING (true);

SELECT 'CRM Journey Engine — Fundação aplicada.' AS resultado;
