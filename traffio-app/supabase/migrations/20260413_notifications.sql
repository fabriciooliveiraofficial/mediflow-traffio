-- Create push subscriptions table
CREATE TABLE IF NOT EXISTS public.user_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, endpoint)
);

-- Enable RLS
ALTER TABLE public.user_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage their own subscriptions"
    ON public.user_push_subscriptions
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Add notification settings to profiles if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'profiles' AND column_name = 'notification_settings'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN notification_settings JSONB DEFAULT '{
            "whatsapp_sound": true,
            "whatsapp_toast": true,
            "whatsapp_push": true
        }'::jsonb;
    END IF;
END $$;

-- Trigger Function to notify staff
CREATE OR REPLACE FUNCTION public.fn_notify_whatsapp_message()
RETURNS TRIGGER AS $$
DECLARE
    v_tenant_id UUID;
    v_sender_name TEXT;
BEGIN
    -- Only trigger for incoming messages (patient -> staff)
    IF NEW.role = 'user' THEN
        -- Get tenant_id from session
        SELECT tenant_id INTO v_tenant_id 
        FROM public.conversation_sessions 
        WHERE id = NEW.session_id;

        -- We call the edge function notify-staff
        -- The URL should be the project's functions URL
        -- Using 'anon' key for background authentication as JWT is not available in background triggers.
        PERFORM net.http_post(
            url := 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/notify-staff',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5eWh4bXVneGNmcWh2b2V2dXdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NTk0MDIsImV4cCI6MjA4NjMzNTQwMn0.4P_7_DpEFS51QcsyWk0s0DLUqPZEXA7NJf4sAy6jqrg',
                'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5eWh4bXVneGNmcWh2b2V2dXdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NTk0MDIsImV4cCI6MjA4NjMzNTQwMn0.4P_7_DpEFS51QcsyWk0s0DLUqPZEXA7NJf4sAy6jqrg'
            ),
            body := jsonb_build_object(
                'type', 'new_message',
                'tenant_id', v_tenant_id,
                'record', row_to_json(NEW)
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create Trigger
DROP TRIGGER IF EXISTS tr_notify_whatsapp_message ON public.conversation_messages;
CREATE TRIGGER tr_notify_whatsapp_message
    AFTER INSERT ON public.conversation_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_notify_whatsapp_message();
