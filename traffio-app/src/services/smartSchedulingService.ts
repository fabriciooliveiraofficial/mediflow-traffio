import { supabase } from '../lib/supabase';

export interface SmartSlot {
    slot_time: string;
    slot_end: string;
    block_type: 'prime' | 'regular';
    allowed_patient_type: 'private' | 'insurance' | 'any';
    location_id: string | null;
    location_name: string | null;
    is_auto_released: boolean;
}

export interface BookAppointmentPayload {
    tenant_id: string;
    doctor_id: string;
    patient_id: string;
    location_id: string;
    type_id?: string;
    date: string;
    start_time: string;
    end_time?: string;
    patient_type?: 'private' | 'insurance';
    insurance_plan_id?: string;
    slot_type?: 'prime' | 'regular' | 'auto_released';
    notes?: string;
}

export const smartSchedulingService = {
    async getAvailableSlots(
        doctorId: string,
        date: string,
        _tenantId: string,
        durationMinutes: number = 30,
        locationId?: string
    ): Promise<SmartSlot[]> {
        const { data, error } = await supabase.rpc('find_next_available_dates', {
            p_doctor_id: doctorId,
            p_from_date: date,
            p_limit: 1,
            p_duration_minutes: durationMinutes,
            p_location_id: locationId ?? null
        });

        if (error) throw error;
        const dayData = (data || []).find((d: any) => d.date === date);
        if (!dayData) return [];

        return (dayData.slots || [])
            .filter((slot: any) => slot.available)
            .map((slot: any) => {
                const [h, m] = slot.time.split(':').map(Number);
                const total = h * 60 + m + durationMinutes;
                const endH = Math.floor(total / 60);
                const endM = total % 60;
                const slot_end = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

                return {
                    slot_time: slot.time,
                    slot_end,
                    block_type: slot.block_type || 'regular',
                    allowed_patient_type: 'any',
                    location_id: dayData.location_id,
                    location_name: dayData.location_name,
                    is_auto_released: false
                } as SmartSlot;
            });
    },

    async getActiveDoctors(tenantId: string) {
        const { data, error } = await supabase
            .from('doctors')
            .select('id, full_name, specialty, color, auto_release_hours')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .order('full_name');

        if (error) throw error;
        return data || [];
    },

    async getAppointmentTypes(tenantId: string) {
        const { data, error } = await supabase
            .from('appointment_types')
            .select('id, name, duration_minutes, price_cents, color_hex, preparation_instructions')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .order('name');

        if (error) throw error;
        return data || [];
    },

    async searchPatients(tenantId: string, query: string) {
        const { data, error } = await supabase
            .from('patients')
            .select('id, full_name, phone, email, insurance_provider')
            .eq('tenant_id', tenantId)
            .ilike('full_name', `%${query}%`)
            .limit(10);

        if (error) throw error;
        return data || [];
    },

    async bookAppointment(payload: BookAppointmentPayload) {
        const { data, error } = await supabase.rpc('book_appointment', {
            p_tenant_id: payload.tenant_id,
            p_patient_id: payload.patient_id,
            p_doctor_id: payload.doctor_id,
            p_location_id: payload.location_id,
            p_type_id: payload.type_id || null,
            p_date: payload.date,
            p_start_time: payload.start_time,
            p_end_time: payload.end_time || null,
            p_notes: payload.notes || null,
            p_booked_by: 'system' // or web_dashboard
        });

        if (error) throw error;

        // The RPC returns { success, appointment_id, error, message }
        if (!data || !data.success) {
            throw new Error(data?.message || 'Failed to book appointment due to conflict');
        }

        // Optional: Update the extra payload fields on the newly created appointment since RPC 
        // doesn't support them natively yet (patient_type, insurance_plan_id, slot_type)
        if (payload.patient_type || payload.insurance_plan_id || payload.slot_type) {
            await supabase.from('appointments').update({
                patient_type: payload.patient_type,
                insurance_plan_id: payload.insurance_plan_id || null,
                slot_type: payload.slot_type
            }).eq('id', data.appointment_id);
        }

        // Fetch the created appointment to return the same shape as before
        const { data: appointment, error: fetchError } = await supabase
            .from('appointments')
            .select('*, patients(full_name)')
            .eq('id', data.appointment_id)
            .single();

        if (fetchError) throw fetchError;
        return appointment;
    },

    async getAppointmentsForDate(tenantId: string, date: string, doctorIds?: string[]) {
        let query = supabase
            .from('appointments')
            .select('*, patients(full_name), appointment_types(name, price_cents)')
            .eq('tenant_id', tenantId)
            .eq('date', date)
            .not('status', 'in', '("canceled","noshow")')
            .order('start_time', { ascending: true });

        if (doctorIds && doctorIds.length > 0) {
            query = query.in('doctor_id', doctorIds);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    },

    async getDoctorInsurancePlans(doctorId: string) {
        const { data, error } = await supabase
            .from('doctor_insurance_plans')
            .select('*, insurance_plans(*)')
            .eq('doctor_id', doctorId)
            .eq('is_active', true);

        if (error) throw error;
        return data || [];
    },
};
