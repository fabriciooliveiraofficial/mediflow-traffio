begin;

-- Onda 5.1 (docs/TAREFA_GEMINI_REENGENHARIA_AGENTE_IA.md) — observabilidade por
-- turno do agente. Gravação best-effort em runAutonomousAgent/tryStructuredFlow
-- (try/catch isolado, nunca afeta o turno) — ver copilot.ts/structuredFlow.ts.

create table if not exists public.agent_turn_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    session_id uuid null,
    phone text null,
    route text not null check (route in ('structured_flow', 'agent', 'human', 'ignored')),
    turn_language text null,
    tools_called text[] null,
    violations text[] null,
    handoff_reason text null,
    handoff_kind text null check (handoff_kind in ('soft', 'hard')),
    bubbles integer null,
    latency_ms integer null,
    tokens_in integer null,
    tokens_out integer null,
    created_at timestamptz not null default now()
);

create index if not exists agent_turn_events_tenant_created_idx
    on public.agent_turn_events (tenant_id, created_at desc);

alter table public.agent_turn_events enable row level security;

-- Conferir pg_policies antes de aplicar: policies permissivas com nomes
-- desconhecidos combinam por OR e precisam ser removidas explicitamente.
drop policy if exists "Tenant admins can view agent turn events" on public.agent_turn_events;

create policy "Tenant admins can view agent turn events"
on public.agent_turn_events for select to authenticated
using (exists (
    select 1 from public.members m where m.tenant_id = agent_turn_events.tenant_id
      and m.user_id = auth.uid() and m.is_active = true and m.role in ('owner', 'admin')
));

grant select on table public.agent_turn_events to authenticated;
grant all on table public.agent_turn_events to service_role;

comment on table public.agent_turn_events is
    'Trace de observabilidade por turno do agente (Onda 5). Retenção sugerida: purge > 90 dias via cron — não implementado nesta migration.';

commit;
