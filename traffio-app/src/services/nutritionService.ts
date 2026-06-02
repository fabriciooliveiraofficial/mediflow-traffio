import { supabase } from '../lib/supabase';

export interface NutriEvaluation {
    id?: string;
    patient_id: string;
    tenant_id: string;
    weight: number;
    height: number;
    bmi: number;
    body_fat_pct?: number;
    waist_circ?: number;
    hip_circ?: number;
    notes?: string;
    created_at?: string;
}

export interface MealPlan {
    id?: string;
    patient_id: string;
    tenant_id: string;
    source: 'ai' | 'manual';
    plan_data: any;
    created_at?: string;
}

export const nutritionService = {
    async saveEvaluation(evaluation: NutriEvaluation) {
        const { data, error } = await supabase
            .from('nutri_evaluations')
            .insert(evaluation)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async getEvaluations(patientId: string) {
        const { data, error } = await supabase
            .from('nutri_evaluations')
            .select('*')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data as NutriEvaluation[];
    },

    async getAllEvaluations() {
        const { data, error } = await supabase
            .from('nutri_evaluations')
            .select('*, patients(id, full_name)')
            .order('created_at', { ascending: false })
            .limit(10);
        if (error) throw error;
        return data;
    },

    async saveMealPlan(plan: MealPlan) {
        const { data, error } = await supabase
            .from('meal_plans')
            .insert(plan)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async getLatestMealPlan(patientId: string) {
        const { data, error } = await supabase
            .from('meal_plans')
            .select('*')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(); // Better for cases where no plan exists yet
        if (error) return null;
        return data as MealPlan;
    },

    async getPatientTimeline(patientId: string) {
        // Parallel fetching for performance
        const [evalsRes, plansRes] = await Promise.all([
            this.getEvaluations(patientId),
            supabase.from('meal_plans').select('*').eq('patient_id', patientId).order('created_at', { ascending: false })
        ]);

        if (evalsRes instanceof Error || plansRes.error) {
            throw evalsRes instanceof Error ? evalsRes : plansRes.error;
        }

        const timeline = [
            ...(evalsRes || []).map(e => ({ ...e, type: 'evaluation' })),
            ...(plansRes.data || []).map(p => ({ ...p, type: 'meal_plan' }))
        ];

        // Sort by date descending
        return timeline.sort((a, b) => 
            new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime()
        );
    }
};
