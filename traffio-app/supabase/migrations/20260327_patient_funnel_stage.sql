-- FASE 6 — Observabilidade de Automações
-- Objetivo: Criar a infraestrutura de dados para o Kanban e Visibilidade operacional.

-- 1. Create the Patient Funnel Stage table
-- This table tracks the current state of a lead/patient in the sales/automation funnel.
CREATE TABLE IF NOT EXISTS public.patient_funnel_stage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_phone TEXT NOT NULL,
    patient_name TEXT, -- Denormalized for performance (don't need JOIN for list)
    current_stage TEXT NOT NULL DEFAULT 'novo_lead', -- novo_lead, em_follow_up, qualificado, agendado, perdido
    stage_updated_at TIMESTAMPTZ DEFAULT now(),
    next_action_type TEXT, -- e.g., follow_up_step2, reminder_48h
    next_action_at TIMESTAMPTZ, -- When the next message is scheduled
    last_interaction_at TIMESTAMPTZ DEFAULT now(),
    lead_source TEXT DEFAULT 'whatsapp', -- whatsapp, instagram, indicacao
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraint: One record per patient per tenant
    CONSTRAINT unique_tenant_patient_funnel UNIQUE (tenant_id, patient_phone)
);

-- 2. Performance Indexes for the Kanban board
CREATE INDEX IF NOT EXISTS idx_funnel_stage_lookup 
ON public.patient_funnel_stage (tenant_id, current_stage);

CREATE INDEX IF NOT EXISTS idx_funnel_next_action 
ON public.patient_funnel_stage (tenant_id, next_action_at);

-- 3. RLS Security for patient_funnel_stage
ALTER TABLE public.patient_funnel_stage ENABLE ROW LEVEL SECURITY;

-- Tenants can see their own funnel
CREATE POLICY "Tenants can select their own funnel" 
ON public.patient_funnel_stage FOR SELECT 
TO authenticated 
USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Tenants can update their own funnel (Drag-and-drop support)
CREATE POLICY "Tenants can update their own funnel" 
ON public.patient_funnel_stage FOR UPDATE 
TO authenticated 
USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Only service_role (Edge Functions) can INSERT/DELETE
CREATE POLICY "Service role only insert/delete funnel" 
ON public.patient_funnel_stage FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- 4. Harden outbound_message_queue RLS
-- Allow authenticated tenants to see and manage their own queue
-- This allows the frontend to cancel messages and edit templates without Edge Functions.

-- Add is_edited column if it doesn't exist
ALTER TABLE public.outbound_message_queue 
ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false;

-- Enable SELECT for tenants
CREATE POLICY "Tenants can select their own queue" 
ON public.outbound_message_queue FOR SELECT 
TO authenticated 
USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Enable UPDATE for tenants (Limited to pending messages)
CREATE POLICY "Tenants can update their own pending queue" 
ON public.outbound_message_queue FOR UPDATE 
TO authenticated 
USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid 
    AND status = 'pending'
)
WITH CHECK (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid 
    AND status = 'pending'
);

-- 5. Helper Function to update next_action automatically
-- This is called via trigger or manual update to keep the funnel in sync
CREATE OR REPLACE FUNCTION public.update_funnel_next_action()
RETURNS trigger AS $$
BEGIN
    UPDATE public.patient_funnel_stage
    SET 
        next_action_type = NEW.message_type,
        next_action_at = NEW.scheduled_at
    WHERE tenant_id = NEW.tenant_id 
    AND patient_phone = NEW.patient_phone
    AND (next_action_at IS NULL OR NEW.scheduled_at < next_action_at)
    AND NEW.status = 'pending';
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_sync_funnel_next_action
AFTER INSERT OR UPDATE OF scheduled_at, status ON public.outbound_message_queue
FOR EACH ROW
EXECUTE FUNCTION public.update_funnel_next_action();
