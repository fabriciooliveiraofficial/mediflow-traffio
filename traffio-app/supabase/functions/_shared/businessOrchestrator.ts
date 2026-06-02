import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { resolveDate } from "./dateResolver.ts";

export class BusinessOrchestrator {
    constructor(private supabase: SupabaseClient) { }

    /**
     * Generates a deterministic text response based on the state and missing fields.
     */
    async generateResponse(stateInput: any, context: any, tenantId: string): Promise<{ text: string; interactive?: any }> {
        const { entities, clinic_name, patient_name } = context;

        // --- STATE NORMALIZATION (Fix for XState Object Hierarchies) ---
        let state = "UNKNOWN";
        if (typeof stateInput === 'string') {
            state = stateInput;
        } else if (typeof stateInput === 'object' && stateInput !== null) {
            // Flatten { SCHEDULING: 'AWAITING_SPECIALTY' } -> "SCHEDULING.AWAITING_SPECIALTY"
            const keys = Object.keys(stateInput);
            if (keys.length > 0) {
                const parent = keys[0];
                const child = stateInput[parent];
                state = `${parent}.${child}`;
            }
        }

        let response = "";
        let interactive: any = null;

        // Human Handoff
        if (state === 'HUMAN_HANDOFF') {
            response = "_[Sistema]_ Um atendente humano irá assumir agora. Aguarde um momento.";
        }

        // Success
        else if (state === 'SUCCESS') {
            response = `✅ *Agendamento Confirmado!*\n\nPaciente: ${patient_name || 'Você'}\nData: ${entities.date}\nHorário: ${entities.time}\nEspecialidade: ${entities.specialty}\n\nObrigado por escolher a ${clinic_name}!`;
        }

        // Unknown / Error
        else if (state === 'UNKNOWN_INTENT') {
            response = "Desculpe, não entendi. Você gostaria de agendar uma consulta ou tirar dúvidas?";
        }

        // --- FALLBACK FOR MISSING STATE ---
        else if (!state || state === 'UNKNOWN') {
            response = "Desculpe, estou um pouco confuso. Vamos recomeçar? Digite 'Olá'.";
        }

        // Scheduling Flows
        else if (state.includes('AWAITING_SPECIALTY')) {
            const options = context.specialties?.length
                ? context.specialties.map((s: string) => `• ${s}`).join('\n')
                : "• Clínica Geral\n• Cardiologia";
            response = `Para qual especialidade você deseja agendar?\n\n${options}`;

            // Add Interactive Buttons if specialties exist
            if (context.specialties?.length) {
                interactive = {
                    type: 'button',
                    body: "Escolha uma especialidade:",
                    buttons: context.specialties.slice(0, 3).map((s: string) => ({
                        id: `specialty_${s.toLowerCase().replace(/\s+/g, '_')}`,
                        title: s
                    }))
                };
            }
        }

        else if (state.includes('AWAITING_DATE')) {
            response = "Para qual data você prefere? (Ex: Amanhã, 12/08)";
            interactive = {
                type: 'button',
                body: "Sugestões de data:",
                buttons: [
                    { id: 'date_today', title: 'Hoje' },
                    { id: 'date_tomorrow', title: 'Amanhã' }
                ]
            };
        }

        else if (state.includes('AWAITING_DOCTOR')) {
            const { data: doctors } = await this.supabase
                .from('doctors')
                .select('id, full_name, user_id')
                .eq('tenant_id', tenantId)
                .ilike('specialty', `%${entities.specialty}%`);

            if (doctors && doctors.length > 0) {
                const options = doctors.map((d: any) => `• Dr(a). ${d.full_name}`).join('\n');
                response = `Temos os seguintes especialistas em *${entities.specialty}* disponíveis:\n\n${options}\n\nCom qual médico você prefere agendar?`;

                // Z-API max buttons is 3, so we can only show buttons if <= 3 doctors or use list
                if (doctors.length <= 3) {
                    interactive = {
                        type: 'button',
                        body: "Escolha o profissional:",
                        buttons: doctors.map((d: any) => ({
                            id: `doctor_${d.id}`, // using user_id or id might be long, but UUIDs are 36 chars, Z-API allows up to 256 for id
                            title: `Dr(a). ${d.full_name.split(' ')[0]}`
                        }))
                    };
                } else {
                    // Fallback to List for > 3
                    interactive = {
                        type: 'list',
                        header: 'Médicos',
                        body: 'Escolha o profissional na lista abaixo:',
                        footer: clinic_name,
                        button: 'Ver Médicos',
                        sections: [{
                            title: "Disponíveis",
                            rows: doctors.map((d: any) => ({
                                id: `doctor_${d.id}`,
                                title: `Dr(a). ${d.full_name.split(' ')[0]}`,
                                description: entities.specialty
                            }))
                        }]
                    };
                }
            } else {
                response = `Desculpe, não encontrei médicos disponíveis na especialidade *${entities.specialty}*.`;
            }
        }

        else if (state.includes('AWAITING_LOCATION')) {
            // Get locations for this doctor
            const { data: locs } = await this.supabase
                .from('doctor_locations')
                .select('locations(id, name, address)')
                .eq('doctor_id', entities.doctor_id);

            const availableLocs = locs?.map((l: any) => l.locations).filter(Boolean) || [];

            if (availableLocs.length > 0) {
                const options = availableLocs.map((l: any) => `• ${l.name} (${l.address || 'Sem endereço'})`).join('\n');
                response = `Em qual local você prefere ser atendido(a)?\n\n${options}`;

                if (availableLocs.length <= 3) {
                    interactive = {
                        type: 'button',
                        body: "Escolha o local:",
                        buttons: availableLocs.map((l: any) => ({
                            id: `location_${l.id}`,
                            title: l.name.substring(0, 20)
                        }))
                    };
                } else {
                    interactive = {
                        type: 'list',
                        header: 'Locais',
                        body: 'Escolha o local na lista abaixo:',
                        footer: clinic_name,
                        button: 'Ver Locais',
                        sections: [{
                            title: "Disponíveis",
                            rows: availableLocs.map((l: any) => ({
                                id: `location_${l.id}`,
                                title: l.name.substring(0, 24),
                                description: l.address ? l.address.substring(0, 72) : ''
                            }))
                        }]
                    };
                }
            } else {
                response = `Desculpe, não consegui carregar os locais de atendimento deste médico.`;
            }
        }

        else if (state.includes('AWAITING_SERVICE')) {
            const { data: services } = await this.supabase
                .from('appointment_types')
                .select('id, name, duration_minutes')
                .eq('tenant_id', tenantId)
                .eq('is_active', true);

            if (services && services.length > 0) {
                const options = services.map((s: any) => `• ${s.name} (${s.duration_minutes} min)`).join('\n');
                response = `Qual o tipo de serviço que você deseja agendar?\n\n${options}`;

                if (services.length <= 3) {
                    interactive = {
                        type: 'button',
                        body: "Escolha o serviço:",
                        buttons: services.map((s: any) => ({
                            id: `service_${s.id}`,
                            title: s.name.substring(0, 20)
                        }))
                    };
                } else {
                    interactive = {
                        type: 'list',
                        header: 'Serviços',
                        body: 'Escolha o serviço na lista abaixo:',
                        footer: clinic_name,
                        button: 'Ver Serviços',
                        sections: [{
                            title: "Disponíveis",
                            rows: services.map((s: any) => ({
                                id: `service_${s.id}`,
                                title: s.name.substring(0, 24),
                                description: `${s.duration_minutes} min`
                            }))
                        }]
                    };
                }
            } else {
                response = `Desculpe, não encontrei serviços configurados.`;
            }
        }

        else if (state.includes('AWAITING_TIME')) {
            const resolvedDate = resolveDate(entities.date);
            if (!resolvedDate) {
                return { text: "Não entendi a data informada. Pode digitar no formato DD/MM ou escolher Hoje/Amanhã?", interactive: { type: 'button', body: "Sugestões de data:", buttons: [{ id: 'date_today', title: 'Hoje' }, { id: 'date_tomorrow', title: 'Amanhã' }] } };
            }
            const { data: slotsResult, error } = await this.supabase.rpc('get_available_slots', {
                p_tenant_id: tenantId,
                p_doctor_id: entities.doctor_id,
                p_location_id: entities.location_id,
                p_date: resolvedDate,
                p_slot_duration: 30
            });

            if (!error && slotsResult?.success && slotsResult.slots?.length > 0) {
                // Return max 10 available slots
                const available = slotsResult.slots.filter((s: any) => s.available).slice(0, 10);

                if (available.length > 0) {
                    const options = available.map((s: any) => `• ${s.time.substring(0, 5)}`).join('\n');
                    response = `Temos os seguintes horários livres no dia ${entities.date}:\n\n${options}\n\nQual fica melhor para você?`;

                    interactive = {
                        type: 'list',
                        header: 'Horários',
                        body: 'Escolha o horário desejado:',
                        footer: clinic_name,
                        button: 'Ver Horários',
                        sections: [{
                            title: `Dia ${entities.date}`,
                            rows: available.map((s: any) => ({
                                id: `time_${s.time.substring(0, 5)}`,
                                title: s.time.substring(0, 5),
                                description: 'Horário disponível'
                            }))
                        }]
                    };
                } else {
                    response = `Desculpe, não há horários livres no dia ${entities.date}. Gostaria de tentar outra data?`;
                }
            } else {
                response = `Desculpe, não encontrei disponibilidade no dia ${entities.date}. Gostaria de tentar outra data?`;
            }
        }

        else if (state.includes('CONFIRMING')) {
            response = `Confirma o agendamento para *${entities.specialty}* no dia *${entities.date}* às *${entities.time}*?\n\nResponda SIM para confirmar ou NÃO para corrigir.`;
            interactive = {
                type: 'button',
                body: "Confirma os dados?",
                buttons: [
                    { id: 'confirm_yes', title: 'SIM, confirmar' },
                    { id: 'confirm_no', title: 'NÃO, vou ajustar' }
                ]
            };
        }

        else if (state === 'FAQ_ANSWER') {
            response = context.intent_answer || "Desculpe, não tenho essa informação no momento.";
        }
        else {
            response = `Olá! Sou o assistente virtual da ${clinic_name}. Como posso ajudar hoje?\n\n• Agendar Consulta\n• Dúvidas Frequentes`;
            interactive = {
                type: 'button',
                body: "Como posso ajudar?",
                buttons: [
                    { id: 'flow_schedule', title: 'Agendar Consulta' },
                    { id: 'flow_faq', title: 'Tirar Dúvidas' }
                ]
            };
        }

        return {
            text: this.validateResponse(response),
            interactive
        };
    }

    /**
     * Validates and sanitizes the response (Market Standard Guardrail).
     */
    private validateResponse(response: string): string {
        if (!response || response.trim().length === 0) {
            return "Ocorreu um erro ao gerar a resposta. Pode tentar novamente?";
        }

        let cleaned = response.trim();
        const validEndings = ['.', '?', '!', ':', '*', ')', '🌐', '✅', '❌', '📅', '🕒', '👤', '🏥'];
        const lastChar = cleaned.slice(-1);

        if (!validEndings.includes(lastChar) && !cleaned.endsWith('...')) {
            console.warn(`Response missing punctuation (Fixed): "${cleaned}"`);
            cleaned += "...";
        }

        return cleaned;
    }

    /**
     * Validates slot availability securely using the RPC mapping logic.
     */
    async validateSlot(tenantId: string, doctorId: string | null, locationId: string | null, date: string, time: string): Promise<boolean> {
        if (!doctorId || !locationId) return false;

        const resolvedDate = resolveDate(date);
        if (!resolvedDate) return false;

        const { data, error } = await this.supabase.rpc('get_available_slots', {
            p_tenant_id: tenantId,
            p_doctor_id: doctorId,
            p_location_id: locationId,
            p_date: resolvedDate,
            p_slot_duration: 30
        });

        if (error || !data || !data.success || !data.slots) return false;

        // Ensure the time format matches HH:MM:SS format returned by DB
        const timePrefix = time.length === 5 ? `${time}:00` : time;
        const matchingSlot = data.slots.find((s: any) => s.time === timePrefix && s.available === true);

        return !!matchingSlot;
    }

    /**
     * Executes the booking transactionally using the atomic RPC.
     */
    async bookAppointment(tenantId: string, patientPhone: string, details: any): Promise<boolean> {
        // BUG FIX #5: Resolver datas relativas antes de passar ao RPC.
        // Exemplo: 'amanhã' → '2026-03-20', 'hoje' → '2026-03-19'.
        const resolvedDate = resolveDate(details.date);
        if (!resolvedDate) {
            console.error(`bookAppointment: data inválida ou não reconhecida: "${details.date}"`);
            return false;
        }
        details = { ...details, date: resolvedDate };

        // First resolve patient ID
        const { data: patient } = await this.supabase
            .from('patients')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('phone', patientPhone)
            .single();

        if (!patient) {
            console.error("No patient found with phone", patientPhone);
            return false;
        }

        const { data, error } = await this.supabase
            .rpc('book_appointment', {
                p_tenant_id: tenantId,
                p_patient_id: patient.id,
                p_doctor_id: details.doctor_id,
                p_location_id: details.location_id,
                p_type_id: details.service_id,
                p_date: details.date,
                p_start_time: details.time,
                p_booked_by: 'ai_agent'
            });

        if (error) {
            console.error("Booking RPC failed:", error);
            return false;
        }

        // RPC returns jsonb: { success: boolean, reason?: string, appointment_id?: uuid }
        if (data && data.success) {
            console.log("Appointment booked:", data.appointment_id);
            return true;
        }

        console.warn("Booking conflict or logic failure:", data);
        return false;
    }
}
