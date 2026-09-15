-- =============================================================================
-- Ciclo de vida do paciente: pending -> active
-- Data: 2026-09-16
--
-- Regra de negócio: alguém só é um "Paciente" de verdade quando tem uma
-- consulta que passou por confirmação real (confirmação manual da recepção,
-- confirmação automática via WhatsApp, ou comparecimento físico). Antes
-- disso é só uma tentativa de agendamento e a tela Pacientes (CrmLeads.tsx)
-- deve mostrar isso como "pending", não como "Ativo".
--
-- Promoção é monotônica: uma vez 'active', nunca volta a 'pending'
-- automaticamente (uma falta ou cancelamento posterior não desfaz o fato de
-- que essa pessoa já foi paciente de verdade).
-- =============================================================================

-- 1. Coluna nova, aditiva.
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'active'));

-- 2. Backfill: quem já tem histórico real vira 'active' retroativamente,
--    para não regredir todo mundo que já é paciente hoje.
UPDATE public.patients p
SET status = 'active'
WHERE status = 'pending'
  AND (
    EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.patient_id = p.id
        AND (
          a.status IN ('confirmed','waiting','in_consult','in_progress','checkin_done','completed')
          OR a.confirmation_status = 'confirmed'
        )
    )
    OR EXISTS (SELECT 1 FROM public.medical_records m WHERE m.patient_id = p.id)
    OR EXISTS (SELECT 1 FROM public.prescriptions pr WHERE pr.patient_id = p.id)
  );

-- 3. Trigger de promoção: reage a qualquer appointment que indique
--    confirmação ou comparecimento, e promove o paciente correspondente.
--    SECURITY DEFINER + EXCEPTION WHEN OTHERS seguem o mesmo padrão de
--    resiliência de crm_sync_stage() (20260915120000_crm_phase1_status_sync.sql):
--    nunca bloqueia a escrita do agendamento por causa deste trigger.
CREATE OR REPLACE FUNCTION public.patients_sync_lifecycle_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.patient_id IS NOT NULL AND (
       NEW.status IN ('confirmed','waiting','in_consult','in_progress','checkin_done','completed')
       OR NEW.confirmation_status = 'confirmed'
     ) THEN
    UPDATE public.patients
    SET status = 'active'
    WHERE id = NEW.patient_id AND status <> 'active';
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'patients_sync_lifecycle_status failed for appointment %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_patients_lifecycle_sync ON public.appointments;
CREATE TRIGGER tr_patients_lifecycle_sync
  AFTER INSERT OR UPDATE OF status, confirmation_status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.patients_sync_lifecycle_status();
