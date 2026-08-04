import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import type { MedicalRecord, Prescription, TimelineEvent } from '../types/patient';
import { prescriptionSummary } from '../lib/prescriptions';

interface DocumentRow {
    id: string;
    filename: string;
    file_url: string;
    file_type: string | null;
    category: string | null;
    created_at: string;
}

export function usePatientTimeline(patientId: string) {
    const { t } = useTranslation('medical');
    const [events, setEvents] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchTimeline = useCallback(async () => {
        try {
            setLoading(true);

            const [{ data: records }, { data: rxData }, { data: docsData }] = await Promise.all([
                supabase
                    .from('medical_records')
                    .select('*')
                    .eq('patient_id', patientId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('prescriptions')
                    .select('*')
                    .eq('patient_id', patientId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('documents')
                    .select('id, filename, file_url, file_type, category, created_at')
                    .eq('patient_id', patientId)
                    .eq('category', 'exam_result')
                    .order('created_at', { ascending: false }),
            ]);

            const prescriptions = (rxData ?? []) as Prescription[];
            const documents = (docsData ?? []) as DocumentRow[];

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
            }

            for (const rx of prescriptions) {
                const summary = prescriptionSummary(rx.content_json);
                timeline.push({
                    id: rx.id,
                    type: 'prescription',
                    date: rx.created_at,
                    title: summary || t('patientTimeline.prescriptionFallback'),
                    subtitle: t('patientTimeline.medicationsCount', { count: (rx.content_json as any)?.medications?.length || 0 }),
                    data: rx,
                });
            }

            for (const doc of documents) {
                timeline.push({
                    id: doc.id,
                    type: 'exam_result',
                    date: doc.created_at,
                    title: doc.filename,
                    subtitle: t('patientTimeline.attachmentSubtitle'),
                    data: { name: doc.filename, url: doc.file_url, type: (doc.file_type as any) || 'pdf', uploaded_at: doc.created_at },
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
