-- =============================================================================
-- MIGRAÇÃO 20260724100000: Adiciona confirmation_status na tabela appointments
-- Resolve a falha fatal (column appointments.confirmation_status does not exist)
-- que interrompe o fluxo determinístico em structuredFlow.ts e process-outbound.
-- =============================================================================

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'appointments' 
          AND column_name = 'confirmation_status'
    ) THEN
        ALTER TABLE public.appointments 
            ADD COLUMN confirmation_status text NOT NULL DEFAULT 'pending';

        -- Constraint opcional para restringir os valores possíveis se desejado
        ALTER TABLE public.appointments
            ADD CONSTRAINT appointments_confirmation_status_check
            CHECK (confirmation_status IN ('pending', 'confirmed', 'rescheduled', 'declined'));

        -- Índice para otimizar buscas por status de confirmação
        CREATE INDEX idx_appointments_confirmation_status 
            ON public.appointments (tenant_id, confirmation_status);
    END IF;
END $$;
