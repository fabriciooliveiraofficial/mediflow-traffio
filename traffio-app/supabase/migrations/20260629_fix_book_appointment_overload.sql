-- ============================================================
-- Fix: ambiguidade de overload em book_appointment
-- ------------------------------------------------------------
-- A migration 20260626120000_book_appointment_hardening.sql criou a versão
-- consolidada de 10 params (com p_end_time/p_notes DEFAULT NULL) usando
-- CREATE OR REPLACE — que NÃO remove a versão antiga de 8 params (assinatura
-- diferente, vinda de 05_anti_double_booking_and_omnichannel.sql).
--
-- As duas passaram a coexistir no banco. Chamadas de 8 args (UI
-- SidebarBookingView, e as edge functions do agente IA) casam com AMBAS,
-- gerando:
--   "Could not choose the best candidate function between
--    public.book_appointment(... 8 args ...),
--    public.book_appointment(... 10 args ...)"
--
-- Remove a versão antiga de 8 params. A de 10 params atende todos os callers
-- via defaults: UI (8 args), schedulingService (9), smartSchedulingService
-- (10), edge functions (8). Todos passam p_booked_by explicitamente, então
-- não há mudança de comportamento.
-- ============================================================

DROP FUNCTION IF EXISTS public.book_appointment(
    uuid, uuid, uuid, uuid, uuid, date, time, text
);
