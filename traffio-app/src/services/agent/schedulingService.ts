import { supabase } from '../../lib/supabase';

export interface TimeSlot {
    time: string;
    isAvailable: boolean;
}

/**
 * Builds a timezone-safe ISO string from a date string and time string.
 * Avoids the `new Date("YYYY-MM-DD")` UTC midnight trap.
 */
function buildLocalISO(dateStr: string, time: string): string {
    const [h, m] = time.split(':').map(Number);
    const [year, month, day] = dateStr.split('-').map(Number);
    const dt = new Date(year, month - 1, day, h, m, 0, 0);
    return dt.toISOString();
}

/**
 * Returns start/end of a day in local timezone as ISO strings.
 */
function getDayBounds(dateStr: string) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);
    return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export const schedulingService = {
    generateBaseSlots(): string[] {
        return Array.from({ length: (19 - 8) * 6 }, (_, i) => {
            const totalMinutes = 8 * 60 + i * 10;
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        });
    },

    async getAvailableSlots(doctorId: string, locationId: string, date: string, tenantId: string): Promise<TimeSlot[]> {
        const { data, error } = await supabase.rpc('get_available_slots', {
            p_tenant_id: tenantId,
            p_doctor_id: doctorId,
            p_location_id: locationId,
            p_date: date,
            p_slot_duration: 30
        });

        if (error) {
            console.error('Error fetching appointments:', error);
            throw new Error('Failed to check availability.');
        }

        if (!data || !data.success || !data.slots) return [];

        return data.slots.map((s: any) => ({
            time: s.time.substring(0, 5),
            isAvailable: s.available
        }));
    },

    /**
     * Creates a new appointment securely via RPC.
     */
    async createAppointment(data: {
        tenant_id: string;
        patient_id: string;
        doctor_id: string;
        location_id: string;
        type_id?: string;
        date: string;      // "YYYY-MM-DD"
        time: string;       // "HH:MM"
        notes?: string;
    }) {
        const { data: newAppt, error } = await supabase.rpc('book_appointment', {
            p_tenant_id: data.tenant_id,
            p_patient_id: data.patient_id,
            p_doctor_id: data.doctor_id,
            p_location_id: data.location_id,
            p_type_id: data.type_id || null,
            p_date: data.date,
            p_start_time: data.time,
            p_notes: data.notes || null,
            p_booked_by: 'system'
        });

        if (error || !newAppt?.success) throw new Error(newAppt?.message || error?.message || "Booking failed");

        const { data: appointment } = await supabase
            .from('appointments')
            .select('*')
            .eq('id', newAppt.appointment_id)
            .single();

        return appointment;
    }
};
