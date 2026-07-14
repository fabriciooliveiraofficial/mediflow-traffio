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
            return { data: { professionals: [MOCK_DOCTOR] } };

        case "ver_disponibilidade":
            if (opts.availabilityFails) {
                return { data: { error: "timeout: agenda indisponível no momento" } };
            }
            return {
                data: {
                    available: [{ date: MOCK_DATE, location: "Unidade Centro", slots: MOCK_SLOT_TIMES }],
                    note: "Os horários acima serão enviados como botões clicáveis — apresente-os brevemente e convide o paciente a escolher.",
                },
            };

        case "buscar_meus_agendamentos":
            return { data: { appointments: [MOCK_APPOINTMENT] } };

        case "agendar":
            return { data: { success: true, appointment_id: "novo-agendamento-mock" } };

        case "remarcar":
            return { data: { success: true, rescheduled: true } };

        default:
            return { data: { error: `unknown_tool:${call.name}` } };
    }
}
