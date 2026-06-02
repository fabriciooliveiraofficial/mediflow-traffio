-- Traffio Medical: Seed Data for Local Simulation

-- 1. SIMULATED AUTH USERS (Needed for Foreign Key constraints in public.profiles)
-- We insert into auth.users schema which is pre-created by Supabase CLI
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES 
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'nomade@traffio.med', '$2a$10$fS0Y6IqE5W7yE5Z6Gk5g3e', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- 2. INITIAL TENANTS (Clinics)
INSERT INTO public.tenants (id, name, slug, address)
VALUES 
  ('7c9e66ab-0123-4456-b789-0123456789ab', 'Unidade Vila Mariana', 'vila-mariana', 'Rua Domingos de Morais, 123 - São Paulo'),
  ('8d0f77bc-1234-5567-c890-1234567890bc', 'Unidade Itaim Bibi', 'itaim-bibi', 'Rua Joaquim Floriano, 456 - São Paulo')
ON CONFLICT (slug) DO NOTHING;

-- 3. PROFILES
INSERT INTO public.profiles (id, email, full_name, role)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'nomade@traffio.med', 'Dr. Nômade', 'doctor')
ON CONFLICT (id) DO NOTHING;

-- 4. MEMBERSHIP
INSERT INTO public.members (tenant_id, user_id, role)
VALUES 
  ('7c9e66ab-0123-4456-b789-0123456789ab', '00000000-0000-0000-0000-000000000001', 'doctor'),
  ('8d0f77bc-1234-5567-c890-1234567890bc', '00000000-0000-0000-0000-000000000001', 'doctor')
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- 5. INITIAL PATIENTS
INSERT INTO public.patients (tenant_id, full_name, email, phone)
VALUES 
  ('7c9e66ab-0123-4456-b789-0123456789ab', 'Mariana Costa', 'mariana@email.com', '(11) 98888-7777'),
  ('7c9e66ab-0123-4456-b789-0123456789ab', 'Ricardo Albeniz', 'ricardo@email.com', '(11) 97777-6666')
ON CONFLICT DO NOTHING;
