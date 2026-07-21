import { CLINIC_FACTS } from '../config/clinicFactsSchema';
import { supabase } from '../lib/supabase';
import { clinicInfoService } from './clinicInfoService';
import { knowledgeBaseService } from './knowledgeBaseService';

export type SuggestionDestination = 'clinic_info' | 'knowledge_base';
export type SuggestionSourceType = 'url' | 'pasted_text' | 'file' | 'interview';
export type SuggestionClarity = 'high' | 'medium' | 'low';

export interface ClinicFactSuggestion {
    id: string;
    tenant_id: string;
    destination: SuggestionDestination;
    fact_key: string | null;
    title: string | null;
    suggested_value: string;
    source_type: SuggestionSourceType;
    source_reference: string | null;
    source_excerpt: string | null;
    clarity: SuggestionClarity;
    /** Onda 4 (blindagem): sugestão com padrão de instrução embutida — nunca bloqueia, só destaca para revisão. */
    flagged_suspicious: boolean;
    status: 'pending' | 'approved' | 'rejected';
    created_at: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
}

export interface ExtractionRequest {
    tenantId: string;
    sourceType: Exclude<SuggestionSourceType, 'interview'>;
    sourceValue: string;
    sourceReference?: string;
    factsCatalog: Array<{
        key: string;
        type: 'boolean' | 'short_text' | 'long_text' | 'enum';
        options?: Array<{ value: string }>;
    }>;
}

export interface ApprovalPayload {
    destination: SuggestionDestination;
    factKey?: string | null;
    title?: string | null;
    value: string;
}

async function currentUserId(): Promise<string> {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Authenticated user required');
    return user.id;
}

export const clinicFactSuggestionsService = {
    async listPending(tenantId: string): Promise<ClinicFactSuggestion[]> {
        const { data, error } = await supabase
            .from('clinic_fact_suggestions')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('status', 'pending')
            .order('created_at', { ascending: true });
        if (error) throw error;
        return (data || []) as ClinicFactSuggestion[];
    },

    async extract(request: ExtractionRequest): Promise<ClinicFactSuggestion[]> {
        const { data, error } = await supabase.functions.invoke('extract-clinic-facts', { body: request });
        if (error) throw error;
        if (data?.error) throw new Error(String(data.error));
        return (data?.suggestions || []) as ClinicFactSuggestion[];
    },

    async createInterviewSuggestions(
        tenantId: string,
        answers: Array<{ key: string; value: string }>,
    ): Promise<ClinicFactSuggestion[]> {
        const factsByKey = new Map(CLINIC_FACTS.map((fact) => [fact.key, fact]));
        const factsCatalog = answers.flatMap(({ key }) => {
            const fact = factsByKey.get(key);
            return fact ? [{
                key: fact.key,
                type: fact.type,
                ...(fact.options ? { options: fact.options.map((option) => ({ value: option.value })) } : {}),
            }] : [];
        });
        const { data, error } = await supabase.functions.invoke('extract-clinic-facts', {
            body: { tenantId, sourceType: 'interview', factsCatalog, interviewAnswers: answers },
        });
        if (error) throw error;
        if (data?.error) throw new Error(String(data.error));
        return (data?.suggestions || []) as ClinicFactSuggestion[];
    },

    async approve(id: string, payload: ApprovalPayload): Promise<ClinicFactSuggestion> {
        const { data: suggestion, error: loadError } = await supabase
            .from('clinic_fact_suggestions')
            .select('*')
            .eq('id', id)
            .eq('status', 'pending')
            .single();
        if (loadError) throw loadError;
        const row = suggestion as ClinicFactSuggestion;
        const value = payload.value.trim();
        if (!value || value.length > 2_000 || payload.destination !== row.destination) {
            throw new Error('Invalid suggestion approval payload');
        }

        if (row.destination === 'clinic_info') {
            const fact = CLINIC_FACTS.find((candidate) => candidate.key === payload.factKey && candidate.key === row.fact_key);
            if (!fact) throw new Error('Invalid canonical fact key');
            await clinicInfoService.upsert({
                tenant_id: row.tenant_id,
                key: fact.key,
                value,
                category: fact.category,
            });
        } else {
            const title = payload.title?.trim();
            if (!title || title.length > 200) throw new Error('Invalid knowledge title');
            // Reusar o UUID da sugestão torna uma repetição segura caso a atualização
            // de status falhe depois da gravação no destino.
            await knowledgeBaseService.upsert({
                id: row.id,
                tenant_id: row.tenant_id,
                category: 'general',
                title,
                content: value,
                is_active: true,
                metadata: { source: 'ai_onboarding', suggestion_id: row.id },
            });
        }

        const reviewedBy = await currentUserId();
        const { data, error } = await supabase
            .from('clinic_fact_suggestions')
            .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: reviewedBy })
            .eq('id', id)
            .eq('status', 'pending')
            .select()
            .single();
        if (error) throw error;
        return data as ClinicFactSuggestion;
    },

    async reject(id: string): Promise<ClinicFactSuggestion> {
        const reviewedBy = await currentUserId();
        const { data, error } = await supabase
            .from('clinic_fact_suggestions')
            .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: reviewedBy })
            .eq('id', id)
            .eq('status', 'pending')
            .select()
            .single();
        if (error) throw error;
        return data as ClinicFactSuggestion;
    },
};
