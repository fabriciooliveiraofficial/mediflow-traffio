import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

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
