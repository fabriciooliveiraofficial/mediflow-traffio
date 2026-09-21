-- tenants.timezone é a FONTE ÚNICA de tempo da plataforma: prompt do agente
-- (RELÓGIO DA CLÍNICA), ferramentas de agenda (getTenantClock), lembretes,
-- janelas de envio e recall. A coluna já era NOT NULL com default, mas aceitava
-- qualquer texto — e um fuso inválido ("Auckland", "GMT+12 ", typo) faz o
-- Intl.DateTimeFormat lançar e o código cair CALADO em UTC/Brasil: o agente
-- passaria a errar "hoje/amanhã" sem nenhum erro visível.
--
-- Não altera nenhum valor existente (todos os tenants já têm fuso IANA válido;
-- ver feedback "tenant timezone imutável"). Só impede salvar um inválido.

CREATE OR REPLACE FUNCTION public.is_valid_timezone(p_tz text)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz);
$$;

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_timezone_valid;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_timezone_valid CHECK (public.is_valid_timezone(timezone));
