import { supabase } from '../lib/supabase';

export interface InsurancePlan {
    id: string;
    tenant_id: string;
    name: string;
    code?: string;
    is_active: boolean;
}

export interface DoctorInsurancePlan {
    id: string;
    doctor_id: string;
    insurance_plan_id: string;
    tenant_id: string;
    price_cents?: number;
    notes?: string;
    is_active: boolean;
    insurance_plans?: InsurancePlan;
}

export const insurancePlanService = {
    async getAll(tenantId: string): Promise<InsurancePlan[]> {
        const { data, error } = await supabase
            .from('insurance_plans')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('name');

        if (error) throw error;
        return (data || []) as InsurancePlan[];
    },

    async create(dto: Omit<InsurancePlan, 'id'>): Promise<InsurancePlan> {
        const { data, error } = await supabase
            .from('insurance_plans')
            .insert(dto)
            .select()
            .single();

        if (error) throw error;
        return data as InsurancePlan;
    },

    async update(id: string, dto: Partial<InsurancePlan>): Promise<boolean> {
        const { error } = await supabase
            .from('insurance_plans')
            .update(dto)
            .eq('id', id);

        if (error) throw error;
        return true;
    },

    async delete(id: string): Promise<boolean> {
        const { error } = await supabase
            .from('insurance_plans')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return true;
    },

    // Doctor ↔ Insurance Plan junction
    async getDoctorPlans(doctorId: string): Promise<DoctorInsurancePlan[]> {
        const { data, error } = await supabase
            .from('doctor_insurance_plans')
            .select('*, insurance_plans(*)')
            .eq('doctor_id', doctorId)
            .eq('is_active', true);

        if (error) throw error;
        return (data || []) as DoctorInsurancePlan[];
    },

    async linkDoctorPlan(doctorId: string, planId: string, tenantId: string, priceCents?: number): Promise<boolean> {
        const { error } = await supabase
            .from('doctor_insurance_plans')
            .upsert({
                doctor_id: doctorId,
                insurance_plan_id: planId,
                tenant_id: tenantId,
                price_cents: priceCents || null,
                is_active: true,
            }, { onConflict: 'doctor_id,insurance_plan_id' });

        if (error) throw error;
        return true;
    },

    async unlinkDoctorPlan(doctorId: string, planId: string): Promise<boolean> {
        const { error } = await supabase
            .from('doctor_insurance_plans')
            .delete()
            .eq('doctor_id', doctorId)
            .eq('insurance_plan_id', planId);

        if (error) throw error;
        return true;
    }
};
