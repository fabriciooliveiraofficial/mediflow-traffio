-- Add Rolling Memory columns
ALTER TABLE conversation_sessions 
ADD COLUMN recent_messages JSONB DEFAULT '[]'::jsonb,
ADD COLUMN conversation_summary JSONB DEFAULT '{}'::jsonb;

-- Update RLS to allow access to new columns (implicitly covered by existing policies on the table, but good to verify)
-- Existing polices cover 'select' and 'update' on the whole table.
