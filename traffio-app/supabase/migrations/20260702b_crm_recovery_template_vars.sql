-- =============================================================================
-- CRM Recovery — template_vars completas para as automações de estágio
-- Data: 2026-07-02
--
-- Contexto: crm_dispatch_automations enfileirava mensagens com template_vars
-- contendo apenas journey_id/procedure_name. Os templates recovery_*/recall_*
-- precisam de patient_name, clinic_name e locale (idioma padrão do tenant,
-- bot_config.notification_locale) para renderizar corretamente no
-- process-outbound.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.crm_dispatch_automations(p_journey_id uuid, p_cycle int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  j public.crm_journeys;
  v_phone text;
  a RECORD;
  v_scheduled_at timestamptz;
  v_run_id uuid;
  v_outbound_id uuid;
  v_patient_name text;
  v_patient_locale text;
  v_clinic_name text;
  v_bot_config jsonb;
  v_locale text;
BEGIN
  SELECT * INTO j FROM public.crm_journeys WHERE id = p_journey_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_phone := j.lead_phone;
  IF j.patient_id IS NOT NULL THEN
    SELECT phone, full_name, preferred_locale
    INTO v_phone, v_patient_name, v_patient_locale
    FROM public.patients WHERE id = j.patient_id;
    v_phone := COALESCE(j.lead_phone, v_phone);
  END IF;
  IF v_phone IS NULL THEN RETURN; END IF;

  -- Nome de exibição do lead quando ainda não há paciente vinculado
  IF v_patient_name IS NULL AND j.session_id IS NOT NULL THEN
    SELECT platform_display_name INTO v_patient_name
    FROM public.conversation_sessions WHERE id = j.session_id;
  END IF;

  SELECT COALESCE(name, 'Clínica'), COALESCE(bot_config, '{}'::jsonb)
  INTO v_clinic_name, v_bot_config
  FROM public.tenants WHERE id = j.tenant_id;

  -- Fonte de verdade do idioma: bot_config.notification_locale (página
  -- Inteligência). Fallback: preferred_locale do paciente (legado) → 'pt'.
  v_locale := LOWER(COALESCE(v_bot_config ->> 'notification_locale', v_patient_locale, 'pt'));
  IF v_locale NOT IN ('pt', 'en', 'es') THEN v_locale := 'pt'; END IF;

  FOR a IN
    SELECT DISTINCT ON (stage_id, template_key) *
    FROM public.crm_stage_automations
    WHERE stage_id = j.stage_id AND trigger_kind = 'on_enter' AND is_active = true
      AND (tenant_id = j.tenant_id OR tenant_id IS NULL)
    ORDER BY stage_id, template_key, tenant_id NULLS LAST  -- override do tenant vence o default global
  LOOP
    v_scheduled_at := public.crm_clamp_to_send_window(j.tenant_id, j.stage_entered_at + (a.delay_hours * interval '1 hour'));

    INSERT INTO public.crm_automation_runs (tenant_id, journey_id, automation_id, cycle, status)
    VALUES (j.tenant_id, p_journey_id, a.id, p_cycle, 'scheduled')
    ON CONFLICT (journey_id, automation_id, cycle) DO NOTHING
    RETURNING id INTO v_run_id;

    IF v_run_id IS NOT NULL THEN
      -- message_type = template_key (não uma constante): o índice único
      -- idx_outbound_queue_unique_msg já existente é por
      -- (tenant_id, patient_phone, message_type, reference_id, notification_channel).
      -- Como reference_id é o journey_id (igual para todas as mensagens da
      -- cadência D0/D2/D7), message_type precisa diferenciar cada uma —
      -- mesma convenção que o resto do app já usa ('recall', 'nps', etc.).
      INSERT INTO public.outbound_message_queue
        (tenant_id, patient_phone, message_type, template_key, template_vars, scheduled_at, status, reference_id, reference_type)
      VALUES
        (j.tenant_id, v_phone, a.template_key, a.template_key,
         jsonb_build_object(
           'journey_id',     p_journey_id,
           'procedure_name', j.procedure_name,
           'patient_name',   COALESCE(v_patient_name, ''),
           'clinic_name',    v_clinic_name,
           'locale',         v_locale
         ),
         v_scheduled_at, 'pending', p_journey_id, 'crm_journey')
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_outbound_id;

      UPDATE public.crm_automation_runs SET outbound_id = v_outbound_id WHERE id = v_run_id;
      PERFORM public.crm_log_event(p_journey_id, 'automation_fired',
        jsonb_build_object('template_key', a.template_key, 'scheduled_at', v_scheduled_at), 'system');
    END IF;
  END LOOP;
END;
$$;

-- Mensagens recovery_*/recall_immediate já enfileiradas sem template no código
-- teriam sido (ou seriam) enviadas como "[Template ... não encontrado]".
-- Cancela as pendentes; as novas entram com vars completas.
UPDATE public.outbound_message_queue
SET status = 'cancelled',
    error_message = 'Cancelled: template missing at enqueue time (fixed in 20260702b)'
WHERE status = 'pending'
  AND reference_type = 'crm_journey'
  AND template_key IN ('recovery_immediate', 'recovery_48h', 'recovery_7d', 'recall_immediate')
  AND (template_vars ->> 'patient_name') IS NULL;

SELECT 'Migration 20260702b_crm_recovery_template_vars aplicada.' AS resultado;
