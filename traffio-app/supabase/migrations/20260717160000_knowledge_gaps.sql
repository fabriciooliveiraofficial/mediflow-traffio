begin;

create table if not exists public.knowledge_gaps (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    patient_question text not null,
    normalized_question text not null,
    status text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
    occurrences integer not null default 1 check (occurrences > 0),
    first_detected_at timestamptz not null default now(),
    last_detected_at timestamptz not null default now(),
    resolved_clinic_info_key text null,
    sample_language text null,
    constraint knowledge_gaps_question_length check (char_length(patient_question) between 1 and 500),
    constraint knowledge_gaps_normalized_length check (char_length(normalized_question) between 1 and 500)
);

create unique index if not exists knowledge_gaps_open_tenant_question_uidx
    on public.knowledge_gaps (tenant_id, normalized_question)
    where status = 'open';

alter table public.knowledge_gaps enable row level security;

-- Conferir pg_policies antes de aplicar: policies permissivas com nomes
-- desconhecidos combinam por OR e precisam ser removidas explicitamente.
drop policy if exists "Tenant admins can view knowledge gaps" on public.knowledge_gaps;
drop policy if exists "Tenant admins can update knowledge gaps" on public.knowledge_gaps;

create policy "Tenant admins can view knowledge gaps"
on public.knowledge_gaps for select to authenticated
using (exists (
    select 1 from public.members m where m.tenant_id = knowledge_gaps.tenant_id
      and m.user_id = auth.uid() and m.is_active = true and m.role in ('owner', 'admin')
));

create policy "Tenant admins can update knowledge gaps"
on public.knowledge_gaps for update to authenticated
using (exists (
    select 1 from public.members m where m.tenant_id = knowledge_gaps.tenant_id
      and m.user_id = auth.uid() and m.is_active = true and m.role in ('owner', 'admin')
))
with check (exists (
    select 1 from public.members m where m.tenant_id = knowledge_gaps.tenant_id
      and m.user_id = auth.uid() and m.is_active = true and m.role in ('owner', 'admin')
));

create or replace function public.record_knowledge_gap(
    p_tenant_id uuid, p_patient_question text, p_normalized_question text,
    p_sample_language text default null
) returns void language sql security definer set search_path = public as $$
    insert into public.knowledge_gaps (tenant_id, patient_question, normalized_question, sample_language)
    values (p_tenant_id, left(p_patient_question, 500), left(p_normalized_question, 500), p_sample_language)
    on conflict (tenant_id, normalized_question) where status = 'open'
    do update set occurrences = knowledge_gaps.occurrences + 1, last_detected_at = now();
$$;

revoke all on function public.record_knowledge_gap(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_knowledge_gap(uuid, text, text, text) to service_role;
grant select, update on table public.knowledge_gaps to authenticated;
grant all on table public.knowledge_gaps to service_role;

commit;
