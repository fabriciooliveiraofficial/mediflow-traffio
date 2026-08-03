-- ==============================================================================
-- E-6 (2026-08-02) — resolve_notification_channel(): Instagram/Facebook nunca
-- sustentam automação atrasada (lembrete, NPS, recuperação) — restrição real
-- da janela de 24h de resposta da Meta. A página Notificações já comunica
-- isso ao tenant (a linha desses dois canais na Matriz de Canais é só um
-- aviso fixo "Indisponível — Restrição da Janela de 24h da Meta", sem nenhum
-- toggle configurável) — por isso eles NUNCA aparecem em
-- bot_config.channel_automations.
--
-- A versão anterior desta função lia essa AUSÊNCIA como "libere por padrão":
--
--   IF v_matrix ? v_ch AND COALESCE(...) = false THEN CONTINUE; END IF;
--   ...
--   ELSIF v_ch IN ('instagram', 'facebook') THEN
--     RETURN QUERY SELECT v_ch, p_patient_phone;
--
-- Quando `v_matrix` nunca tem a chave 'instagram'/'facebook', a condição de
-- pular nunca dispara, e a função devolvia o DM como canal elegível — mesmo
-- a tela avisando que isso não funciona. E pacientes sem NENHUMA preferência
-- salva (ex.: Live Chat, que nunca grava patient_channel_preferences) caíam
-- direto no canal padrão do tenant (tipicamente WhatsApp) sem nunca tentar o
-- e-mail cadastrado primeiro.
--
-- Espelha exatamente a correção já aplicada no lado Deno
-- (_shared/channelResolver.ts, resolveEligibleChannels/filterChannelsByMatrix)
-- — mesma prioridade, mesmo runtime de decisão, as duas cópias devem
-- permanecer sincronizadas.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.resolve_notification_channel(
  p_tenant_id uuid,
  p_patient_phone text,
  p_automation text,
  p_patient_email text DEFAULT NULL::text
)
 RETURNS TABLE(channel text, recipient_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bot_config          jsonb;
  v_matrix              jsonb;
  v_default_ch          text;
  v_pref                record;
  v_candidates          text[];
  v_ch                  text;
  v_email               text;
  v_had_explicit_pref   boolean;
  v_only_meta_or_empty  boolean;

  is_enabled_for CONSTANT text := p_automation;
BEGIN
  SELECT COALESCE(bot_config, '{}'::jsonb) INTO v_bot_config
  FROM public.tenants WHERE id = p_tenant_id;

  v_matrix     := COALESCE(v_bot_config -> 'channel_automations', '{}'::jsonb);
  v_default_ch := LOWER(COALESCE(v_bot_config ->> 'default_notification_channel', 'whatsapp'));
  IF v_default_ch NOT IN ('whatsapp', 'sms', 'email', 'mms') THEN
    v_default_ch := 'whatsapp';
  END IF;

  SELECT * INTO v_pref
  FROM public.patient_channel_preferences
  WHERE tenant_id = p_tenant_id AND patient_phone = p_patient_phone;

  v_had_explicit_pref := v_pref.preferred_channel IS NOT NULL AND v_pref.preferred_channel <> '';

  IF v_had_explicit_pref THEN
    v_candidates := string_to_array(v_pref.preferred_channel, ',');
  ELSE
    -- E-6: sem preferência real salva — NÃO assume mais o canal padrão do
    -- tenant aqui. A decisão fica para a Etapa 2 (e-mail primeiro).
    v_candidates := ARRAY[]::text[];
  END IF;

  v_only_meta_or_empty := (array_length(v_candidates, 1) IS NULL) OR NOT EXISTS (
    SELECT 1 FROM unnest(v_candidates) c WHERE TRIM(c) NOT IN ('instagram', 'facebook')
  );

  -- 1) Preferência explícita do paciente ∩ matriz. Instagram/Facebook NUNCA
  --    são elegíveis para automação, mesmo ausentes da matriz.
  FOREACH v_ch IN ARRAY v_candidates LOOP
    v_ch := TRIM(v_ch);
    IF v_ch IN ('instagram', 'facebook') THEN CONTINUE; END IF;
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
    END IF;
  END LOOP;

  -- 2) Sem NENHUM candidato viável na preferência (vazia, ou só Instagram/
  --    Facebook) — cai direto no e-mail cadastrado, ignorando o canal padrão
  --    genérico do tenant (tipicamente WhatsApp, igualmente inalcançável
  --    para quem nunca deu telefone real — Live Chat, Instagram, Messenger).
  IF v_only_meta_or_empty THEN
    IF v_matrix ? 'email' AND COALESCE((v_matrix -> 'email' ->> is_enabled_for)::boolean, false) = true THEN
      v_email := COALESCE(v_pref.email, p_patient_email);
      IF v_email IS NOT NULL AND v_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
        RETURN QUERY SELECT 'email'::text, v_email;
        RETURN;
      END IF;
    END IF;
    RETURN; -- nenhum canal elegível — nunca cair para WhatsApp silenciosamente
  END IF;

  -- 3) Preferência explícita existia mas nada nela ficou elegível (ex.:
  --    pediu SMS, SMS desligado na matriz) — comportamento histórico
  --    preservado: tenta o canal padrão do tenant.
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
$function$;
