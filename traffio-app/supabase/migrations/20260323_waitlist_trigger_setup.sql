-- ##########################################################
-- TRIGGER: NOTIFY WAITLIST ON CANCELLATION
-- ##########################################################

-- Step 1: Create the function that identifies cancellations
CREATE OR REPLACE FUNCTION public.on_appointment_canceled_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if status changed to 'canceled'
    IF (OLD.status IS DISTINCT FROM 'canceled' AND NEW.status = 'canceled') THEN
        -- The recommended way to trigger the Edge Function is via Supabase "Database Webhooks"
        -- However, if you prefer SQL-level control, you can use the code below (requires pg_net extension).
        -- Most users should just configure a Webhook in the Dashboard pointing to 'process-waitlist'.
        
        -- Logging the event for the webhook to pick up (if using standard Supabase Webhooks)
        RAISE NOTICE 'Appointment % canceled for doctor %. Triggering waitlist.', NEW.id, NEW.doctor_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Create the trigger
DROP TRIGGER IF EXISTS tr_on_appointment_canceled ON public.appointments;
CREATE TRIGGER tr_on_appointment_canceled
AFTER UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.on_appointment_canceled_trigger();

/*
INSTRUCTIONS TO COMPLETE SETUP:
1. Go to Supabase Dashboard > Database > Webhooks.
2. Create a new Webhook:
   - Name: process-waitlist
   - Table: appointments
   - Events: Update
   - Filter (Optional): status = canceled
   - Method: POST
   - URL: [Your Project URL]/functions/v1/process-waitlist
   - Headers: Authorization: Bearer [SERVICE_ROLE_KEY]
   - Body: 
     {
       "doctor_id": "record.doctor_id",
       "date": "record.date",
       "start_time": "record.start_time",
       "tenant_id": "record.tenant_id"
     }
*/
