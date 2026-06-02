import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Appointment, AppointmentStatus, QueuePosition, DoctorAvailability } from '../types/patient';

interface UseRealtimeQueueOptions {
    tenantId: string;
    doctorId?: string;
    date?: string; // YYYY-MM-DD, defaults to today
}

function calculateDoctorStatus(appointments: Appointment[]): DoctorAvailability {
    const inProgress = appointments.find(a => a.status === 'in_progress');
    if (!inProgress) return 'on_time';

    const startedAt = new Date(inProgress.created_at);
    const now = new Date();
    const elapsedMin = (now.getTime() - startedAt.getTime()) / 60000;
    const scheduled = 30; // default duration

    if (elapsedMin <= scheduled) return 'on_time';
    if (elapsedMin <= scheduled + 15) return 'slight_delay';
    return 'moderate_delay';
}

function buildQueuePosition(appointments: Appointment[], patientId?: string): QueuePosition {
    const waiting = appointments
        .filter(a => a.status === 'waiting')
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const inProgress = appointments.find(a => a.status === 'in_progress');
    const position = patientId
        ? waiting.findIndex(a => a.patient_id === patientId) + 1
        : 0;

    return {
        position: position > 0 ? position : waiting.length + 1,
        total: waiting.length,
        estimatedWaitMinutes: position > 0 ? position * 25 : waiting.length * 25,
        doctorStatus: calculateDoctorStatus(appointments),
        currentPatientStartedAt: inProgress?.created_at ?? null,
    };
}

export function useRealtimeQueue(
    { tenantId, doctorId, date }: UseRealtimeQueueOptions,
    patientId?: string
) {
    const today = date || new Date().toISOString().split('T')[0];
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [queue, setQueue] = useState<QueuePosition>({
        position: 0,
        total: 0,
        estimatedWaitMinutes: 0,
        doctorStatus: 'on_time',
        currentPatientStartedAt: null,
    });
    const [loading, setLoading] = useState(true);

    const fetchAppointments = useCallback(async () => {
        let query = supabase
            .from('appointments')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('date', today)
            .in('status', ['scheduled', 'confirmed', 'waiting', 'in_progress'] satisfies AppointmentStatus[])
            .order('start_time', { ascending: true });

        if (doctorId) query = query.eq('doctor_id', doctorId);

        const { data, error } = await query;
        if (error) {
            console.error('[Queue] Fetch error:', error);
            return;
        }
        const typed = (data ?? []) as Appointment[];
        setAppointments(typed);
        setQueue(buildQueuePosition(typed, patientId));
        setLoading(false);
    }, [tenantId, doctorId, today, patientId]);

    useEffect(() => {
        fetchAppointments();

        // Subscribe to realtime changes on appointments
        const channel = supabase
            .channel(`queue:${tenantId}:${today}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'appointments',
                    filter: `tenant_id=eq.${tenantId}`,
                },
                () => {
                    // Re-fetch on any change to appointments
                    fetchAppointments();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchAppointments, tenantId, today]);

    const updateStatus = useCallback(async (appointmentId: string, status: AppointmentStatus) => {
        const { error } = await supabase
            .from('appointments')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', appointmentId);

        if (error) console.error('[Queue] Update error:', error);
        // Realtime subscription will auto-refresh
    }, []);

    return { appointments, queue, loading, updateStatus, refresh: fetchAppointments };
}
