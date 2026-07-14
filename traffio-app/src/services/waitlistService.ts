import { supabase } from '../lib/supabase';

export interface WaitlistEntry {
    id: string;
    tenant_id: string;
    patient_id: string;
    doctor_id: string | null;
    type_id: string | null;
    preferred_days: number[] | null;
    preferred_time_start: string | null;
    preferred_time_end: string | null;
    status: 'waiting' | 'notified' | 'booked' | 'expired';
    created_at: string;
    updated_at: string;
    patients?: { full_name: string | null; phone: string | null } | null;
    doctors?: { full_name: string | null; color: string | null } | null;
}

const SELECT = '*, patients:patient_id(full_name, phone), doctors:doctor_id(full_name, color)';

export const waitlistService = {
    async listByTenant(tenantId: string): Promise<WaitlistEntry[]> {
        const { data, error } = await supabase
            .from('waitlist')
            .select(SELECT)
            .eq('tenant_id', tenantId)
            .in('status', ['waiting', 'notified'])
            .order('created_at', { ascending: true });
        if (error) throw error;
        return (data || []) as WaitlistEntry[];
    },

    async listByPatient(tenantId: string, patientId: string): Promise<WaitlistEntry[]> {
        const { data, error } = await supabase
            .from('waitlist')
            .select(SELECT)
            .eq('tenant_id', tenantId)
            .eq('patient_id', patientId)
            .in('status', ['waiting', 'notified'])
            .order('created_at', { ascending: true });
        if (error) throw error;
        return (data || []) as WaitlistEntry[];
    },

    async add(entry: {
        tenant_id: string;
        patient_id: string;
        doctor_id: string;
        preferred_days?: number[] | null;
        preferred_time_start?: string | null;
        preferred_time_end?: string | null;
    }): Promise<WaitlistEntry> {
        // Evita entradas duplicadas do mesmo paciente na fila do mesmo médico
        const { data: existing, error: checkError } = await supabase
            .from('waitlist')
            .select('id')
            .eq('tenant_id', entry.tenant_id)
            .eq('patient_id', entry.patient_id)
            .eq('doctor_id', entry.doctor_id)
            .eq('status', 'waiting')
            .limit(1);
        if (checkError) throw checkError;
        if (existing && existing.length > 0) {
            throw new Error('DUPLICATE_WAITLIST_ENTRY');
        }

        const { data, error } = await supabase
            .from('waitlist')
            .insert({
                tenant_id: entry.tenant_id,
                patient_id: entry.patient_id,
                doctor_id: entry.doctor_id,
                preferred_days: entry.preferred_days?.length ? entry.preferred_days : null,
                preferred_time_start: entry.preferred_time_start || null,
                preferred_time_end: entry.preferred_time_end || null,
                status: 'waiting'
            })
            .select(SELECT)
            .single();
        if (error) throw error;
        return data as WaitlistEntry;
    },

    async remove(id: string): Promise<void> {
        const { error } = await supabase.from('waitlist').delete().eq('id', id);
        if (error) throw error;
    },

    async updateStatus(id: string, status: WaitlistEntry['status']): Promise<void> {
        const { error } = await supabase
            .from('waitlist')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
    }
};
