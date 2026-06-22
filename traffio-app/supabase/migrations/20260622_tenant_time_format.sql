-- Alter table tenants to add time_format column
alter table public.tenants
  add column if not exists time_format text check (time_format in ('12h', '24h'));

comment on column public.tenants.time_format is
  'Time format preference for the tenant (12h or 24h). If null, defaults to country standard.';
