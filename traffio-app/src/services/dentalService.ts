import { supabase } from '../lib/supabase';

export interface DentalRecord {
    id?: string;
    patient_id: string;
    tenant_id: string;
    tooth_number: number;
    plane: string;
    condition: string;
    notes?: string;
}

export interface DentalBudget {
    id?: string;
    patient_id: string;
    tenant_id: string;
    status: 'draft' | 'sent' | 'approved' | 'rejected';
    total_amount: number;
    notes?: string;
    valid_until?: string;
    items?: DentalBudgetItem[];
}

export interface DentalBudgetItem {
    id?: string;
    budget_id?: string;
    tooth_number?: number;
    plane?: string;
    procedure_name: string;
    unit_price: number;
    quantity: number;
    total_price: number;
}

export const dentalService = {
    async saveRecords(records: DentalRecord[]) {
        if (records.length === 0) return;
        
        // Delete existing records for these planes to prevent duplicates
        for (const record of records) {
            await supabase
                .from('dental_records')
                .delete()
                .eq('patient_id', record.patient_id)
                .eq('tooth_number', record.tooth_number)
                .eq('plane', record.plane);
        }

        // Insert new records
        const { data, error } = await supabase
            .from('dental_records')
            .insert(records.map(({ id, ...r }) => r));
        if (error) throw error;
        return data;
    },

    async deleteRecords(records: { patient_id: string; tooth_number: number; plane: string }[]) {
        if (records.length === 0) return;
        
        for (const record of records) {
            const { error } = await supabase
                .from('dental_records')
                .delete()
                .eq('patient_id', record.patient_id)
                .eq('tooth_number', record.tooth_number)
                .eq('plane', record.plane);
            if (error) throw error;
        }
    },

    async getRecords(patientId: string) {
        const { data, error } = await supabase
            .from('dental_records')
            .select('*')
            .eq('patient_id', patientId);
        if (error) throw error;
        return data as DentalRecord[];
    },

    async createBudget(budget: Omit<DentalBudget, 'items'>, items: Omit<DentalBudgetItem, 'id' | 'budget_id'>[]) {
        // 1. Create Budget
        const { data: budgetData, error: budgetError } = await supabase
            .from('dental_budgets')
            .insert(budget)
            .select()
            .single();

        if (budgetError) throw budgetError;

        // 2. Create Items
        const budgetItems = items.map(item => ({
            ...item,
            budget_id: budgetData.id
        }));

        const { error: itemsError } = await supabase
            .from('dental_budget_items')
            .insert(budgetItems);

        if (itemsError) throw itemsError;

        return budgetData;
    },

    async getBudgets(patientId: string) {
        const { data, error } = await supabase
            .from('dental_budgets')
            .select('*, dental_budget_items(*), patients(full_name)')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async getAllBudgets() {
        const { data, error } = await supabase
            .from('dental_budgets')
            .select('*, patients(full_name)')
            .order('created_at', { ascending: false })
            .limit(10);
        if (error) throw error;
        return data;
    },

    async getRecalls() {
        // Mocking logic: patients who haven't had an appointment in 6 months
        // In a real scenario, this would be a complex query or a dedicated table
        const { data, error } = await supabase
            .from('patients')
            .select('*')
            .limit(5);
        if (error) throw error;
        return data.map(p => ({ ...p, recall_reason: 'Limpeza Semestral', due_date: 'Hoje' }));
    }
};
