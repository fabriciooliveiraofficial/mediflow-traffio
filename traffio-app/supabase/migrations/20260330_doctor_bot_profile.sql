-- Migration: add bot_profile to doctors
-- Stores per-professional agent skills: pitch, selling points, objection scripts, FAQ, etc.

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS bot_profile JSONB DEFAULT NULL;

COMMENT ON COLUMN doctors.bot_profile IS
  'Per-professional ClinicalAgent skills. Fields: pitch, selling_points[], objection_scripts{}, faq[{q,a}], pre_appointment_tip, consultation_opening';
