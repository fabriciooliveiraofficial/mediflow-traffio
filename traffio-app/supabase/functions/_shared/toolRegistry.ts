import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

export interface ToolDefinition<T> {
    name: string;
    description: string;
    schema: z.ZodType<T>;
    execute: (params: T, supabase: SupabaseClient, context: any) => Promise<any>;
}

export const toolRegistry: Record<string, ToolDefinition<any>> = {
    fetch_doctors: {
        name: "fetch_doctors",
        description: "Busca a lista de médicos, opcionalmente filtrada por especialidade e local.",
        schema: z.object({
            tenant_id: z.string().uuid(),
            specialty: z.string().optional(),
            location_id: z.string().uuid().optional()
        }),
        execute: async (params, supabase) => {
            // BUG FIX #4: Sempre filtrar por tenant_id.
            // A Edge Function usa service_role (bypassa RLS), então o filtro manual é obrigatório.
            // Sem isso, qualquer paciente poderia receber médicos de outras clínicas.
            let query = supabase
                .from('doctors')
                .select('id, full_name, specialty')
                .eq('tenant_id', params.tenant_id);

            if (params.specialty) {
                query = query.ilike('specialty', `%${params.specialty}%`);
            }

            const { data, error } = await query;
            if (error) throw error;
            return data;
        }
    },

    get_available_slots: {
        name: "get_available_slots",
        description: "Busca os horários disponíveis para um médico em um local e data específicos.",
        schema: z.object({
            tenant_id: z.string().uuid(),
            doctor_id: z.string().uuid(),
            location_id: z.string().uuid(),
            date: z.string().describe("Data no formato YYYY-MM-DD")
        }),
        execute: async (params, supabase) => {
            const { data, error } = await supabase.rpc('get_available_slots', {
                p_tenant_id: params.tenant_id,
                p_doctor_id: params.doctor_id,
                p_location_id: params.location_id,
                p_date: params.date,
                p_slot_duration: 30
            });
            if (error) throw error;
            return data;
        }
    },

    book_appointment: {
        name: "book_appointment",
        description: "Confirma o agendamento de forma atômica.",
        schema: z.object({
            tenant_id: z.string().uuid(),
            patient_phone: z.string(),
            doctor_id: z.string().uuid(),
            location_id: z.string().uuid(),
            service_id: z.string().uuid(),
            date: z.string().describe("Data no formato YYYY-MM-DD"),
            time: z.string().describe("Horário no formato HH:MM")
        }),
        execute: async (params, supabase) => {
            // First we need to resolve the patient_id from the phone
            const { data: patient } = await supabase
                .from('patients')
                .select('id')
                .eq('tenant_id', params.tenant_id)
                .eq('phone', params.patient_phone)
                .single();
                
            if (!patient) return { success: false, message: "Paciente não encontrado." };

            const { data, error } = await supabase.rpc('book_appointment', {
                p_tenant_id: params.tenant_id,
                p_patient_id: patient.id,
                p_doctor_id: params.doctor_id,
                p_location_id: params.location_id,
                p_type_id: params.service_id,
                p_date: params.date,
                p_start_time: params.time,
                p_booked_by: 'ai_agent'
            });

            if (error) {
                console.error("Booking RPC failed:", error);
                return { success: false, message: error.message };
            }
            return data;
        }
    },

    cancel_appointment: {
        name: "cancel_appointment",
        description: "Cancela um agendamento existente do paciente.",
        schema: z.object({
            appointment_id: z.string().uuid(),
            patient_phone: z.string()
        }),
        execute: async (params, supabase) => {
            const { data, error } = await supabase.rpc('rpc_cancel_appointment_by_patient', {
                p_appointment_id: params.appointment_id,
                p_patient_phone: params.patient_phone,
                p_reason: 'Cancelado via assistente IA'
            });
            if (error) throw error;
            return data;
        }
    }
};
