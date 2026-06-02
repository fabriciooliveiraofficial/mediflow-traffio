import { supabase } from '../lib/supabase';
import { NotificationService } from './notificationService';

interface CompletedConsultation {
    appointmentId: string;
    patientId: string;
    patientName: string;
    patientPhone: string;
    doctorName: string;
    tenantId: string;
}

/**
 * Concierge Service: Handles post-consultation follow-up logic.
 *
 * In production, this would run as an AWS Lambda cron job or
 * Supabase Edge Function triggered every hour.
 * For now, it can be called manually from the ReceptionDashboard.
 */
export const ConciergeService = {
    /**
     * Find all consultations that were completed in the last 24 hours
     * and haven't received a follow-up yet.
     */
    async getConsultationsForFollowUp(tenantId: string): Promise<CompletedConsultation[]> {
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);

        const { data, error } = await supabase
            .from('appointments')
            .select(`
                id,
                patient_id,
                status,
                updated_at,
                patients!inner(full_name, mobile, phone),
                profiles!inner(full_name)
            `)
            .eq('tenant_id', tenantId)
            .eq('status', 'completed')
            .gte('updated_at', yesterday.toISOString())
            .order('updated_at', { ascending: false });

        if (error || !data) return [];

        return data.map((apt: any) => ({
            appointmentId: apt.id,
            patientId: apt.patient_id,
            patientName: apt.patients?.full_name || 'Paciente',
            patientPhone: apt.patients?.mobile || apt.patients?.phone || '',
            doctorName: apt.profiles?.full_name || 'seu médico',
            tenantId,
        }));
    },

    /**
     * Send follow-up messages to all eligible patients.
     * Returns the number of messages sent successfully.
     */
    async sendFollowUps(tenantId: string): Promise<number> {
        const consultations = await this.getConsultationsForFollowUp(tenantId);
        let sent = 0;

        for (const consultation of consultations) {
            if (!consultation.patientPhone) continue;

            const success = await NotificationService.sendFollowUp(
                consultation.patientPhone,
                consultation.tenantId,
                consultation.patientName,
                consultation.doctorName,
            );

            if (success) sent++;
        }

        return sent;
    },

    /**
     * Check if a patient response indicates distress.
     * Used by webhook handlers to route negative feedback to the receptionist.
     */
    isNegativeFeedback(message: string): boolean {
        const negativeIndicators = ['😔', '😢', '😡', 'mal', 'dor', 'pior', 'desconfort', 'ruim', 'problem'];
        const lower = message.toLowerCase();
        return negativeIndicators.some(indicator => lower.includes(indicator));
    },
};
