import { supabase } from '../lib/supabase';
import {
    CLINIC_FACTS,
    getClinicFactValueLimit,
    type ClinicFactCategory,
} from '../config/clinicFactsSchema';

const MAX_NON_CANONICAL_VALUE_LENGTH = 4_000;

export interface ClinicInfo {
    id: string;
    tenant_id: string;
    location_id?: string | null;
    key: string;
    value: string;
    category: ClinicFactCategory;
    is_active: boolean;
}

export const clinicInfoService = {
    async getAll(tenantId: string): Promise<ClinicInfo[]> {
        const { data, error } = await supabase
            .from('clinic_info')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('category', { ascending: true })
            .order('key', { ascending: true });

        if (error) throw error;
        return (data || []) as ClinicInfo[];
    },

    async upsert(info: Omit<ClinicInfo, 'id' | 'is_active'> & { id?: string }): Promise<ClinicInfo> {
        const canonicalFact = CLINIC_FACTS.find((fact) => fact.key === info.key);
        const value = info.value.trim();
        const maxLength = canonicalFact
            ? getClinicFactValueLimit(canonicalFact)
            : MAX_NON_CANONICAL_VALUE_LENGTH;

        if (!value || value.length > maxLength) {
            throw new Error(`Invalid clinic_info value length for ${info.key}`);
        }
        if ((canonicalFact?.type === 'enum' || canonicalFact?.type === 'boolean')
            && !canonicalFact.options?.some((option) => option.value === value)) {
            throw new Error(`Invalid canonical option for ${info.key}`);
        }

        const { data, error } = await supabase
            .from('clinic_info')
            .upsert({
                ...info,
                value,
                ...(canonicalFact ? { category: canonicalFact.category } : {}),
                is_active: true
            }, { onConflict: 'tenant_id,key' })
            .select()
            .single();

        if (error) throw error;
        return data as ClinicInfo;
    },

    async delete(id: string): Promise<boolean> {
        const { error } = await supabase
            .from('clinic_info')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return true;
    }
};
