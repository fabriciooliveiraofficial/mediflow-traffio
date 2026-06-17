-- =============================================================================
-- TRAFFIO / MEDIFLOW — Widget de Agendamento
-- Antecedência mínima de agendamento, configurável por tenant (minutos).
-- Usada pela edge function public-booking para filtrar horários do dia atual
-- (no fuso do tenant). Ex.: 30 = não permite agendar horário que começa em
-- menos de 30 minutos.
-- =============================================================================
alter table public.tenants
  add column if not exists booking_min_lead_minutes integer not null default 30;
