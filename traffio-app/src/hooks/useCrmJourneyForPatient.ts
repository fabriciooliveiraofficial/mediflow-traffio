import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Mesmo papel de useCrmJourneyForSession, mas para telas que só têm patient_id
 * (Agenda), não session_id (Inbox). Ignora jornadas já fechadas (won/lost) —
 * mesma regra de busca que crm_ensure_journey() usa no backend — para sempre
 * resolver a jornada aberta atual do paciente, não uma jornada antiga encerrada.
 */
export function useCrmJourneyForPatient(patientId: string | null | undefined, tenantId: string | null | undefined) {
    const [journeyId, setJourneyId] = useState<string | null>(null);
    const [stageId, setStageId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!patientId || !tenantId) {
            setJourneyId(null);
            setStageId(null);
            return;
        }
        let active = true;
        setLoading(true);
        supabase
            .from('crm_journeys')
            .select('id, stage_id')
            .eq('patient_id', patientId)
            .eq('tenant_id', tenantId)
            .not('stage_id', 'in', '(won,lost)')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data, error }) => {
                if (!active) return;
                if (error) {
                    console.error('[useCrmJourneyForPatient] fetch failed:', error.message);
                    setJourneyId(null);
                    setStageId(null);
                } else {
                    setJourneyId(data?.id ?? null);
                    setStageId(data?.stage_id ?? null);
                }
                setLoading(false);
            });
        return () => { active = false; };
    }, [patientId, tenantId]);

    return { journeyId, stageId, loading };
}
