import { supabase } from '../lib/supabase';

/**
 * Gate de prontidão para o dial 'ai_always' (Onda 5.4, docs/TAREFA_GEMINI_REENGENHARIA_AGENTE_IA.md).
 *
 * Um agente com persona excelente e base de conhecimento vazia continua dando
 * resposta pobre ("vou confirmar com a equipe") — o próprio incidente que deu
 * origem à reengenharia do agente veio de um tenant sem `address` preenchido.
 * Este serviço checa o mínimo de dado que o agente precisa para não cair em
 * evasiva logo na primeira pergunta.
 */

export type AiReadinessMissingKey =
    | 'address'
    | 'business_hours'
    | 'consultation_fee'
    | 'appointment_type'
    | 'doctor_service';

export interface AiReadiness {
    ready: boolean;
    missing: AiReadinessMissingKey[];
}

export const aiReadinessService = {
    async check(tenantId: string): Promise<AiReadiness> {
        const [factsResult, typesResult, doctorServicesResult] = await Promise.all([
            supabase
                .from('clinic_info')
                .select('key, value')
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .in('key', ['address', 'business_hours', 'consultation_fee']),
            supabase
                .from('appointment_types')
                .select('id', { count: 'exact', head: true })
                .eq('tenant_id', tenantId)
                .not('duration_minutes', 'is', null),
            supabase
                .from('doctor_services')
                .select('doctor_id')
                .eq('tenant_id', tenantId)
                .limit(1),
        ]);

        if (factsResult.error) throw factsResult.error;
        if (typesResult.error) throw typesResult.error;
        if (doctorServicesResult.error) throw doctorServicesResult.error;

        const filledFactKeys = new Set(
            (factsResult.data || [])
                .filter((row) => typeof row.value === 'string' && row.value.trim().length > 0)
                .map((row) => row.key),
        );

        const missing: AiReadinessMissingKey[] = [];
        if (!filledFactKeys.has('address')) missing.push('address');
        if (!filledFactKeys.has('business_hours')) missing.push('business_hours');
        if (!filledFactKeys.has('consultation_fee')) missing.push('consultation_fee');
        if ((typesResult.count ?? 0) < 1) missing.push('appointment_type');
        if ((doctorServicesResult.data?.length ?? 0) < 1) missing.push('doctor_service');

        return { ready: missing.length === 0, missing };
    },
};
