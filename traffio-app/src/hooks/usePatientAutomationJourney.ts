import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface JourneyEvent {
    id: string;
    type: 'inbound' | 'outbound' | 'appointment' | 'system';
    status: 'completed' | 'pending' | 'failed' | 'cancelled';
    timestamp: string;
    title: string;
    content?: string;
    metadata?: any;
}

export function usePatientAutomationJourney(phone: string, tenantId: string) {
    const [events, setEvents] = useState<JourneyEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchJourney = useCallback(async () => {
        if (!phone || !tenantId) return;
        setIsLoading(true);
        try {
            // 1. Fetch Inbound Messages
            const { data: inbox } = await supabase
                .from('message_inbox')
                .select('id, content, received_at')
                .eq('tenant_id', tenantId)
                .eq('phone', phone)
                .order('received_at', { ascending: false })
                .limit(50);

            // 2. Fetch Outbound Queue
            const { data: queue } = await supabase
                .from('outbound_reminder_registry')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('patient_phone', phone)
                .order('scheduled_at', { ascending: false })
                .limit(50);

            // 3. Fetch Appointments via patient_id (correct join)
            const { data: patientRow } = await supabase
                .from('patients')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('phone', phone)
                .maybeSingle();

            let appointments: any[] = [];
            if (patientRow?.id) {
                const { data: appts } = await supabase
                    .from('appointments')
                    .select('id, date, start_time, status, doctors(full_name), appointment_types(name)')
                    .eq('tenant_id', tenantId)
                    .eq('patient_id', patientRow.id)
                    .order('date', { ascending: false })
                    .limit(20);
                appointments = appts || [];
            }

            const unified: JourneyEvent[] = [];

            // Transform Inbound
            (inbox || []).forEach(m => {
                unified.push({
                    id: m.id,
                    type: 'inbound',
                    status: 'completed',
                    timestamp: m.received_at,
                    title: 'Mensagem do Paciente',
                    content: m.content
                });
            });

            // Transform Outbound
            (queue || []).forEach(q => {
                unified.push({
                    id: q.id,
                    type: 'outbound',
                    status: q.status === 'sent' ? 'completed' : q.status as any,
                    timestamp: q.sent_at || q.scheduled_at,
                    title: `🤖 ${q.message_type.replace(/_/g, ' ')}`,
                    content: q.template_vars?.override_message || q.template_key,
                    metadata: { template: q.template_key, error: q.error_message }
                });
            });

            // Transform Appointments — safe timestamp construction
            appointments.forEach(a => {
                const timeStr = String(a.start_time || '00:00').substring(0, 5); // HH:MM only
                unified.push({
                    id: a.id,
                    type: 'appointment',
                    status: a.status === 'confirmed' || a.status === 'scheduled' ? 'completed' : 'pending',
                    timestamp: `${a.date}T${timeStr}:00`,
                    title: 'Consulta Agendada',
                    content: `${(a.appointment_types as any)?.name || 'Consulta'} com ${(a.doctors as any)?.full_name || 'Profissional'}`,
                    metadata: { date: a.date, time: timeStr, status: a.status }
                });
            });

            // Sort by timestamp descending
            unified.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            setEvents(unified);

        } catch (err) {
            console.error('[usePatientAutomationJourney] Error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [phone, tenantId]);

    useEffect(() => {
        fetchJourney();
    }, [fetchJourney]);

    return { events, isLoading, refresh: fetchJourney };
}
