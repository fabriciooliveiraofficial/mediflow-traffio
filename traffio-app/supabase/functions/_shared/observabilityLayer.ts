import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

// ── Onda 5.1/5.2 — trace por turno do agente (agent_turn_events) ────────────
// Diferente de ai_audit_logs (métrica por CHAMADA de LLM): este é o resumo de
// UM TURNO inteiro — qual rota decidiu, ferramentas usadas, violações pegas
// pelo validador, motivo de handoff. É o que falta hoje para reconstruir "por
// que este turno terminou assim" sem adivinhar lendo logs de console.

export type AgentTurnRoute = "structured_flow" | "agent" | "human" | "ignored";

export interface AgentTurnEvent {
    tenant_id: string;
    session_id?: string | null;
    phone?: string | null;
    route: AgentTurnRoute;
    turn_language?: string | null;
    tools_called?: string[];
    violations?: string[];
    handoff_reason?: string | null;
    handoff_kind?: "soft" | "hard" | null;
    bubbles?: number | null;
    latency_ms?: number | null;
    tokens_in?: number | null;
    tokens_out?: number | null;
}

/**
 * Grava o trace do turno. Best-effort absoluto: falha aqui NUNCA pode afetar
 * o turno do paciente — é por isso que todo chamador envolve isto num
 * try/catch próprio, e esta função também nunca lança.
 */
export async function logAgentTurnEvent(supabase: SupabaseClient, event: AgentTurnEvent): Promise<void> {
    try {
        const { error } = await supabase.from("agent_turn_events").insert(event);
        if (error) console.warn(`[observability] agent_turn_events insert falhou (non-fatal): ${error.message}`);
    } catch (err: any) {
        console.warn(`[observability] agent_turn_events falha isolada (non-fatal): ${err?.message}`);
    }
}

export class ObservabilityLayer {
    constructor(private supabase: SupabaseClient) { }

    /**
     * Logs interaction metrics to ai_audit_logs.
     */
    async logInteraction(
        tenantId: string,
        sessionId: string,
        metrics: {
            input_tokens: number;
            output_tokens: number;
            response_time_ms: number;
            validation_passed: boolean;
            error_flag?: boolean;
        }
    ) {
        const { error } = await this.supabase
            .from('ai_audit_logs')
            .insert([{
                tenant_id: tenantId,
                session_id: sessionId,
                input_tokens: metrics.input_tokens,
                output_tokens: metrics.output_tokens,
                response_time_ms: metrics.response_time_ms,
                validation_passed: metrics.validation_passed,
                error_flag: metrics.error_flag || false
            }]);

        if (error) {
            console.error("Failed to write audit log:", error);
        }
    }
}
