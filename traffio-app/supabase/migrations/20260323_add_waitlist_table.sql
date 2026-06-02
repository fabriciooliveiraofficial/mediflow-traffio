-- ##########################################################
-- WAITLIST SYSTEM
-- ##########################################################

CREATE TABLE IF NOT EXISTS waitlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    type_id UUID REFERENCES appointment_types(id) ON DELETE SET NULL,
    preferred_days INTEGER[], -- Array de day_of_week (0-6)
    preferred_time_start TIME,
    preferred_time_end TIME,
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'booked', 'expired')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Policity: Tenants can see their waitlist
CREATE POLICY "Tenants can manage their waitlist" ON waitlist
    FOR ALL USING (tenant_id IN (SELECT tenant_id FROM members WHERE user_id = auth.uid()));

-- Index for matching
CREATE INDEX IF NOT EXISTS idx_waitlist_match ON waitlist (doctor_id, status) WHERE status = 'waiting';

COMMENT ON TABLE waitlist IS 'Lista de espera para pacientes que desejam vagas por desistência.';
