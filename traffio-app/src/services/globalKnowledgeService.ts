import { supabase } from '../lib/supabase';

export type GlobalKnowledgeLanguage = 'pt-BR' | 'en' | 'es';
export interface GlobalKnowledge {
    id: string;
    topic_key: string;
    language: GlobalKnowledgeLanguage;
    category: string;
    title: string;
    content: string;
    is_active: boolean;
    guardrails: Record<string, unknown>;
}

export const globalKnowledgeService = {
    async list(): Promise<GlobalKnowledge[]> {
        const { data, error } = await supabase.from('global_knowledge').select('*').order('topic_key').order('language');
        if (error) throw error;
        return (data || []) as GlobalKnowledge[];
    },
    async update(id: string, patch: Partial<Pick<GlobalKnowledge, 'title' | 'content' | 'is_active'>>): Promise<void> {
        const { error } = await supabase.from('global_knowledge').update(patch).eq('id', id);
        if (error) throw error;
    },
};
