-- Traffio Medical: Initial Schema for Multi-Tenancy and Clinical Management

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";

-- 2. TABLES
-- Profiles: Extends Supabase Auth users
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  avatar_url text,
  role text check (role in ('doctor', 'staff', 'admin')) default 'staff',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Tenants: Multi-locality clinics
create table public.tenants (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  slug text unique not null,
  address text,
  settings jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Members: Join table for RBAC (Profiles to Tenants)
create table public.members (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid references public.tenants on delete cascade not null,
  user_id uuid references public.profiles on delete cascade not null,
  role text check (role in ('doctor', 'attendant', 'manager')) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (tenant_id, user_id)
);

-- Patients: Patient registry per tenant
create table public.patients (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid references public.tenants on delete cascade not null,
  full_name text not null,
  email text,
  phone text,
  birth_date date,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Appointments: Scheduling system
create table public.appointments (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid references public.tenants on delete cascade not null,
  patient_id uuid references public.patients on delete cascade not null,
  doctor_id uuid references public.profiles on delete cascade not null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  status text check (status in ('scheduled', 'confirmed', 'waiting', 'in_consult', 'completed', 'cancelled')) default 'scheduled',
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Medical Records: Clinical documentation (SOAP)
create table public.medical_records (
  id uuid default uuid_generate_v4() primary key,
  patient_id uuid references public.patients on delete cascade not null,
  doctor_id uuid references public.profiles on delete cascade not null,
  tenant_id uuid references public.tenants on delete cascade not null,
  content text, -- Raw content or structured data
  soap_notes jsonb default '{}'::jsonb, -- {s: "", o: "", a: "", p: ""}
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. RLS (Row Level Security)
alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.members enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.medical_records enable row level security;

-- 4. BASIC POLICIES (Placeholders for complex logic)
-- Profiles: Users can see their own profile
create policy "Users can see own profile" on public.profiles
  for select using (auth.uid() = id);

-- Tenants: Members can see their tenants
create policy "Members can see their tenants" on public.tenants
  for select using (
    exists (
      select 1 from public.members
      where members.tenant_id = tenants.id
      and members.user_id = auth.uid()
    )
  );

-- Patients: Members of the tenant can see patients
create policy "Members can see tenant patients" on public.patients
  for select using (
    exists (
      select 1 from public.members
      where members.tenant_id = patients.tenant_id
      and members.user_id = auth.uid()
    )
  );
