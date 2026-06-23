-- =============================================================================
-- EXCHANGE RATES — cache de cotação BRL -> moeda local (display-only)
--
-- BRL é sempre a fonte de verdade (cobrança, Stripe, ad spend ficam intocados).
-- Esta tabela só serve para EXIBIR valores de analytics/dashboard na moeda do
-- país do tenant. Atualizada 1x/dia pela Edge Function `refresh-exchange-rates`,
-- que busca a cotação na Frankfurter API (api.frankfurter.dev, gratuita, sem
-- cadastro/API key).
-- =============================================================================

create table if not exists public.exchange_rates (
  target_currency text primary key,           -- 'USD' | 'MXN' | 'NZD' (base é sempre BRL, implícita)
  rate numeric(18,8) not null,                 -- unidades de target_currency por 1 BRL
  fetched_at timestamptz not null default now(),
  source text not null default 'frankfurter.dev',
  created_at timestamptz not null default now()
);

alter table public.exchange_rates enable row level security;

drop policy if exists "exchange_rates_select_authenticated" on public.exchange_rates;
create policy "exchange_rates_select_authenticated"
  on public.exchange_rates
  for select
  to authenticated
  using (true);

-- Sem policy de INSERT/UPDATE/DELETE: só a Edge Function (service role) escreve,
-- e service role ignora RLS por padrão.

-- =============================================================================
-- CRON — refresh diário (06:00 UTC = 03:00 BRT, antes do horário comercial)
-- PASSO: substitua <<<SEU_SERVICE_ROLE_KEY>>> pela chave real
-- Obtenha em: Settings → API → "service_role" (começa com eyJ...)
-- =============================================================================

select cron.unschedule(jobname)
from cron.job
where jobname = 'refresh-exchange-rates-daily';

select cron.schedule(
  'refresh-exchange-rates-daily',
  '0 6 * * *',
  $$
    select net.http_post(
      url     := 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/refresh-exchange-rates',
      body    := '{}',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer <<<SEU_SERVICE_ROLE_KEY>>>"}'::jsonb
    );
  $$
);

-- Verificar que o cron foi criado:
select jobid, jobname, schedule, active
from cron.job
where jobname = 'refresh-exchange-rates-daily';

-- Disparar manualmente agora para popular a tabela pela primeira vez
-- (substitua <<<SEU_SERVICE_ROLE_KEY>>> aqui também):
select net.http_post(
  url     := 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/refresh-exchange-rates',
  body    := '{}',
  headers := '{"Content-Type":"application/json","Authorization":"Bearer <<<SEU_SERVICE_ROLE_KEY>>>"}'::jsonb
);
