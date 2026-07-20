begin;

create table if not exists public.clinic_fact_suggestions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    destination text not null check (destination in ('clinic_info', 'knowledge_base')),
    fact_key text null,
    title text null,
    suggested_value text not null,
    source_type text not null check (source_type in ('url', 'pasted_text', 'file', 'interview')),
    source_reference text null,
    source_excerpt text null,
    clarity text not null default 'medium' check (clarity in ('high', 'medium', 'low')),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    created_at timestamptz not null default now(),
    reviewed_at timestamptz null,
    reviewed_by uuid null references auth.users(id),
    suggestion_identity text generated always as (
        case when status = 'pending'
            then destination || ':' || coalesce(fact_key, lower(title))
            else null
        end
    ) stored,
    constraint clinic_fact_suggestions_value_length
        check (char_length(suggested_value) between 1 and 2000),
    constraint clinic_fact_suggestions_title_length
        check (title is null or char_length(title) between 1 and 200),
    constraint clinic_fact_suggestions_excerpt_length
        check (source_excerpt is null or char_length(source_excerpt) <= 500),
    constraint clinic_fact_suggestions_destination_fields
        check (
            (destination = 'clinic_info' and fact_key is not null and title is null)
            or
            (destination = 'knowledge_base' and fact_key is null and title is not null)
        ),
    constraint clinic_fact_suggestions_review_fields
        check (
            (status = 'pending' and reviewed_at is null and reviewed_by is null)
            or
            (status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by is not null)
        )
);

create index if not exists clinic_fact_suggestions_pending_tenant_idx
    on public.clinic_fact_suggestions (tenant_id, created_at desc)
    where status = 'pending';

create unique index if not exists clinic_fact_suggestions_pending_identity_uidx
    on public.clinic_fact_suggestions (tenant_id, suggestion_identity);

alter table public.clinic_fact_suggestions enable row level security;

-- Antes de aplicar, confira `pg_policies` em produção. Policies permissivas
-- desconhecidas combinam por OR e devem ser removidas pelo nome real.
drop policy if exists "Tenant admins can view clinic fact suggestions" on public.clinic_fact_suggestions;
drop policy if exists "Tenant admins can update clinic fact suggestions" on public.clinic_fact_suggestions;

create policy "Tenant admins can view clinic fact suggestions"
on public.clinic_fact_suggestions for select to authenticated
using (exists (
    select 1 from public.members m
    where m.tenant_id = clinic_fact_suggestions.tenant_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role in ('owner', 'admin')
));

create policy "Tenant admins can update clinic fact suggestions"
on public.clinic_fact_suggestions for update to authenticated
using (exists (
    select 1 from public.members m
    where m.tenant_id = clinic_fact_suggestions.tenant_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role in ('owner', 'admin')
))
with check (exists (
    select 1 from public.members m
    where m.tenant_id = clinic_fact_suggestions.tenant_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role in ('owner', 'admin')
));

-- Não há policy de INSERT para authenticated: somente a Edge Function,
-- usando service_role após autorizar o chamador, cria sugestões.
grant select, update on table public.clinic_fact_suggestions to authenticated;
grant all on table public.clinic_fact_suggestions to service_role;

-- A policy legada real de knowledge_base (20260406_knowledge_base.sql) só
-- concede escrita ao papel `manager`. O fluxo desta fase é exclusivo de
-- owner/admin, então habilitamos a gravação do destino para esses dois papéis.
drop policy if exists "Tenant admins can insert knowledge base" on public.knowledge_base;
drop policy if exists "Tenant admins can update knowledge base" on public.knowledge_base;

create policy "Tenant admins can insert knowledge base"
on public.knowledge_base for insert to authenticated
with check (exists (
    select 1 from public.members m
    where m.tenant_id = knowledge_base.tenant_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role in ('owner', 'admin')
));

create policy "Tenant admins can update knowledge base"
on public.knowledge_base for update to authenticated
using (exists (
    select 1 from public.members m
    where m.tenant_id = knowledge_base.tenant_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role in ('owner', 'admin')
))
with check (exists (
    select 1 from public.members m
    where m.tenant_id = knowledge_base.tenant_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role in ('owner', 'admin')
));

grant insert, update on table public.knowledge_base to authenticated;

commit;
