import { supabase } from '../lib/supabase';

export interface KnowledgeGap {
    id: string;
    tenant_id: string;
    patient_question: string;
    normalized_question: string;
    status: 'open' | 'answered' | 'dismissed';
    occurrences: number;
    first_detected_at: string;
    last_detected_at: string;
    resolved_clinic_info_key: string | null;
    sample_language: string | null;
}

export function sortKnowledgeGaps(gaps: readonly KnowledgeGap[]): KnowledgeGap[] {
    return [...gaps].sort((a, b) => b.occurrences - a.occurrences
        || Date.parse(b.last_detected_at) - Date.parse(a.last_detected_at));
}

export const knowledgeGapsService = {
    async listOpen(tenantId: string): Promise<KnowledgeGap[]> {
        const { data, error } = await supabase.from('knowledge_gaps').select('*')
            .eq('tenant_id', tenantId).eq('status', 'open')
            .order('occurrences', { ascending: false }).order('last_detected_at', { ascending: false });
        if (error) throw error;
        return sortKnowledgeGaps((data || []) as KnowledgeGap[]);
    },
    async markAnswered(id: string, clinicInfoKey: string): Promise<void> {
        const { error } = await supabase.from('knowledge_gaps').update({
            status: 'answered', resolved_clinic_info_key: clinicInfoKey,
        }).eq('id', id).eq('status', 'open');
        if (error) throw error;
    },
    async dismiss(id: string): Promise<void> {
        const { error } = await supabase.from('knowledge_gaps').update({ status: 'dismissed' })
            .eq('id', id).eq('status', 'open');
        if (error) throw error;
    },
};
