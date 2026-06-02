-- Create table for buffering WhatsApp messages (10-20s window)
CREATE TABLE IF NOT EXISTS public.bot_buffer (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone TEXT NOT NULL,
    message TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    processed BOOLEAN DEFAULT FALSE
);

-- Index for fast lookup by phone/instance
CREATE INDEX IF NOT EXISTS idx_bot_buffer_phone ON public.bot_buffer(phone, instance_id);
CREATE INDEX IF NOT EXISTS idx_bot_buffer_processed ON public.bot_buffer(processed);

-- RLS (Service Role only)
ALTER TABLE public.bot_buffer ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service Role Full Access" ON public.bot_buffer
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
