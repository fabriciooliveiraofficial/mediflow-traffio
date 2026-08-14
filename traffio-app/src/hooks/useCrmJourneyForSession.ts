import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Resolve session_id -> crm_journeys (id, stage_id). Único lugar que faz essa
 * consulta — antes, HumanInboxPage.tsx e SidebarLeadClassifyView.tsx escreviam
 * direto em conversation_sessions.kanban_stage sem nunca saber a jornada real
 * por trás da conversa, o que impedia essas telas de chamarem crm_move_stage()
 * (a única forma correta de avançar o estágio real do funil).
 */
export function useCrmJourneyForSession(sessionId: string | null | undefined) {
    const [journeyId, setJourneyId] = useState<string | null>(null);
    const [stageId, setStageId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!sessionId) {
            setJourneyId(null);
            setStageId(null);
            return;
        }
        let active = true;
        setLoading(true);
        supabase
            .from('crm_journeys')
            .select('id, stage_id')
            .eq('session_id', sessionId)
            .maybeSingle()
            .then(({ data, error }) => {
                if (!active) return;
                if (error) {
                    console.error('[useCrmJourneyForSession] fetch failed:', error.message);
                    setJourneyId(null);
                    setStageId(null);
                } else {
                    setJourneyId(data?.id ?? null);
                    setStageId(data?.stage_id ?? null);
                }
                setLoading(false);
            });
        return () => { active = false; };
    }, [sessionId]);

    return { journeyId, stageId, loading };
}
