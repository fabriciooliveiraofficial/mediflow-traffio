import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';

export type CrmTimelineEventType = 'session_created' | 'appointment' | 'message_outbound' | 'message_inbound' | 'stage_change';

export interface CrmTimelineEvent {
    id: string;
    type: CrmTimelineEventType;
    date: string;
    title: string;
    subtitle: string | null;
    status?: string | null;
    data?: any;
    icon?: any;
}

export function useLeadTimeline(sessionId: string | null, tenantId: string | undefined) {
    const { t } = useTranslation('crm');
    const [events, setEvents] = useState<CrmTimelineEvent[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchTimeline = useCallback(async () => {
        if (!sessionId || !tenantId) return;

        try {
            setLoading(true);
            const timeline: CrmTimelineEvent[] = [];

            // 1. Fetch Session Info
            const { data: session } = await supabase
                .from('conversation_sessions')
                .select('*')
                .eq('id', sessionId)
                .single();

            if (session) {
                // Initial Contact
                timeline.push({
                    id: `created-${session.id}`,
                    type: 'session_created',
                    date: session.created_at,
                    title: t('timeline.events.firstContact', { defaultValue: 'Primeiro Contato' }),
                    subtitle: t('timeline.events.leadEntered', { defaultValue: 'Lead entrou no CRM' }),
                    data: session
                });

                // 2. Fetch Appointments (match by patient_id or phone)
                if (session.patient_phone || session.patient_id) {
                    let appointmentQuery = supabase
                        .from('appointments')
                        .select('id, date, start_time, status, type_id, notes, created_at, updated_at')
                        .eq('tenant_id', tenantId);

                    if (session.patient_id) {
                        appointmentQuery = appointmentQuery.eq('patient_id', session.patient_id);
                    } else if (session.patient_phone) {
                        // Assuming patient matching logic or just relying on patient_id if it's there
                        const { data: pt } = await supabase
                            .from('patients')
                            .select('id')
                            .eq('tenant_id', tenantId)
                            .eq('phone', session.patient_phone)
                            .maybeSingle();
                        
                        if (pt?.id) {
                            appointmentQuery = appointmentQuery.eq('patient_id', pt.id);
                        } else {
                            // If no patient found by phone, return empty for this part
                            appointmentQuery = appointmentQuery.eq('id', '00000000-0000-0000-0000-000000000000'); // dummy to return nothing
                        }
                    }

                    const { data: appointments } = await appointmentQuery;

                    if (appointments) {
                        appointments.forEach(apt => {
                            let title = t('timeline.events.appointmentScheduled', { defaultValue: 'Consulta Agendada' });
                            if (apt.status === 'canceled') title = t('timeline.events.appointmentCanceled', { defaultValue: 'Consulta Cancelada' });
                            else if (apt.status === 'completed') title = t('timeline.events.appointmentCompleted', { defaultValue: 'Consulta Realizada' });
                            else if (apt.status === 'no_show') title = t('timeline.events.appointmentNoShow', { defaultValue: 'Paciente Faltou' });
                            
                            // Event: when it was created/scheduled
                            timeline.push({
                                id: `apt-${apt.id}-created`,
                                type: 'appointment',
                                date: apt.created_at,
                                title: t('timeline.events.appointmentCreated', { defaultValue: 'Agendamento Realizado' }),
                                subtitle: `${t('timeline.events.appointmentDate', { defaultValue: 'Data Marcada:' })} ${apt.date} ${apt.start_time.slice(0,5)}`,
                                status: 'created',
                                data: apt
                            });

                            // Event: When it actually happens/happened or canceled
                            if (apt.status === 'canceled' || apt.status === 'completed' || apt.status === 'no_show') {
                                timeline.push({
                                    id: `apt-${apt.id}-status`,
                                    type: 'appointment',
                                    date: apt.updated_at || apt.created_at, // rough approximation for status change date
                                    title: title,
                                    subtitle: apt.notes ? t('timeline.events.notes', { defaultValue: 'Notas:' }) + ' ' + apt.notes : null,
                                    status: apt.status,
                                    data: apt
                                });
                            }
                        });
                    }
                }

                // 3. Fetch Chat Messages (assistant / team responses)
                const { data: messages } = await supabase
                    .from('conversation_messages')
                    .select('id, role, content, created_at')
                    .eq('session_id', sessionId)
                    .order('created_at', { ascending: false })
                    .limit(50); // Get last 50 messages to avoid clutter
                
                if (messages && messages.length > 0) {
                    // Let's find the first response from the team (First Contact Returned)
                    const assistantMessages = messages.filter(m => m.role === 'assistant' || m.role === 'system');
                    const firstResponse = assistantMessages[assistantMessages.length - 1]; // because it's desc order
                    
                    if (firstResponse) {
                        timeline.push({
                            id: `first-reply-${firstResponse.id}`,
                            type: 'message_outbound',
                            date: firstResponse.created_at,
                            title: t('timeline.events.contactReturned', { defaultValue: 'Contato Retornado' }),
                            subtitle: t('timeline.events.firstResponseSent', { defaultValue: 'Primeira resposta da clínica' }),
                            data: firstResponse
                        });
                    }

                    // For the rest, we can add a few recent outbound messages
                    const recentOutbounds = assistantMessages.slice(0, 5); // top 5 most recent
                    recentOutbounds.forEach(msg => {
                        if (msg.id !== firstResponse?.id) {
                            timeline.push({
                                id: `msg-${msg.id}`,
                                type: 'message_outbound',
                                date: msg.created_at,
                                title: t('timeline.events.teamMessage', { defaultValue: 'Interação da Equipe' }),
                                subtitle: msg.content?.substring(0, 50) + (msg.content && msg.content.length > 50 ? '...' : ''),
                                data: msg
                            });
                        }
                    });
                }
            }

            // Sort by date descending
            timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            
            // Deduplicate if necessary (though our ID strategy should be okay)
            const uniqueTimeline = Array.from(new Map(timeline.map(item => [item.id, item])).values());

            setEvents(uniqueTimeline);
        } catch (error) {
            console.error('[LeadTimeline] Error fetching timeline:', error);
        } finally {
            setLoading(false);
        }
    }, [sessionId, tenantId, t]);

    useEffect(() => {
        fetchTimeline();
    }, [fetchTimeline]);

    return { events, loading, refresh: fetchTimeline };
}
