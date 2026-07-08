-- =============================================================================
-- Canal Padrão de Notificação (Atendimento ↔ Inteligência) + Integridade da Fila
-- Data: 2026-07-08
--
-- Problemas corrigidos (achados via auditoria da página Inteligência):
--
--   1. ÍNDICE ÓRFÃO: unique_outbound_message_batch (tenant_id, patient_phone,
--      template_key, reference_id) — sem notification_channel — ainda ativo ao
--      lado do índice correto idx_outbound_queue_unique_msg. Todo ON CONFLICT
--      dos produtores casava com o índice órfão, então a 2ª linha de um
--      lembrete multi-canal (ex.: WhatsApp + E-mail) era descartada em
--      silêncio pelo DO NOTHING. Confirmado em produção: tenant com matriz
--      WhatsApp+E-mail ambos ligados em no_show/nps/recovery teve 100% dos
--      envios saindo por WhatsApp e nenhum por e-mail.
--
--   2. SEM CANAL PADRÃO POR TENANT: a escolha de canal partia sempre da
--      preferência explícita do paciente (default 'whatsapp'), nunca do que o
--      tenant configurou como preferido. Mercados onde WhatsApp não é comum
--      (NZ, EUA) ficavam sem alternativa real. Este bloco adiciona
--      bot_config.default_notification_channel como fonte de verdade do
--      fallback, com resolve_notification_channel() como decisão única.
--
--   3. DRIFT DE FORMATO DE TELEFONE: patient_channel_preferences.patient_phone
--      às vezes divergia de patients.phone (com/sem "+"), criando uma
--      preferência "fantasma" nunca lida pelo motor de envio — quebra literal
--      da integração Atendimento → Inteligência. Corrigido com normalização
--      automática + merge do registro órfão já identificado.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCO 1 — Remover índice/constraint órfão e recriar o definitivo (não-parcial,
-- para que ON CONFLICT (colunas) seja sempre inferível, inclusive via
-- supabase-js .upsert(), sem depender de predicado WHERE no arbiter).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.outbound_message_queue
  DROP CONSTRAINT IF EXISTS unique_outbound_message_batch;

DROP INDEX IF EXISTS public.idx_outbound_queue_unique_msg;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_queue_unique_msg
  ON public.outbound_message_queue (tenant_id, patient_phone, message_type, reference_id, notification_channel);

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCO 2 — Normalização de patient_phone em patient_channel_preferences
--
-- Só normaliza quando o valor bate (em dígitos) com um patients.phone do mesmo
-- tenant — isso evita mexer em IDs de plataforma Meta (Instagram/Facebook)
-- armazenados na mesma coluna, que não são números de telefone.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_channel_pref_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical text;
BEGIN
  SELECT p.phone INTO v_canonical
  FROM public.patients p
  WHERE p.tenant_id = NEW.tenant_id
    AND regexp_replace(p.phone, '[^0-9]', '', 'g') = regexp_replace(NEW.patient_phone, '[^0-9]', '', 'g')
    AND p.phone IS DISTINCT FROM NEW.patient_phone
  LIMIT 1;

  IF v_canonical IS NOT NULL THEN
    NEW.patient_phone := v_canonical;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_normalize_channel_pref_phone ON public.patient_channel_preferences;
CREATE TRIGGER tr_normalize_channel_pref_phone
  BEFORE INSERT OR UPDATE OF patient_phone ON public.patient_channel_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_channel_pref_phone();

-- Merge one-time dos registros órfãos já existentes: adota o canal/e-mail do
-- registro divergente sobre a linha canônica (que já casa com patients.phone),
-- então remove o órfão. Preferência mais recente vence em caso de conflito.
WITH orphans AS (
  SELECT pcp.id AS orphan_id, pcp.tenant_id, p.phone AS canonical_phone,
         pcp.preferred_channel, pcp.email, pcp.sms_phone, pcp.whatsapp_phone,
         pcp.updated_by, pcp.updated_at
  FROM public.patient_channel_preferences pcp
  JOIN public.patients p
    ON p.tenant_id = pcp.tenant_id
   AND regexp_replace(p.phone, '[^0-9]', '', 'g') = regexp_replace(pcp.patient_phone, '[^0-9]', '', 'g')
  WHERE pcp.patient_phone <> p.phone
),
canonical AS (
  SELECT pcp.id AS canonical_id, pcp.tenant_id, pcp.patient_phone, pcp.updated_at
  FROM public.patient_channel_preferences pcp
  JOIN orphans o ON o.tenant_id = pcp.tenant_id AND o.canonical_phone = pcp.patient_phone
)
UPDATE public.patient_channel_preferences target
SET preferred_channel = o.preferred_channel,
    email             = COALESCE(o.email, target.email),
    sms_phone         = COALESCE(o.sms_phone, target.sms_phone),
    whatsapp_phone    = COALESCE(o.whatsapp_phone, target.whatsapp_phone),
    updated_by        = o.updated_by,
    updated_at        = o.updated_at
FROM orphans o
JOIN canonical c ON c.tenant_id = o.tenant_id AND c.patient_phone = o.canonical_phone
WHERE target.id = c.canonical_id
  AND o.updated_at >= c.updated_at;

DELETE FROM public.patient_channel_preferences pcp
USING public.patients p
WHERE p.tenant_id = pcp.tenant_id
  AND regexp_replace(p.phone, '[^0-9]', '', 'g') = regexp_replace(pcp.patient_phone, '[^0-9]', '', 'g')
  AND pcp.patient_phone <> p.phone;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCO 3 — resolve_notification_channel(): decisão única de canal
--
-- Ordem: preferência explícita do paciente ∩ matriz do tenant → canal padrão
-- do tenant (bot_config.default_notification_channel, default 'whatsapp' por
-- retrocompatibilidade) ∩ matriz → nenhum (chamador não envia).
-- E-mail sem endereço válido nunca é retornado como elegível.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_notification_channel(
  p_tenant_id     uuid,
  p_patient_phone text,
  p_automation    text,             -- 'no_show' | 'nps' | 'recovery' | 'videos'
  p_patient_email text DEFAULT NULL
)
RETURNS TABLE(channel text, recipient_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bot_config  jsonb;
  v_matrix      jsonb;
  v_default_ch  text;
  v_pref        record;
  v_candidates  text[];
  v_ch          text;
  v_email       text;

  is_enabled_for CONSTANT text := p_automation;
BEGIN
  SELECT COALESCE(bot_config, '{}'::jsonb) INTO v_bot_config
  FROM public.tenants WHERE id = p_tenant_id;

  v_matrix     := COALESCE(v_bot_config -> 'channel_automations', '{}'::jsonb);
  v_default_ch := LOWER(COALESCE(v_bot_config ->> 'default_notification_channel', 'whatsapp'));

  SELECT * INTO v_pref
  FROM public.patient_channel_preferences
  WHERE tenant_id = p_tenant_id AND patient_phone = p_patient_phone;

  IF v_pref.preferred_channel IS NOT NULL AND v_pref.preferred_channel <> '' THEN
    v_candidates := string_to_array(v_pref.preferred_channel, ',');
  ELSE
    v_candidates := ARRAY[v_default_ch];
  END IF;

  -- 1) Preferência do paciente (ou canal padrão, se sem preferência) ∩ matriz
  FOREACH v_ch IN ARRAY v_candidates LOOP
    v_ch := TRIM(v_ch);
    IF v_matrix ? v_ch AND COALESCE((v_matrix -> v_ch ->> is_enabled_for)::boolean, false) = false THEN
      CONTINUE;
    END IF;

    IF v_ch = 'email' THEN
      v_email := COALESCE(v_pref.email, p_patient_email);
      IF v_email IS NULL OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN CONTINUE; END IF;
      RETURN QUERY SELECT 'email'::text, v_email;
      RETURN;
    ELSIF v_ch IN ('sms', 'mms') THEN
      RETURN QUERY SELECT v_ch, COALESCE(v_pref.sms_phone, p_patient_phone);
      RETURN;
    ELSIF v_ch = 'whatsapp' THEN
      RETURN QUERY SELECT 'whatsapp'::text, COALESCE(v_pref.whatsapp_phone, p_patient_phone);
      RETURN;
    ELSIF v_ch IN ('instagram', 'facebook') THEN
      RETURN QUERY SELECT v_ch, p_patient_phone; -- recipient real resolvido pelo caller (PSID/IGSID)
      RETURN;
    END IF;
  END LOOP;

  -- 2) Sem candidato elegível na preferência: última tentativa pelo canal
  --    padrão do tenant, se habilitado na matriz para esta automação.
  IF NOT (v_default_ch = ANY(v_candidates)) THEN
    IF v_matrix ? v_default_ch AND COALESCE((v_matrix -> v_default_ch ->> is_enabled_for)::boolean, false) = true THEN
      IF v_default_ch = 'email' THEN
        v_email := COALESCE(v_pref.email, p_patient_email);
        IF v_email IS NOT NULL AND v_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
          RETURN QUERY SELECT 'email'::text, v_email;
          RETURN;
        END IF;
      ELSE
        RETURN QUERY SELECT v_default_ch, p_patient_phone;
        RETURN;
      END IF;
    END IF;
  END IF;

  RETURN; -- nenhum canal elegível — nunca cair para WhatsApp silenciosamente
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_notification_channel(uuid, text, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCO 4 — Trigger de NPS: usa resolve_notification_channel() em vez do
-- fallback fixo 'whatsapp' (2 ocorrências no código antigo). onConflict
-- realinhado para o índice definitivo (message_type, não template_key).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enqueue_nps_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bot_config     jsonb;
  v_tenant_name    text;
  v_tenant_tz      text;
  v_nps_channels   jsonb;
  v_delay_minutes  int;
  v_patient_phone  text;
  v_patient_name   text;
  v_patient_email  text;
  v_patient_locale text;
  v_locale         text;
  v_scheduled_at   timestamptz;
  v_local_hour     int;
  v_resolved       record;
BEGIN
  IF NEW.status != 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  UPDATE public.appointments
  SET    completed_at = NOW()
  WHERE  id           = NEW.id
    AND  completed_at IS NULL;

  SELECT
    COALESCE(bot_config, '{}'::jsonb),
    COALESCE(name, 'Clínica'),
    COALESCE(timezone, 'America/Sao_Paulo')
  INTO v_bot_config, v_tenant_name, v_tenant_tz
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  v_nps_channels := v_bot_config -> 'channel_automations';
  IF v_nps_channels IS NULL THEN RETURN NEW; END IF;

  IF NOT (
    COALESCE((v_nps_channels -> 'whatsapp' ->> 'nps')::boolean, false) OR
    COALESCE((v_nps_channels -> 'sms'      ->> 'nps')::boolean, false) OR
    COALESCE((v_nps_channels -> 'email'    ->> 'nps')::boolean, false)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT phone, full_name, email, COALESCE(preferred_locale, 'pt')
  INTO   v_patient_phone, v_patient_name, v_patient_email, v_patient_locale
  FROM   public.patients
  WHERE  id = NEW.patient_id;

  IF v_patient_phone IS NULL THEN RETURN NEW; END IF;

  v_locale := LOWER(COALESCE(v_bot_config ->> 'notification_locale', v_patient_locale, 'pt'));
  IF v_locale NOT IN ('pt', 'en', 'es') THEN
    v_locale := 'pt';
  END IF;

  v_delay_minutes := COALESCE((v_bot_config ->> 'nps_delay_minutes')::int, 180);
  v_scheduled_at  := NOW() + make_interval(mins => v_delay_minutes);

  v_local_hour := EXTRACT(HOUR FROM (v_scheduled_at AT TIME ZONE v_tenant_tz))::int;
  IF v_local_hour >= 22 THEN
    v_scheduled_at := (
      date_trunc('day', v_scheduled_at AT TIME ZONE v_tenant_tz)
      + interval '1 day'
      + interval '8 hours'
    ) AT TIME ZONE v_tenant_tz;
  ELSIF v_local_hour < 8 THEN
    v_scheduled_at := (
      date_trunc('day', v_scheduled_at AT TIME ZONE v_tenant_tz)
      + interval '8 hours'
    ) AT TIME ZONE v_tenant_tz;
  END IF;

  -- Fonte única de decisão de canal: preferência do paciente ∩ matriz →
  -- canal padrão do tenant ∩ matriz → nenhum (não enfileira às cegas).
  SELECT * INTO v_resolved
  FROM public.resolve_notification_channel(NEW.tenant_id, v_patient_phone, 'nps', v_patient_email);

  IF v_resolved.channel IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.outbound_message_queue (
    tenant_id, patient_phone, message_type, template_key, template_vars,
    scheduled_at, reference_id, reference_type, status,
    notification_channel, channel_recipient_id, is_edited
  ) VALUES (
    NEW.tenant_id, v_patient_phone, 'nps_survey', 'nps_survey',
    jsonb_build_object(
      'patient_name', v_patient_name,
      'clinic_name',  v_tenant_name,
      'locale',       v_locale
    ),
    v_scheduled_at, NEW.id, 'appointment', 'pending',
    v_resolved.channel, v_resolved.recipient_id, false
  )
  ON CONFLICT (tenant_id, patient_phone, message_type, reference_id, notification_channel)
  DO NOTHING;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[enqueue_nps_on_completion] Appt %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCO 5 — Semear default_notification_channel = 'whatsapp' nos tenants
-- existentes (retrocompatibilidade explícita: nenhum comportamento muda para
-- quem já usa o sistema hoje até que o tenant escolha outro canal padrão).
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.tenants
SET bot_config = COALESCE(bot_config, '{}'::jsonb) || jsonb_build_object('default_notification_channel', 'whatsapp')
WHERE bot_config IS NOT NULL
  AND (bot_config ->> 'default_notification_channel') IS NULL;

SELECT 'Migration 20260708_default_channel_and_queue_integrity aplicada com sucesso.' AS resultado;
