import { supabase } from '../lib/supabase';

export interface ClinicInfo {
    id: string;
    tenant_id: string;
    location_id?: string | null;
    key: string;
    value: string;
    category: 'logistics' | 'amenities' | 'policies' | 'faq' | 'general';
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
        const { data, error } = await supabase
            .from('clinic_info')
            .upsert({
                ...info,
                is_active: true
            })
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
