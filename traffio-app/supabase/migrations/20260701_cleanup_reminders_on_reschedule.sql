-- ============================================================
-- Cleanup reminders on appointment reschedule or cancellation
-- Substitui: tr_delete_pending_reminders_on_reschedule
-- ============================================================

DROP TRIGGER IF EXISTS tr_delete_pending_reminders_on_reschedule ON public.appointments;
DROP FUNCTION IF EXISTS public.delete_pending_reminders_on_reschedule();
DROP TRIGGER IF EXISTS tr_cleanup_reminders_on_appointment_change ON public.appointments;
DROP FUNCTION IF EXISTS public.cleanup_reminders_on_appointment_change();

CREATE OR REPLACE FUNCTION public.cleanup_reminders_on_appointment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- CASO 1: horário mudou (drag-drop / in-place reschedule)
  -- Remove pending + sent + failed para liberar o índice único —
  -- schedule-reminders re-enfileira apenas os offsets ainda futuros.
  IF (NEW.date IS DISTINCT FROM OLD.date
      OR NEW.start_time IS DISTINCT FROM OLD.start_time) THEN
    DELETE FROM public.outbound_message_queue
    WHERE reference_id   = NEW.id
      AND reference_type = 'appointment'
      AND template_key   LIKE 'appointment_reminder%'
      AND status IN ('pending', 'sent', 'failed');
  END IF;

  -- CASO 2: cancelamento / no-show → cancela lembretes ainda pendentes
  IF (NEW.status IN ('canceled', 'cancelled', 'no_show')
      AND OLD.status NOT IN ('canceled', 'cancelled', 'no_show')) THEN
    DELETE FROM public.outbound_message_queue
    WHERE reference_id   = NEW.id
      AND reference_type = 'appointment'
      AND template_key   LIKE 'appointment_reminder%'
      AND status         = 'pending';
  END IF;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[cleanup_reminders_on_appointment_change] Appt %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_cleanup_reminders_on_appointment_change
  AFTER UPDATE OF date, start_time, status ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_reminders_on_appointment_change();

-- Remediação one-time: destravar fila do agendamento movido
DELETE FROM public.outbound_message_queue
WHERE patient_phone   = '+554198933579'
  AND reference_type  = 'appointment'
  AND template_key    LIKE 'appointment_reminder%';

SELECT 'Cleanup trigger aplicado + fila destravada.' AS resultado;
