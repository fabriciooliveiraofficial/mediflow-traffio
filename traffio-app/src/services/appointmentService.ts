import { supabase } from '../lib/supabase';
import type { CancellationPolicy } from './professionalService';
import { localDateTimeToUTC } from '../lib/timezoneUtils';

export interface CancelAppointmentResult {
    success: boolean;
    penaltyApplied: boolean;
    penaltyAmount: number;
    message: string;
}

export const appointmentService = {
    async cancelAppointment(
        appointmentId: string,
        patientPhone: string,
        cancellationPolicy?: CancellationPolicy,
        appointmentDate?: string, // YYYY-MM-DD
        appointmentTime?: string,  // HH:mm format
        timezone?: string
    ): Promise<CancelAppointmentResult> {

        let penaltyApplied = false;
        let penaltyAmount = 0;

        // 1. Calculate penalty if a policy exists and is enabled
        if (cancellationPolicy?.enabled && appointmentDate && appointmentTime) {
            // Reconstruct the appointment datetime in the tenant's timezone
            const apptDateObj = localDateTimeToUTC(appointmentDate, appointmentTime, timezone || 'America/Sao_Paulo');
            const now = new Date();

            const diffMs = apptDateObj.getTime() - now.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);

            // If we are strictly within the "late" window but before the appointment
            if (diffHours > 0 && diffHours < cancellationPolicy.free_window_hours) {
                penaltyApplied = true;
                // penalty_amount could be calculated here or later. 
                // Currently just boolean tracking based on implementation plan
            }
        }

        // 2. Call the existing RPC to perform cancellation and verify ownership
        // The RPC returns a JSON object like { "status": "success/error", "message": "..." }
        const { data, error } = await supabase.rpc('rpc_cancel_appointment_by_patient', {
            p_appointment_id: appointmentId,
            p_patient_phone: patientPhone,
            p_reason: penaltyApplied ? 'Cancelamento Tardio (Multa Aplicável)' : 'Cancelado pelo paciente via Portal'
        });

        if (error) {
            console.error("RPC Error:", error);
            throw new Error('Falha ao cancelar agendamento: erro no servidor.');
        }

        // Workaround for Supabase RPC typing:
        const responseData = data as any;
        if (responseData?.status === 'error') {
            throw new Error(responseData?.message || 'Falha ao cancelar agendamento.');
        }

        // 3. Update penalty details if applicable
        if (penaltyApplied) {
            await supabase
                .from('appointments')
                .update({
                    penalty_applied: true,
                    // If we had the appointment price, we'd calculate:
                    // penalty_amount_cents: Math.round(price * (cancellationPolicy.late_penalty_percent / 100))
                })
                .eq('id', appointmentId);
        }

        return {
            success: true,
            penaltyApplied,
            penaltyAmount,
            message: penaltyApplied
                ? `Agendamento cancelado. Uma multa de ${cancellationPolicy?.late_penalty_percent}% foi aplicada por cancelamento tardio.`
                : 'Agendamento cancelado com sucesso.'
        };
    },

    // Method to check if a penalty WILL apply (for showing warnings in UI)
    checkPenalty(
        cancellationPolicy?: CancellationPolicy,
        appointmentDate?: string, // YYYY-MM-DD
        appointmentTime?: string,  // HH:mm format
        timezone?: string
    ): { applies: boolean, percent: number } {
        if (!cancellationPolicy?.enabled || !appointmentDate || !appointmentTime) {
            return { applies: false, percent: 0 };
        }

        const apptDateObj = localDateTimeToUTC(appointmentDate, appointmentTime, timezone || 'America/Sao_Paulo');
        const now = new Date();

        const diffMs = apptDateObj.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours > 0 && diffHours < cancellationPolicy.free_window_hours) {
            return { applies: true, percent: cancellationPolicy.late_penalty_percent };
        }

        return { applies: false, percent: 0 };
    }
};
