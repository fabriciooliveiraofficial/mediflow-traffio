import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export type FunnelStage = 'novo_lead' | 'em_follow_up' | 'qualificado' | 'agendado' | 'perdido';

export interface PatientFunnelRow {
    id: string;
    tenant_id: string;
    patient_phone: string;
    patient_name: string;
    current_stage: FunnelStage;
    stage_updated_at: string;
    next_action_type?: string;
    next_action_at?: string;
    last_interaction_at: string;
    last_message_snippet?: string;
    lead_source: string;
    created_at: string;
}

interface UsePatientFunnelOptions {
    tenantId: string;
    dateRange?: { from: Date; to: Date };
}

export function usePatientFunnel({ tenantId, dateRange }: UsePatientFunnelOptions) {
    const [stages, setStages] = useState<Record<FunnelStage, PatientFunnelRow[]>>({
        novo_lead: [],
        em_follow_up: [],
        qualificado: [],
        agendado: [],
        perdido: []
    });
    const [isLoading, setIsLoading] = useState(true);
    const dateRangeRef = useRef(dateRange);
    dateRangeRef.current = dateRange;

    const fetchFunnel = useCallback(async () => {
        if (!tenantId) return;
        setIsLoading(true);
        try {
            const dr = dateRangeRef.current;
            let query = supabase
                .from('patient_funnel_stage')
                .select('*')
                .eq('tenant_id', tenantId);

            if (dr) {
                query = query
                    .gte('created_at', dr.from.toISOString())
                    .lte('created_at', dr.to.toISOString());
            }

            const { data, error } = await query.order('last_interaction_at', { ascending: false });

            if (error) throw error;

            const grouped: Record<FunnelStage, PatientFunnelRow[]> = {
                novo_lead: [],
                em_follow_up: [],
                qualificado: [],
                agendado: [],
                perdido: []
            };

            (data || []).forEach((row: any) => {
                if (grouped[row.current_stage as FunnelStage]) {
                    grouped[row.current_stage as FunnelStage].push(row as PatientFunnelRow);
                }
            });

            setStages(grouped);
        } catch (err) {
            console.error('[usePatientFunnel] Fetch error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [tenantId]); // dateRange read via ref — no loop

    useEffect(() => {
        fetchFunnel();
    }, [fetchFunnel, dateRange?.from?.getTime(), dateRange?.to?.getTime()]);

    useEffect(() => {
        if (!tenantId) return;
        const channel = supabase
            .channel(`patient_funnel_realtime_${tenantId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'patient_funnel_stage', filter: `tenant_id=eq.${tenantId}` },
                () => fetchFunnel()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [tenantId, fetchFunnel]);

    const movePatient = async (phone: string, toStage: FunnelStage) => {
        const { error } = await supabase
            .from('patient_funnel_stage')
            .update({
                current_stage: toStage,
                stage_updated_at: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .eq('patient_phone', phone);

        if (error) throw error;
        return true;
    };

    // RPC (não UPDATE direto): cada linha cancelada precisa de um
    // pgmq.delete() correspondente pra não ser reentregue — outbound_cancel_all_pending_for_patient
    // faz isso linha por linha, coordenado com o registro.
    const cancelAllPendingForPatient = async (phone: string) => {
        const { error } = await supabase.rpc('outbound_cancel_all_pending_for_patient', {
            p_tenant_id: tenantId,
            p_patient_phone: phone,
        });

        if (error) throw error;
        return true;
    };

    return {
        stages,
        movePatient,
        cancelAllPendingForPatient,
        isLoading,
        refetch: fetchFunnel
    };
}
