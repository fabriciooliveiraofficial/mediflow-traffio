-- =============================================================================
-- TRAFFIO / MEDIFLOW — Widget de Agendamento (Fase 1.5: anti-abuso)
-- -----------------------------------------------------------------------------
-- Rate limiting por (tenant, IP, ação) para o endpoint público `public-booking`.
-- A edge function chama check_widget_rate_limit() antes de lock/book.
-- =============================================================================

create table if not exists public.widget_rate_limit (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  ip          text not null,
  action      text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_widget_rate_limit_lookup
  on public.widget_rate_limit (tenant_id, ip, action, created_at desc);

alter table public.widget_rate_limit enable row level security;
-- sem policy: somente service_role (edge function) acessa.

-- Conta tentativas recentes na janela; se abaixo do limite, registra e libera.
create or replace function public.check_widget_rate_limit(
  p_tenant_id  uuid,
  p_ip         text,
  p_action     text,
  p_max        int,
  p_window_secs int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.widget_rate_limit
  where tenant_id = p_tenant_id
    and ip = p_ip
    and action = p_action
    and created_at > now() - make_interval(secs => p_window_secs);

  if v_count >= p_max then
    return false;  -- estourou o limite
  end if;

  insert into public.widget_rate_limit (tenant_id, ip, action)
  values (p_tenant_id, p_ip, p_action);
  return true;
end; $$;

comment on table public.widget_rate_limit is
  'Rate limiting do widget público de agendamento. Limpeza via cron (manter ~1 dia).';

-- Limpeza periódica (mantém ~1 dia). Requer pg_cron — ignora se indisponível.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'widget_rate_limit_cleanup',
      '17 3 * * *',
      $cron$ delete from public.widget_rate_limit where created_at < now() - interval '1 day'; $cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron indisponível; limpeza de widget_rate_limit deve ser agendada manualmente.';
end $$;
