-- =============================================================================
-- Fix: appointments_status_check estava bloqueando checkin_done/noshow/in_consult
-- Data: 2026-07-01
--
-- Descoberta em produção: o CHECK constraint real só permitia
-- ('scheduled','confirmed','waiting','in_progress','completed','canceled').
-- Isso rejeitava (400) as gravações que a própria UI já tentava fazer:
--   AgendaMestra.tsx  → 'checkin_done', 'noshow'
--   ReceptionDashboard.tsx → 'in_consult'
--   FollowUpTimelineDrawer → 'noshow'/'no_show'
-- Os botões de Check-in e Falta nunca funcionaram por causa disso — é a causa
-- raiz direta de "a clínica não sabe quando o paciente compareceu".
-- Ampliação pura (nenhum valor antigo é removido).
-- =============================================================================

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status = ANY (ARRAY[
    'scheduled','confirmed','waiting','in_progress','in_consult',
    'completed','canceled','cancelled','checkin_done','noshow','no_show'
  ]));

SELECT 'appointments_status_check ampliado.' AS resultado;
