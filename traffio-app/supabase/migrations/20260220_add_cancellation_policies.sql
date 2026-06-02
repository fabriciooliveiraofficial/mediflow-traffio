-- Migration to add cancellation policies and penalty tracking

-- Add cancellation policy to doctors
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS cancellation_policy JSONB DEFAULT '{
  "enabled": false,
  "free_window_hours": 24,
  "late_penalty_percent": 0,
  "no_show_penalty_percent": 100
}'::jsonb;

-- Add penalty tracking to appointments
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS penalty_applied BOOLEAN DEFAULT false;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS penalty_amount_cents INTEGER DEFAULT 0;
