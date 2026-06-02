import { supabase } from '../lib/supabase';
// Force rebuild

export interface ClinicLocation {
    id: string;
    tenant_id: string;
    name: string;
    address?: string;
    address_number?: string;
    address_complement?: string;
    address_neighborhood?: string;
    address_zip_code?: string;
    phone?: string;
    latitude?: number | null;
    longitude?: number | null;
    google_maps_url?: string;
    is_active: boolean;
    type: 'consultorio' | 'clinica' | 'hospital';
    objectives: string[];
    operating_hours?: {
        [key: number]: {
            start: string;
            end: string;
            closed: boolean;
        }
    };
}

export const locationService = {
    async getAll(tenantId: string): Promise<ClinicLocation[]> {
        const { data, error } = await supabase
            .from('locations')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('name');

        if (error) throw error;
        return (data || []) as ClinicLocation[];
    },

    async create(dto: Omit<ClinicLocation, 'id'>): Promise<ClinicLocation> {
        const { data, error } = await supabase
            .from('locations')
            .insert(dto)
            .select()
            .single();

        if (error) throw error;
        return data as ClinicLocation;
    },

    async update(id: string, dto: Partial<ClinicLocation>): Promise<boolean> {
        const { error } = await supabase
            .from('locations')
            .update(dto)
            .eq('id', id);

        if (error) throw error;
        return true;
    },

    async delete(id: string): Promise<boolean> {
        const { error } = await supabase
            .from('locations')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return true;
    }
};
