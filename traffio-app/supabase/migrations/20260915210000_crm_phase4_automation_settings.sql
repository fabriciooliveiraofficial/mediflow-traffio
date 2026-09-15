-- =============================================================================
-- CRM — Fase 4: painel de automações do Follow-up
--
-- Prazos de lembrete por clínica (bot_config.crm_sla_hours, JSON null = desligado):
--   new_lead   — contato novo sem resposta   (padrão global 24 h)
--   showed_up  — veio e não tem orçamento     (padrão global 48 h)
--   proposal   — orçamento sem resposta       (padrão global 96 h)
-- São lembretes INTERNOS: o card entra na lista "Hoje". Nenhuma mensagem ao paciente.
--
-- Recuperação de faltas e convite de retorno NÃO ganham configuração nova: o painel
-- lê e grava exatamente os mesmos campos da página Notificações
-- (channel_automations.*.recovery, recall_enabled, recall_days) — uma fonte só.
--
-- Rollback: supabase/rollbacks/20260915_crm_phase4_rollback.sql
-- =============================================================================

-- 1. Prazo efetivo de uma etapa para uma clínica ------------------------------
CREATE OR REPLACE FUNCTION public.crm_stage_sla_hours(p_tenant_id uuid, p_stage text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN t.bot_config ? 'crm_sla_hours' AND (t.bot_config -> 'crm_sla_hours') ? p_stage
      THEN NULLIF(t.bot_config -> 'crm_sla_hours' ->> p_stage, '')::integer
    ELSE s.sla_hours
  END
  FROM public.crm_stages s
  LEFT JOIN public.tenants t ON t.id = p_tenant_id
  WHERE s.id = p_stage;
$function$;

REVOKE ALL ON FUNCTION public.crm_stage_sla_hours(uuid, text) FROM PUBLIC, anon, authenticated;

-- 2. crm_move_stage usa o prazo da clínica (resto idêntico à Fase 1) -----------
CREATE OR REPLACE FUNCTION public.crm_move_stage(p_journey_id uuid, p_to_stage text, p_actor text DEFAULT 'user'::text, p_reason text DEFAULT NULL::text, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS crm_journeys
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  j public.crm_journeys;
  v_old_stage text;
  v_allowed boolean;
  v_cycle int;
  v_sla_hours int;
  v_next_action_type text;
  v_revenue numeric;
  v_procedure text;
  v_legacy_label text;
  v_system_fact boolean;
BEGIN
  v_system_fact := COALESCE(current_setting('crm.system_fact', true), '') = 'on';
  PERFORM set_config('crm.system_fact', 'off', true);

  SELECT * INTO j FROM public.crm_journeys WHERE id = p_journey_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_journey % not found', p_journey_id;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.members WHERE user_id = auth.uid() AND tenant_id = j.tenant_id
    ) THEN
      RAISE EXCEPTION 'forbidden: user does not belong to this tenant' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_old_stage := j.stage_id;

  IF p_to_stage = v_old_stage THEN
    RETURN j;
  END IF;

  v_allowed := v_system_fact OR (p_to_stage = 'lost') OR EXISTS (
    SELECT 1 FROM public.crm_stage_transitions WHERE from_stage = v_old_stage AND to_stage = p_to_stage
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid stage transition: % -> %', v_old_stage, p_to_stage USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) + 1 INTO v_cycle
  FROM public.crm_journey_events
  WHERE journey_id = p_journey_id AND event_type = 'stage_changed' AND payload->>'to' = p_to_stage;

  v_sla_hours := public.crm_stage_sla_hours(j.tenant_id, p_to_stage);

  v_next_action_type := CASE p_to_stage
    WHEN 'new_lead'   THEN 'message'
    WHEN 'in_contact' THEN 'call'
    WHEN 'showed_up'  THEN 'follow_proposal'
    WHEN 'proposal'   THEN 'follow_proposal'
    WHEN 'recovery'   THEN 'recover'
    WHEN 'recall_due' THEN 'recall'
    ELSE NULL
  END;

  v_revenue   := NULLIF(p_extra->>'revenue_estimated', '')::numeric;
  v_procedure := p_extra->>'procedure_name';

  UPDATE public.crm_journeys SET
    stage_id           = p_to_stage,
    stage_entered_at   = now(),
    last_event_at      = now(),
    updated_at         = now(),
    needs_action        = false,
    next_action_type    = v_next_action_type,
    next_action_at       = CASE WHEN v_sla_hours IS NOT NULL THEN now() + (v_sla_hours * interval '1 hour') ELSE NULL END,
    lost_reason          = CASE WHEN p_to_stage = 'lost' THEN COALESCE(p_reason, lost_reason) ELSE lost_reason END,
    revenue_estimated    = COALESCE(v_revenue, revenue_estimated),
    procedure_name       = COALESCE(v_procedure, procedure_name)
  WHERE id = p_journey_id
  RETURNING * INTO j;

  PERFORM public.crm_log_event(p_journey_id, 'stage_changed',
    jsonb_build_object('from', v_old_stage, 'to', p_to_stage, 'reason', p_reason) || p_extra, p_actor);

  UPDATE public.crm_journeys SET priority_score = public.crm_calculate_priority_score(id) WHERE id = p_journey_id
  RETURNING * INTO j;

  IF j.session_id IS NOT NULL THEN
    v_legacy_label := public.crm_legacy_stage_label(p_to_stage, j.appointments_count);
    UPDATE public.conversation_sessions
    SET kanban_stage = v_legacy_label
    WHERE id = j.session_id AND kanban_stage IS DISTINCT FROM v_legacy_label;
  END IF;

  PERFORM public.crm_dispatch_automations(p_journey_id, v_cycle);

  RETURN j;
END;
$function$;

-- 3. Varredura de prazos usa o prazo da clínica ------------------------------
CREATE OR REPLACE FUNCTION public.crm_sweep_journey_sla()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.crm_journeys
  SET needs_action = true
  WHERE stage_id NOT IN ('won','lost')
    AND needs_action = false
    AND (
      (next_action_at IS NOT NULL AND next_action_at <= now())
      OR (
        next_action_at IS NULL
        AND stage_entered_at + (public.crm_stage_sla_hours(tenant_id, stage_id) * interval '1 hour') <= now()
      )
    );

  UPDATE public.crm_journeys
  SET priority_score = public.crm_calculate_priority_score(id)
  WHERE stage_id NOT IN ('won','lost');
END;
$function$;

-- 4. Ler as automações do Follow-up de uma clínica ---------------------------
CREATE OR REPLACE FUNCTION public.crm_get_followup_automations(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg jsonb;
  v_ca jsonb;
  v_default text;
  v_recovery boolean;
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.members WHERE user_id = auth.uid() AND tenant_id = p_tenant_id LIMIT 1;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(bot_config, '{}'::jsonb) INTO v_cfg FROM public.tenants WHERE id = p_tenant_id;
  v_ca := COALESCE(v_cfg -> 'channel_automations', '{}'::jsonb);
  v_default := COALESCE(v_cfg ->> 'default_notification_channel', 'whatsapp');

  -- Mesma regra de filterChannelsByMatrix (process-outbound): canal fora da matriz
  -- = liga; WhatsApp sem a chave recovery = liga (retrocompatibilidade).
  SELECT bool_or(
    CASE
      WHEN NOT (v_ca ? ch) THEN ch <> 'email'
      WHEN ch = 'whatsapp' AND NOT ((v_ca -> ch) ? 'recovery') THEN true
      ELSE COALESCE((v_ca -> ch ->> 'recovery')::boolean, false)
    END)
  INTO v_recovery
  FROM unnest(ARRAY[v_default, 'whatsapp', 'sms']) AS ch;

  RETURN jsonb_build_object(
    'can_edit',        v_role IN ('owner','admin'),
    'new_lead_hours',  public.crm_stage_sla_hours(p_tenant_id, 'new_lead'),
    'showed_up_hours', public.crm_stage_sla_hours(p_tenant_id, 'showed_up'),
    'proposal_hours',  public.crm_stage_sla_hours(p_tenant_id, 'proposal'),
    'defaults', jsonb_build_object(
      'new_lead_hours',  (SELECT sla_hours FROM public.crm_stages WHERE id = 'new_lead'),
      'showed_up_hours', (SELECT sla_hours FROM public.crm_stages WHERE id = 'showed_up'),
      'proposal_hours',  (SELECT sla_hours FROM public.crm_stages WHERE id = 'proposal')
    ),
    'recovery_enabled', COALESCE(v_recovery, false),
    'recall_enabled',   COALESCE((v_cfg ->> 'recall_enabled')::boolean, false),
    'recall_days',      COALESCE((v_cfg ->> 'recall_days')::int, 180)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_get_followup_automations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_get_followup_automations(uuid) TO authenticated;

-- 5. Gravar (só dono/admin), com reajuste dos cards abertos --------------------
-- p_settings aceita qualquer subconjunto de:
--   new_lead_hours / showed_up_hours / proposal_hours : int ou null (desligado)
--   recovery_enabled : bool     recall_enabled : bool     recall_days : int
CREATE OR REPLACE FUNCTION public.crm_update_followup_automations(p_tenant_id uuid, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg jsonb;
  v_ca jsonb;
  v_default text;
  v_key text;
  v_stage text;
  v_old int;
  v_new int;
  v_on boolean;
  ch text;
  v_row_defaults jsonb := jsonb_build_object(
    'whatsapp', jsonb_build_object('no_show', true,  'videos', true,  'nps', true),
    'sms',      jsonb_build_object('no_show', true,  'videos', false, 'nps', true),
    'email',    jsonb_build_object('no_show', false, 'videos', false, 'nps', true)
  );
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.members
    WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND role IN ('owner','admin')
  ) THEN
    RAISE EXCEPTION 'forbidden: only the clinic owner or an admin can change automations' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(bot_config, '{}'::jsonb) INTO v_cfg FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;

  -- Prazos internos
  FOREACH v_key IN ARRAY ARRAY['new_lead_hours','showed_up_hours','proposal_hours'] LOOP
    CONTINUE WHEN NOT (p_settings ? v_key);
    v_stage := replace(v_key, '_hours', '');
    v_old := public.crm_stage_sla_hours(p_tenant_id, v_stage);
    v_new := NULLIF(p_settings ->> v_key, '')::int;
    IF v_new IS NOT NULL AND (v_new < 1 OR v_new > 2160) THEN
      RAISE EXCEPTION 'invalid hours for %: %', v_stage, v_new USING ERRCODE = '22023';
    END IF;

    v_cfg := jsonb_set(v_cfg, '{crm_sla_hours}', COALESCE(v_cfg -> 'crm_sla_hours', '{}'::jsonb), true);
    v_cfg := jsonb_set(v_cfg, ARRAY['crm_sla_hours', v_stage], COALESCE(to_jsonb(v_new), 'null'::jsonb), true);

    -- Reajusta só prazos que vieram do padrão da etapa (adiamentos manuais ficam)
    IF v_old IS DISTINCT FROM v_new AND v_old IS NOT NULL THEN
      UPDATE public.crm_journeys
      SET next_action_at = CASE WHEN v_new IS NULL THEN NULL ELSE stage_entered_at + v_new * interval '1 hour' END,
          needs_action   = CASE
                             WHEN v_new IS NULL THEN false
                             ELSE stage_entered_at + v_new * interval '1 hour' <= now()
                           END
      WHERE tenant_id = p_tenant_id
        AND stage_id = v_stage
        AND next_action_at IS NOT NULL
        AND abs(extract(epoch FROM next_action_at - (stage_entered_at + v_old * interval '1 hour'))) < 60;
    END IF;
  END LOOP;

  -- Recuperação de faltas: mesmos campos da página Notificações
  IF p_settings ? 'recovery_enabled' THEN
    v_on := (p_settings ->> 'recovery_enabled')::boolean;
    v_ca := COALESCE(v_cfg -> 'channel_automations', '{}'::jsonb);
    v_default := COALESCE(v_cfg ->> 'default_notification_channel', 'whatsapp');
    IF v_default NOT IN ('whatsapp','sms','email') THEN v_default := 'whatsapp'; END IF;

    IF v_on THEN
      v_ca := jsonb_set(v_ca, ARRAY[v_default],
        COALESCE(v_ca -> v_default, v_row_defaults -> v_default) || jsonb_build_object('recovery', true), true);
    ELSE
      FOREACH ch IN ARRAY ARRAY['whatsapp','sms','email'] LOOP
        v_ca := jsonb_set(v_ca, ARRAY[ch],
          COALESCE(v_ca -> ch, v_row_defaults -> ch) || jsonb_build_object('recovery', false), true);
      END LOOP;
    END IF;
    v_cfg := jsonb_set(v_cfg, '{channel_automations}', v_ca, true);
  END IF;

  -- Convite de retorno: mesmos campos da página Notificações
  IF p_settings ? 'recall_enabled' THEN
    v_cfg := jsonb_set(v_cfg, '{recall_enabled}', to_jsonb((p_settings ->> 'recall_enabled')::boolean), true);
  END IF;
  IF p_settings ? 'recall_days' THEN
    IF (p_settings ->> 'recall_days')::int NOT BETWEEN 30 AND 1095 THEN
      RAISE EXCEPTION 'invalid recall_days: %', p_settings ->> 'recall_days' USING ERRCODE = '22023';
    END IF;
    v_cfg := jsonb_set(v_cfg, '{recall_days}', to_jsonb((p_settings ->> 'recall_days')::int), true);
  END IF;

  UPDATE public.tenants SET bot_config = v_cfg WHERE id = p_tenant_id;

  RETURN public.crm_get_followup_automations(p_tenant_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_update_followup_automations(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_update_followup_automations(uuid, jsonb) TO authenticated;
