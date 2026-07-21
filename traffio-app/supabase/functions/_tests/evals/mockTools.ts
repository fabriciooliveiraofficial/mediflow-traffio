/**
 * mockTools — executor de ferramentas FALSO para os evals.
 * O modelo é real; as ferramentas devolvem fixtures determinísticas.
 * Nenhuma mensagem é enviada, nenhum banco é tocado.
 */
import type { LlmToolCall } from "../../_shared/llmProvider.ts";

export const MOCK_DOCTOR = { id: "d0c70r00-0000-0000-0000-000000000001", full_name: "Dra. Ana Souza" };
export const MOCK_LOCATION_ID = "10ca7100-0000-0000-0000-000000000001";
export const MOCK_SLOT_TIMES = ["09:00", "10:30", "14:00"];
export const MOCK_DATE = "2026-07-16";

export const MOCK_APPOINTMENT = {
    id: "a9901n7e-0000-0000-0000-000000000001",
    date: "2026-07-17",
    start_time: "11:00",
    status: "scheduled",
    doctors: { full_name: MOCK_DOCTOR.full_name },
    appointment_types: { name: "Limpeza" },
    location_id: MOCK_LOCATION_ID,
};

export interface MockOptions {
    /** ver_disponibilidade devolve erro (cenário "ferramenta fora do ar") */
    availabilityFails?: boolean;
}

export function mockExecuteTool(call: LlmToolCall, opts: MockOptions = {}): { data: any } {
    switch (call.name) {
        case "listar_profissionais":
            return { data: { professionals: [{ ...MOCK_DOCTOR, specialty: "Odontologia", performs: ["Limpeza dental", "Clareamento dental", "Avaliação inicial"] }] } };

        case "atualizar_cadastro_paciente":
            return { data: { success: true, patient_id: "patient-mock-1", created: true } };

        case "adicionar_lista_espera":
            return { data: { success: true, waitlist_id: "waitlist-mock-1", note: "Confirm warmly that the patient is on the waitlist and will be notified as soon as a slot opens. Reply in the PATIENT'S language." } };

        case "ver_disponibilidade":
            if (opts.availabilityFails) {
                return { data: { error: "timeout: agenda indisponível no momento" } };
            }
            // Espelha o executor procedure-first de produção: o sistema resolve o
            // profissional sozinho e instrui a não citar nomes sem ser perguntado.
            return {
                data: {
                    service: "Avaliação inicial",
                    available: [{
                        date: MOCK_DATE,
                        location: "Unidade Centro",
                        professional: MOCK_DOCTOR.full_name,
                        slots: MOCK_SLOT_TIMES.map(t => ({ time: t, slot_id: `slot|${MOCK_DOCTOR.id}|${MOCK_LOCATION_ID}||${MOCK_DATE}|${t}` })),
                    }],
                    slots_formatted: `tomorrow 📅 07/23/2026\n🕛09:00 am\n🕛10:30 am\n🕛02:00 pm`,
                    note: "Write the message to the patient INCLUDING the `slots_formatted` block EXACTLY as provided (copy it verbatim, keep the emoji and line breaks), then close with ONE short question asking which time works best. The same slots also go as clickable buttons automatically. If the patient picks a time by TEXT, call `agendar` immediately with that option's exact slot_id. Do NOT mention professional names unless the patient asked. Reply in the PATIENT'S language.",
                },
            };

        case "buscar_meus_agendamentos":
            return { data: { appointments: [MOCK_APPOINTMENT] } };

        case "agendar":
            return { data: { success: true, appointment_id: "novo-agendamento-mock", professional: MOCK_DOCTOR.full_name, note: "Confirm the booking to the patient including date, time and professional name. Reply in the PATIENT'S language." } };

        case "remarcar":
            return { data: { success: true, rescheduled: true } };

        default:
            return { data: { error: `unknown_tool:${call.name}` } };
    }
}
