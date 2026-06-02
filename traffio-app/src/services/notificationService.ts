import { supabase } from '../lib/supabase';

interface NotificationPayload {
    phone: string;
    message: string;
    tenantId: string;
}

async function getZApiCredentials(tenantId: string) {
    const { data, error } = await supabase
        .from('tenants')
        .select('zapi_instance_id, zapi_token, zapi_client_token')
        .eq('id', tenantId)
        .single();

    if (error || !data?.zapi_instance_id) return null;
    return data;
}

function cleanPhone(phone: string): string {
    return phone.replace(/\D/g, '');
}

async function sendWhatsApp({ phone, message, tenantId }: NotificationPayload): Promise<boolean> {
    const creds = await getZApiCredentials(tenantId);
    if (!creds) {
        console.warn('[Notification] Z-API not configured for tenant:', tenantId);
        return false;
    }

    const url = `https://api.z-api.io/instances/${creds.zapi_instance_id}/token/${creds.zapi_token}/send-text`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: cleanPhone(phone),
                message,
                clientToken: creds.zapi_client_token,
            }),
        });
        return response.ok;
    } catch (error) {
        console.error('[Notification] Send error:', error);
        return false;
    }
}

// ─── Public API ────────────────────────────────────────

export const NotificationService = {
    /**
     * Send a pre-checkin link to the patient
     */
    async sendCheckinLink(phone: string, tenantId: string, appointmentId: string, patientName: string) {
        const baseUrl = window.location.origin;
        const link = `${baseUrl}/checkin?apt=${appointmentId}`;
        const message =
            `Olá, ${patientName}! 😊\n\n` +
            `Sua consulta está se aproximando. Faça seu check-in antecipado e evite filas:\n\n` +
            `👉 ${link}\n\n` +
            `Assim você chega e vai direto para o atendimento! ✨`;

        return sendWhatsApp({ phone, message, tenantId });
    },

    /**
     * Send queue position update to the patient
     */
    async sendQueueUpdate(phone: string, tenantId: string, position: number, estimatedMinutes: number) {
        const message =
            `📋 Atualização da sua fila:\n\n` +
            `Posição: ${position}º da fila\n` +
            `Tempo estimado: ~${estimatedMinutes} minutos\n\n` +
            `Quando for sua vez, você será avisado(a)! 🏥`;

        return sendWhatsApp({ phone, message, tenantId });
    },

    /**
     * Send post-consultation follow-up (Concierge)
     */
    async sendFollowUp(phone: string, tenantId: string, patientName: string, doctorName: string) {
        const message =
            `Olá, ${patientName}! 💙\n\n` +
            `Esperamos que sua consulta com ${doctorName} tenha sido boa.\n\n` +
            `Como você está se sentindo?\n` +
            `😊 Bem\n` +
            `😐 Normal\n` +
            `😔 Com desconforto\n\n` +
            `Responda com o emoji e nossa equipe cuidará de você! 🩺`;

        return sendWhatsApp({ phone, message, tenantId });
    },

    /**
     * Notify the doctor/receptionist that their next patient has arrived
     */
    async notifyPatientArrival(phone: string, tenantId: string, patientName: string) {
        const message =
            `🏥 Alerta de chegada:\n\n` +
            `O paciente *${patientName}* acabou de fazer check-in e já está pronto para atendimento.`;

        return sendWhatsApp({ phone, message, tenantId });
    },
};
