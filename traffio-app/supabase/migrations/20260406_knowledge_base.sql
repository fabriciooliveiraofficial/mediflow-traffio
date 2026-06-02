-- Super Agent v3.0 Stage 1: Knowledge Base Foundation
-- Enable pgvector for RAG capabilities
create extension if not exists vector;

-- Create Knowledge Base Table
create table if not exists public.knowledge_base (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid references public.tenants on delete cascade not null,
  category text not null default 'general', -- 'convenios', 'procedimentos', 'politicas', etc.
  title text not null,
  content text not null,
  embedding vector(1536), -- Optimized for OpenAI text-embedding-3-small (1536 dims)
  is_active boolean default true,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.knowledge_base enable row level security;

-- Policies: Members can read, Managers can do everything
create policy "Members of tenant can view knowledge base" on public.knowledge_base
  for select
  using (
    exists (
      select 1 from public.members
      where members.tenant_id = knowledge_base.tenant_id
      and members.user_id = auth.uid()
    )
  );

create policy "Managers of tenant can manage knowledge base" on public.knowledge_base
  for all
  using (
    exists (
      select 1 from public.members
      where members.tenant_id = knowledge_base.tenant_id
      and members.user_id = auth.uid()
      and members.role = 'manager'
    )
  );

-- HNSW Index for efficient vector searches
create index on public.knowledge_base using hnsw (embedding vector_cosine_ops);

-- Trigger for updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_knowledge_base_updated_at
  before update on public.knowledge_base
  for each row
  execute function public.handle_updated_at();
