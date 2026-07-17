-- Knowledge architecture, phase 1: make clinic_info safe and writable by
-- tenant administrators. Service-role clients bypass RLS for the agent.

begin;

alter table public.clinic_info enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'clinic_info_value_length'
          and conrelid = 'public.clinic_info'::regclass
    ) then
        -- NOT VALID preserves deployability if legacy rows are oversized while
        -- enforcing the limit for every new/updated row immediately.
        alter table public.clinic_info
            add constraint clinic_info_value_length
            check (char_length(value) <= 4000) not valid;
    end if;
end
$$;

-- Policies REAIS de produção (verificadas em 2026-07-17): a antiga
-- "Public look up clinic info" tem qual=true para o papel `public` — leitura
-- cross-tenant aberta a QUALQUER um. É o vazamento que esta migration fecha;
-- precisa ser dropada pelo nome real, senão sobrevive e (RLS permissiva = OR)
-- mantém o buraco aberto mesmo com as novas policies restritivas.
drop policy if exists "Public look up clinic info" on public.clinic_info;
drop policy if exists "Admins can manage clinic info" on public.clinic_info;
-- Nomes das próprias policies desta migration (idempotência em re-execução).
drop policy if exists "Tenants look up clinic info" on public.clinic_info;
drop policy if exists "Tenant members can view clinic info" on public.clinic_info;
drop policy if exists "Tenant admins can insert clinic info" on public.clinic_info;
drop policy if exists "Tenant admins can update clinic info" on public.clinic_info;
drop policy if exists "Tenant admins can delete clinic info" on public.clinic_info;

create policy "Tenant members can view clinic info"
on public.clinic_info
for select
to authenticated
using (
    exists (
        select 1
        from public.members m
        where m.tenant_id = clinic_info.tenant_id
          and m.user_id = auth.uid()
          and m.is_active = true
    )
);

create policy "Tenant admins can insert clinic info"
on public.clinic_info
for insert
to authenticated
with check (
    exists (
        select 1
        from public.members m
        where m.tenant_id = clinic_info.tenant_id
          and m.user_id = auth.uid()
          and m.is_active = true
          and m.role in ('owner', 'admin')
    )
);

create policy "Tenant admins can update clinic info"
on public.clinic_info
for update
to authenticated
using (
    exists (
        select 1
        from public.members m
        where m.tenant_id = clinic_info.tenant_id
          and m.user_id = auth.uid()
          and m.is_active = true
          and m.role in ('owner', 'admin')
    )
)
with check (
    exists (
        select 1
        from public.members m
        where m.tenant_id = clinic_info.tenant_id
          and m.user_id = auth.uid()
          and m.is_active = true
          and m.role in ('owner', 'admin')
    )
);

create policy "Tenant admins can delete clinic info"
on public.clinic_info
for delete
to authenticated
using (
    exists (
        select 1
        from public.members m
        where m.tenant_id = clinic_info.tenant_id
          and m.user_id = auth.uid()
          and m.is_active = true
          and m.role in ('owner', 'admin')
    )
);

grant select, insert, update, delete on table public.clinic_info to authenticated;
grant all on table public.clinic_info to service_role;

commit;
