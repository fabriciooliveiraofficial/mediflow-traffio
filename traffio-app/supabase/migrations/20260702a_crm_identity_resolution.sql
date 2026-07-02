-- =============================================================================
-- CRM Identity Resolution — 1 pessoa, N canais
-- Data: 2026-07-02
-- Pré-requisito: CRM Journey Engine (20260701a/b/c) aplicado.
--
-- Problema (verificado em produção): sessões de Instagram/Messenger gravam
-- apenas o platform_user_id em patient_phone (platform_display_name = NULL em
-- 100% das linhas), então o mesmo paciente que contata por WhatsApp, Instagram
-- e Messenger vira 3 cards com nome genérico. Modelo adotado (padrão
-- Intercom/HubSpot/Chatwoot): journey = pessoa; crm_journey_identities = N
-- identidades de canal; merge determinístico + manual.
-- =============================================================================

-- 1. Identidades de canal por journey
CREATE TABLE IF NOT EXISTS public.crm_journey_identities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id   uuid NOT NULL REFERENCES public.crm_journeys(id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN ('whatsapp','instagram','facebook','livechat','sms','phone')),
  identifier   text NOT NULL,          -- telefone normalizado ou platform_user_id
  display_name text,                   -- nome real capturado do canal
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, identifier)
);

CREATE INDEX IF NOT EXISTS idx_crm_identities_journey ON public.crm_journey_identities (journey_id);

ALTER TABLE public.crm_journey_identities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants manage their identities" ON public.crm_journey_identities;
CREATE POLICY "Tenants manage their identities" ON public.crm_journey_identities
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.members WHERE user_id = auth.uid()));

-- 2. Backfill: identidades a partir das sessões já vinculadas a journeys
INSERT INTO public.crm_journey_identities (tenant_id, journey_id, channel, identifier, display_name)
SELECT j.tenant_id, j.id, COALESCE(cs.channel, 'whatsapp'), cs.patient_phone, cs.platform_display_name
FROM public.crm_journeys j
JOIN public.conversation_sessions cs ON cs.id = j.session_id
WHERE cs.patient_phone IS NOT NULL
ON CONFLICT (tenant_id, channel, identifier) DO NOTHING;

-- 3. Novo tipo de evento para auditoria de merge
ALTER TABLE public.crm_journey_events DROP CONSTRAINT IF EXISTS crm_journey_events_event_type_check;
ALTER TABLE public.crm_journey_events ADD CONSTRAINT crm_journey_events_event_type_check
  CHECK (event_type IN (
    'journey_created','stage_changed','appointment_created','appointment_confirmed',
    'checked_in','appointment_completed','no_show','appointment_cancelled',
    'message_received','message_sent','sale_recorded','note_added',
    'automation_fired','automation_stopped','journey_merged'));

-- 4. Merge: move tudo do duplicado para o primário e fecha o duplicado
CREATE OR REPLACE FUNCTION public.crm_merge_journeys(p_primary uuid, p_duplicate uuid, p_actor text DEFAULT 'user')
RETURNS public.crm_journeys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pri public.crm_journeys;
  dup public.crm_journeys;
BEGIN
  IF p_primary = p_duplicate THEN RAISE EXCEPTION 'cannot merge a journey into itself'; END IF;

  SELECT * INTO pri FROM public.crm_journeys WHERE id = p_primary  FOR UPDATE;
  SELECT * INTO dup FROM public.crm_journeys WHERE id = p_duplicate FOR UPDATE;
  IF pri.id IS NULL OR dup.id IS NULL THEN RAISE EXCEPTION 'journey not found'; END IF;
  IF pri.tenant_id <> dup.tenant_id THEN RAISE EXCEPTION 'cross-tenant merge forbidden'; END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = pri.tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.crm_journey_identities SET journey_id = p_primary WHERE journey_id = p_duplicate;
  UPDATE public.crm_journey_events     SET journey_id = p_primary WHERE journey_id = p_duplicate;
  UPDATE public.crm_automation_runs    SET journey_id = p_primary WHERE journey_id = p_duplicate;

  UPDATE public.crm_journeys SET
    patient_id          = COALESCE(pri.patient_id, dup.patient_id),
    lead_phone          = COALESCE(pri.lead_phone, dup.lead_phone),
    session_id          = COALESCE(pri.session_id, dup.session_id),
    revenue_estimated   = GREATEST(pri.revenue_estimated, dup.revenue_estimated),
    procedure_name      = COALESCE(pri.procedure_name, dup.procedure_name),
    appointments_count  = pri.appointments_count + dup.appointments_count,
    no_show_count       = pri.no_show_count + dup.no_show_count,
    next_appointment_at = LEAST(pri.next_appointment_at, dup.next_appointment_at),
    last_event_at       = GREATEST(pri.last_event_at, dup.last_event_at),
    updated_at          = now()
  WHERE id = p_primary RETURNING * INTO pri;

  -- Fecha o duplicado sem passar pela máquina de transições (estado terminal técnico)
  UPDATE public.crm_journeys
  SET stage_id = 'lost', lost_reason = 'other', needs_action = false,
      next_action_at = NULL, next_action_type = NULL, updated_at = now()
  WHERE id = p_duplicate;

  PERFORM public.crm_log_event(p_primary, 'journey_merged',
    jsonb_build_object('merged_from', p_duplicate), p_actor);

  UPDATE public.crm_journeys SET priority_score = public.crm_calculate_priority_score(p_primary)
  WHERE id = p_primary RETURNING * INTO pri;

  RETURN pri;
END;
$$;

-- 5. crm_ensure_journey v2: resolução por identidade de canal antes do telefone.
--    IMPORTANTE: dropar a versão 5-args antes — CREATE OR REPLACE com nova
--    aridade cria SOBRECARGA, e chamadas com 5 args ficariam ambíguas
--    ("function is not unique") nos triggers de appointments/patients.
DROP FUNCTION IF EXISTS public.crm_ensure_journey(uuid, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.crm_ensure_journey(
  p_tenant_id uuid, p_patient_id uuid, p_lead_phone text, p_session_id uuid, p_origin text,
  p_channel text DEFAULT NULL, p_display_name text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- a) por paciente
  IF p_patient_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.crm_journeys
    WHERE tenant_id = p_tenant_id AND patient_id = p_patient_id AND stage_id NOT IN ('won','lost') LIMIT 1;
  END IF;

  -- b) por identidade de canal (Instagram/Messenger IDs, telefones já registrados)
  IF v_id IS NULL AND p_lead_phone IS NOT NULL THEN
    SELECT i.journey_id INTO v_id
    FROM public.crm_journey_identities i
    JOIN public.crm_journeys jj ON jj.id = i.journey_id AND jj.stage_id NOT IN ('won','lost')
    WHERE i.tenant_id = p_tenant_id AND i.identifier = p_lead_phone
      AND (p_channel IS NULL OR i.channel = p_channel)
    LIMIT 1;
  END IF;

  -- c) por telefone direto (compatibilidade)
  IF v_id IS NULL AND p_lead_phone IS NOT NULL THEN
    SELECT id INTO v_id FROM public.crm_journeys
    WHERE tenant_id = p_tenant_id AND lead_phone = p_lead_phone
      AND (patient_id IS NULL OR patient_id = p_patient_id)
      AND stage_id NOT IN ('won','lost') LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.crm_journeys
    SET patient_id = COALESCE(patient_id, p_patient_id),
        session_id = COALESCE(session_id, p_session_id),
        lead_phone = COALESCE(lead_phone, p_lead_phone),
        updated_at = now()
    WHERE id = v_id;
  ELSE
    BEGIN
      INSERT INTO public.crm_journeys (tenant_id, patient_id, lead_phone, session_id, stage_id, origin, stage_entered_at)
      VALUES (p_tenant_id, p_patient_id, p_lead_phone, p_session_id, 'new_lead', p_origin, now())
      RETURNING id INTO v_id;
      PERFORM public.crm_log_event(v_id, 'journey_created', jsonb_build_object('origin', p_origin), 'system');
      UPDATE public.crm_journeys SET priority_score = public.crm_calculate_priority_score(v_id) WHERE id = v_id;
    EXCEPTION WHEN unique_violation THEN
      -- Corrida entre triggers: outra chamada criou o card primeiro
      SELECT id INTO v_id FROM public.crm_journeys
      WHERE tenant_id = p_tenant_id
        AND ((p_patient_id IS NOT NULL AND patient_id = p_patient_id) OR lead_phone = p_lead_phone)
        AND stage_id NOT IN ('won','lost') LIMIT 1;
      IF v_id IS NULL THEN RAISE; END IF;
    END;
  END IF;

  -- Registra/atualiza a identidade do canal
  IF p_lead_phone IS NOT NULL THEN
    INSERT INTO public.crm_journey_identities (tenant_id, journey_id, channel, identifier, display_name)
    VALUES (p_tenant_id, v_id, COALESCE(p_channel, 'whatsapp'), p_lead_phone, p_display_name)
    ON CONFLICT (tenant_id, channel, identifier)
      DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, crm_journey_identities.display_name);
  END IF;

  RETURN v_id;
END;
$$;

-- 6. Trigger de sessões passa channel + display_name para o motor
CREATE OR REPLACE FUNCTION public.crm_trg_conversation_sessions()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_patient_id uuid;
  v_journey_id uuid;
  v_target_stage text;
  v_current_stage text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT id INTO v_patient_id FROM public.patients
    WHERE tenant_id = NEW.tenant_id
      AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(NEW.patient_phone, '\D', '', 'g')
    LIMIT 1;

    PERFORM public.crm_ensure_journey(
      NEW.tenant_id, v_patient_id, NEW.patient_phone, NEW.id, 'conversation',
      COALESCE(NEW.channel, 'whatsapp'), NEW.platform_display_name);
    RETURN NEW;
  END IF;

  IF NEW.kanban_stage IS NOT DISTINCT FROM OLD.kanban_stage THEN RETURN NEW; END IF;

  SELECT id, stage_id INTO v_journey_id, v_current_stage FROM public.crm_journeys WHERE session_id = NEW.id LIMIT 1;
  IF v_journey_id IS NULL THEN RETURN NEW; END IF;

  v_target_stage := public.crm_stage_from_legacy_label(NEW.kanban_stage);
  IF v_target_stage IS DISTINCT FROM v_current_stage THEN
    BEGIN
      PERFORM public.crm_move_stage(v_journey_id, v_target_stage, 'user');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[crm_trg_conversation_sessions] transição legada inválida % -> % (session %): %',
        v_current_stage, v_target_stage, NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- 7. Sync de display_name: quando o webhook atualizar platform_display_name na
--    sessão, propaga para a identidade correspondente
CREATE OR REPLACE FUNCTION public.crm_trg_session_display_name()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.platform_display_name IS NOT NULL
     AND NEW.platform_display_name IS DISTINCT FROM OLD.platform_display_name THEN
    UPDATE public.crm_journey_identities
    SET display_name = NEW.platform_display_name
    WHERE tenant_id = NEW.tenant_id
      AND channel = COALESCE(NEW.channel, 'whatsapp')
      AND identifier = NEW.patient_phone;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_crm_session_display_name ON public.conversation_sessions;
CREATE TRIGGER tr_crm_session_display_name
  AFTER UPDATE OF platform_display_name ON public.conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.crm_trg_session_display_name();

SELECT 'CRM Identity Resolution — camada de dados aplicada.' AS resultado;
