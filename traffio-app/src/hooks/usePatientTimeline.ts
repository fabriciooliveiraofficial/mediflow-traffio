import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import type { MedicalRecord, Prescription, TimelineEvent } from '../types/patient';

export function usePatientTimeline(patientId: string) {
    const { t } = useTranslation('medical');
    const [events, setEvents] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchTimeline = useCallback(async () => {
        try {
            setLoading(true);

            // Fetch medical records
            const { data: records } = await supabase
                .from('medical_records')
                .select('*')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false });

            // Fetch prescriptions linked to those records
            const recordIds = (records ?? []).map(r => r.id);
            let prescriptions: Prescription[] = [];
            if (recordIds.length > 0) {
                const { data: rxData } = await supabase
                    .from('prescriptions')
                    .select('*')
                    .in('medical_record_id', recordIds)
                    .order('created_at', { ascending: false });
                prescriptions = (rxData ?? []) as Prescription[];
            }

            // Build unified timeline
            const timeline: TimelineEvent[] = [];

            for (const record of (records ?? []) as MedicalRecord[]) {
                timeline.push({
                    id: record.id,
                    type: 'consultation',
                    date: record.created_at,
                    title: (record as any).title || record.soap_notes?.a || t('patientTimeline.consultationFallback'),
                    subtitle: (record as any).description || record.soap_notes?.s || null,
                    data: record,
                });

                // Check for attachments (exam results)
                if (record.attachments_json?.length > 0) {
                    for (const attachment of record.attachments_json) {
                        timeline.push({
                            id: `${record.id}-att-${attachment.name}`,
                            type: 'exam_result',
                            date: attachment.uploaded_at || record.created_at,
                            title: attachment.name,
                            subtitle: attachment.type === 'lab_result' ? t('patientTimeline.labResultSubtitle') : t('patientTimeline.attachmentSubtitle'),
                            data: attachment,
                        });
                    }
                }
            }

            for (const rx of prescriptions) {
                const medications = rx.content_json?.map(m => m.medication).join(', ') || t('patientTimeline.prescriptionFallback');
                timeline.push({
                    id: rx.id,
                    type: 'prescription',
                    date: rx.created_at,
                    title: medications,
                    subtitle: t('patientTimeline.medicationsCount', { count: rx.content_json?.length || 0 }),
                    data: rx,
                });
            }

            // Sort by date descending
            timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setEvents(timeline);
        } catch (error) {
            console.error('[Timeline] Error:', error);
        } finally {
            setLoading(false);
        }
    }, [patientId, t]);

    useEffect(() => {
        if (patientId) fetchTimeline();
    }, [patientId, fetchTimeline]);

    return { events, loading, refresh: fetchTimeline };
}
