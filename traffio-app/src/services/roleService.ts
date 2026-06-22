import { supabase } from '../lib/supabase';

export interface ProfessionalRole {
    id: string;
    tenant_id: string;
    name: string;
    base_role: 'doctor' | 'staff' | 'admin';
    created_at?: string;
}

export const roleService = {
    async getAll(tenantId: string): Promise<ProfessionalRole[]> {
        const { data, error } = await supabase
            .from('professional_roles')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('name', { ascending: true });

        if (error) throw error;
        return (data || []) as ProfessionalRole[];
    },

    async create(tenantId: string, name: string, baseRole: 'doctor' | 'staff' | 'admin'): Promise<ProfessionalRole> {
        const { data, error } = await supabase
            .from('professional_roles')
            .insert({
                tenant_id: tenantId,
                name,
                base_role: baseRole
            })
            .select()
            .single();

        if (error) throw error;
        return data as ProfessionalRole;
    },

    async update(id: string, name: string, baseRole: 'doctor' | 'staff' | 'admin'): Promise<boolean> {
        const { error } = await supabase
            .from('professional_roles')
            .update({ name, base_role: baseRole })
            .eq('id', id);

        if (error) throw error;
        return true;
    },

    async delete(id: string): Promise<boolean> {
        const { error } = await supabase
            .from('professional_roles')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return true;
    }
};
