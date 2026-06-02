import { supabase } from '../lib/supabase';

export interface FinancingProposal {
    id: string;
    tenant_id: string;
    patient_id: string;
    provider: 'drcash' | 'drparcela' | 'stone';
    external_id?: string;
    amount: number;
    installments: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SIGNED' | 'CANCELED' | 'PAID';
    external_link?: string;
    failure_reason?: string;
    created_at: string;
    updated_at: string;
}

export const drCashService = {
    /**
     * Submits a new financing proposal to Dr. Cash.
     * Note: In production, this usually involves a backend call (Edge Function)
     * to keep API Keys secure.
     */
    async createProposal(
        tenantId: string,
        patientId: string,
        amount: number,
        installments: number,
        patientData: any
    ): Promise<FinancingProposal> {
        // 1. Initial record in our database
        const { data, error } = await supabase
            .from('financing_proposals')
            .insert({
                tenant_id: tenantId,
                patient_id: patientId,
                amount,
                installments,
                provider: 'drcash',
                status: 'PENDING'
            })
            .select()
            .single();

        if (error) throw error;

        // 2. Trigger the actual API call via Edge Function
        // This ensures the Dr. Cash API Key is handled securely on the server
        try {
            const { data: apiData, error: apiError } = await supabase.functions.invoke('drcash-api', {
                body: {
                    action: 'create_proposal',
                    proposal_id: data.id,
                    amount,
                    installments,
                    patient: patientData
                }
            });

            if (apiError) throw apiError;

            // Updated status based on API response
            const { data: updated, error: updateError } = await supabase
                .from('financing_proposals')
                .update({
                    external_id: apiData.external_id,
                    external_link: apiData.link,
                    status: apiData.status || 'PENDING'
                })
                .eq('id', data.id)
                .select()
                .single();

            if (updateError) throw updateError;
            return updated as FinancingProposal;

        } catch (err) {
            console.error('Dr. Cash API Error:', err);
            // Update with failure
            await supabase
                .from('financing_proposals')
                .update({ 
                    status: 'REJECTED',
                    failure_reason: 'Erro na comunicação com Dr. Cash'
                })
                .eq('id', data.id);
            
            throw new Error('Falha ao processar proposta com o parceiro financeiro.');
        }
    },

    async getByTenant(tenantId: string): Promise<FinancingProposal[]> {
        const { data, error } = await supabase
            .from('financing_proposals')
            .select('*, patients(full_name)')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data as any[];
    },

    async getByPatient(patientId: string): Promise<FinancingProposal[]> {
        const { data, error } = await supabase
            .from('financing_proposals')
            .select('*')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data as FinancingProposal[];
    }
};
