-- Enable UUID extension if not enabled
create extension if not exists "uuid-ossp";

-- 1. Conversation Sessions
-- Persists the current state of the conversation for the State Machine
create table if not exists conversation_sessions (
    id uuid primary key default uuid_generate_v4(),
    tenant_id uuid references tenants(id) not null,
    patient_phone text not null,
    current_state text not null default 'INIT',
    context jsonb default '{}'::jsonb,
    human_handoff boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique(tenant_id, patient_phone) -- Ensures one active session record per patient
);

create index if not exists idx_sessions_tenant_phone on conversation_sessions(tenant_id, patient_phone);

-- 2. Conversation Messages
-- Stores the history with AI-specific metadata
create table if not exists conversation_messages (
    id uuid primary key default uuid_generate_v4(),
    session_id uuid references conversation_sessions(id) on delete cascade not null,
    role text not null check (role in ('user', 'assistant', 'system')),
    content text,
    ai_raw_response jsonb, -- Store the raw JSON from AI
    parsed_intent text,
    created_at timestamptz default now()
);

create index if not exists idx_messages_session on conversation_messages(session_id);

-- 3. AI Audit Logs
-- Observability layer for SaaS metrics
create table if not exists ai_audit_logs (
    id uuid primary key default uuid_generate_v4(),
    tenant_id uuid references tenants(id) not null,
    session_id uuid references conversation_sessions(id),
    input_tokens int,
    output_tokens int,
    response_time_ms int,
    validation_passed boolean,
    error_flag boolean default false,
    created_at timestamptz default now()
);

create index if not exists idx_audit_tenant_created on ai_audit_logs(tenant_id, created_at);

-- Trigger to update updated_at
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger update_conversation_sessions_updated_at
before update on conversation_sessions
for each row
execute function update_updated_at_column();
