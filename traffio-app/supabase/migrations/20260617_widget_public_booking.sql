-- =============================================================================
-- TRAFFIO / MEDIFLOW — Widget de Agendamento Embarcável (Fase 1: API Pública)
-- -----------------------------------------------------------------------------
-- Cria a infraestrutura para o widget público de agendamento embarcado nas
-- landing pages dos tenants:
--   1. tenant_public_keys  -> publishable key + config (tema/FAB/pixel/domínios)
--   2. tenants.locale/country/timezone -> i18n por tenant (sem toggle no front)
--
-- A edge function `public-booking` é o ÚNICO portão público; usa service_role
-- e faz o escopo por tenant + validação de origem. Por isso NÃO abrimos RLS
-- anon nas tabelas de negócio (menor superfície de ataque).
-- =============================================================================

-- pgcrypto p/ gen_random_bytes (Supabase já habilita no schema extensions)
create extension if not exists pgcrypto with schema extensions;

-- ── 1. Localização por tenant (requisito i18n) ───────────────────────────────
-- Idioma decidido pela clínica, nunca pelo visitante.
alter table public.tenants
  add column if not exists locale   text not null default 'pt-BR',          -- pt-BR | en-US | en-NZ
  add column if not exists country  text not null default 'BR',             -- BR | US | NZ (define campos do form)
  add column if not exists timezone text not null default 'America/Sao_Paulo';

-- ── 2. Chaves públicas + configuração do widget por tenant ───────────────────
create table if not exists public.tenant_public_keys (
  id                       uuid primary key default extensions.gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,

  -- credencial (a key É o identificador do tenant, estilo Stripe pk_live_)
  public_key               text not null unique
                              default ('pk_live_' || encode(extensions.gen_random_bytes(24), 'hex')),
  allowed_domains          text[] not null default '{}',   -- domínios onde a key funciona
  is_active                boolean not null default true,

  -- tema / paleta (1 cor primária -> paleta derivada no widget, Seção 9.6)
  primary_color            text default '#0E7C7B',

  -- FAB (conversão secundária -> botão flutuante inferior-direito)
  fab_label                text default 'Agendar',
  fab_style                text default 'soft'  check (fab_style in ('solid','soft','outline')),
  fab_position             text default 'bottom-right'
                              check (fab_position in ('bottom-right','bottom-left')),
  fab_delay_ms             integer not null default 0,

  -- rastreamento de marketing (disparado no documento PAI — Seção 2.5)
  meta_pixel_id            text,
  google_ads_id            text,
  google_conversion_label  text,
  success_virtual_path     text default '/agendamento-confirmado',

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_tenant_public_keys_tenant on public.tenant_public_keys(tenant_id);
create unique index if not exists idx_tenant_public_keys_key on public.tenant_public_keys(public_key);

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_tpk_updated_at on public.tenant_public_keys;
create trigger trg_tpk_updated_at
  before update on public.tenant_public_keys
  for each row execute function public.set_updated_at();

-- ── 3. Segurança: RLS ligada, sem política anon ──────────────────────────────
-- A tabela de keys nunca é exposta ao browser. Só service_role (edge function)
-- e o painel super-admin (via app autenticado) acessam.
alter table public.tenant_public_keys enable row level security;

-- (sem policy anon — service_role faz bypass de RLS por padrão)

-- ── 4. Helper: provisionar key ao criar tenant (uso opcional pelo painel) ─────
create or replace function public.provision_tenant_public_key(p_tenant_id uuid)
returns public.tenant_public_keys
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.tenant_public_keys;
begin
  insert into public.tenant_public_keys (tenant_id)
  values (p_tenant_id)
  returning * into v_row;
  return v_row;
end; $$;

comment on table public.tenant_public_keys is
  'Publishable keys e configuração do widget de agendamento embarcável, por tenant.';
