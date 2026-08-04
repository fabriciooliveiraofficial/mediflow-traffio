import { supabase } from './supabase';

export type ClinicalEntityType = 'medical_record' | 'prescription' | 'document';
export type ClinicalAuditAction = 'created' | 'amended' | 'voided' | 'reissued' | 'replaced' | 'soft_deleted' | 'restored';

interface LogClinicalActionParams {
    tenantId: string;
    entityType: ClinicalEntityType;
    entityId: string;
    action: ClinicalAuditAction;
    reason?: string | null;
}

/**
 * Registra uma ação sobre um registro clínico (evolução, receita, documento).
 * Prontuário não se edita/apaga silenciosamente — toda alteração (emenda,
 * anulação, reemissão, substituição, exclusão) fica rastreada aqui: quem,
 * quando e por quê. Falha aqui não deve travar a ação principal do usuário.
 */
export async function logClinicalAction({ tenantId, entityType, entityId, action, reason }: LogClinicalActionParams) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('clinical_audit_log').insert([{
            tenant_id: tenantId,
            entity_type: entityType,
            entity_id: entityId,
            action,
            reason: reason || null,
            performed_by: user?.id,
        }]);
    } catch (error) {
        console.error('[clinicalAudit] Failed to log action:', error);
    }
}
