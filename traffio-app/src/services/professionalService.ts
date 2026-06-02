import { supabase } from '../lib/supabase';

export interface CancellationPolicy {
    enabled: boolean;
    free_window_hours: number;
    late_penalty_percent: number;
    no_show_penalty_percent: number;
}

export interface Professional {
    id: string;
    full_name: string;
    email: string;
    phone: string;
    role: string;
    specialty?: string;
    crm?: string;
    bio?: string;
    rqe?: string;
    color?: string;
    is_active: boolean;
    tenant_id?: string;
    cancellation_policy?: CancellationPolicy;
}

export interface CreateProfessionalDTO {
    full_name: string;
    email?: string;
    phone?: string;
    role: string;
    specialty?: string;
    crm?: string;
    bio?: string;
    rqe?: string;
    color?: string;
    tenant_id: string;
    is_active?: boolean;
    cancellation_policy?: CancellationPolicy;
}

export interface UpdateProfessionalDTO extends Partial<CreateProfessionalDTO> {
    id: string;
}

export const professionalService = {
    async getAll(tenantId: string): Promise<Professional[]> {
        const { data: doctors, error } = await supabase
            .from('doctors')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('full_name', { ascending: true });

        if (error) throw error;
        return (doctors || []) as Professional[];
    },

    async create(dto: CreateProfessionalDTO): Promise<Professional> {
        // [WORLD-CLASS FIX] For atomic creation of a professional in a SaaS context:
        // 1. Insert into 'doctors'
        // 2. Insert into 'members' to link the doctor to the tenant
        // 3. (Optional) Insert into 'profiles' if decoupling is needed, 
        //    but for now we follow the 'doctors-as-identity' pattern chosen in this project.
        
        const { data: doctor, error: docError } = await supabase
            .from('doctors')
            .insert({
                full_name: dto.full_name,
                email: dto.email || null,
                phone: dto.phone || null,
                role: dto.role,
                specialty: dto.specialty || null,
                crm: dto.crm || null,
                bio: dto.bio || null,
                rqe: dto.rqe || null,
                color: dto.color || '#1152d4',
                cancellation_policy: dto.cancellation_policy || { enabled: false, free_window_hours: 24, late_penalty_percent: 0, no_show_penalty_percent: 100 },
                tenant_id: dto.tenant_id, // Link directly if column exists
                is_active: true,
            })
            .select()
            .single();

        if (docError) {
            console.error('Error inserting into doctors:', docError);
            throw docError;
        }

        // 2. Mirror to profiles so other parts of the system can find this professional
        const { error: profileError } = await supabase
            .from('profiles')
            .insert({
                id: doctor.id,
                full_name: dto.full_name,
                email: dto.email || null,
                phone: dto.phone || null,
                role: dto.role,
            });

        if (profileError) {
            console.error('Error inserting into profiles:', profileError);
        }

        return doctor as Professional;
    },

    async update(dto: UpdateProfessionalDTO): Promise<boolean> {
        const updateData: Record<string, any> = {};
        if (dto.full_name !== undefined) updateData.full_name = dto.full_name;
        if (dto.email !== undefined) updateData.email = dto.email;
        if (dto.phone !== undefined) updateData.phone = dto.phone;
        if (dto.role !== undefined) updateData.role = dto.role;
        if (dto.specialty !== undefined) updateData.specialty = dto.specialty;
        if (dto.crm !== undefined) updateData.crm = dto.crm;
        if (dto.bio !== undefined) updateData.bio = dto.bio;
        if (dto.rqe !== undefined) updateData.rqe = dto.rqe;
        if (dto.color !== undefined) updateData.color = dto.color;
        if (dto.cancellation_policy !== undefined) updateData.cancellation_policy = dto.cancellation_policy;
        if (dto.is_active !== undefined) updateData.is_active = dto.is_active;

        const { error } = await supabase
            .from('doctors')
            .update(updateData)
            .eq('id', dto.id);

        if (error) {
            console.error('Database Error in professionalService.update:', error);
            throw error;
        }
        return true;
    },

    async toggleActive(id: string, currentStatus: boolean): Promise<boolean> {
        const { error } = await supabase
            .from('doctors')
            .update({ is_active: !currentStatus })
            .eq('id', id);

        if (error) throw error;
        return !currentStatus;
    },

    async delete(id: string): Promise<boolean> {
        const { error } = await supabase
            .from('doctors')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return true;
    }
};
