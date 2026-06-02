-- Add last_visit_at if not exists
ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Function to update last_visit_at on new appointment completion
CREATE OR REPLACE FUNCTION update_patient_last_visit()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.status = 'completed') THEN
        UPDATE public.patients
        SET last_visit_at = NEW.start_time
        WHERE id = NEW.patient_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger
DROP TRIGGER IF EXISTS tr_update_last_visit ON public.appointments;
CREATE TRIGGER tr_update_last_visit
AFTER UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION update_patient_last_visit();
