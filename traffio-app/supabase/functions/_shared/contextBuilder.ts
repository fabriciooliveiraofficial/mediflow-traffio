import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { Session } from "./sessionManager.ts";
import { Tenant } from "./tenantResolver.ts";

export interface AIContext {
    clinic_name: string;
    current_state: string;
    date: string;
    specialties: string[];
    last_messages: { role: string, content: string }[];
    human_handoff_active: boolean;
    instructions: string;
}

export class ContextBuilder {
    constructor(private supabase: SupabaseClient) { }

    async build(session: Session, tenant: Tenant, history: any[]): Promise<AIContext> {
        // 1. Fetch Specialties (Dynamic)
        const { data: doctors } = await this.supabase
            .from('doctors')
            .select('specialty')
            .eq('tenant_id', tenant.id)
            .not('specialty', 'is', null);

        const specialties = [...new Set(doctors?.map((d: any) => d.specialty) || [])];

        // 2. Resolve Config Instructions
        const config = tenant.bot_config || {};
        const instructions = config.global_instructions || "Você é um assistente de agendamento.";

        // 3. Current Date/Time in Clinic Timezone (Default to Sao Paulo if missing)
        const timezone = (tenant as any).timezone || 'America/Sao_Paulo';
        const now = new Date().toLocaleString('pt-BR', { timeZone: timezone });

        return {
            clinic_name: (tenant as any).name || "Clínica",
            current_state: session.current_state,
            date: now,
            specialties: specialties as string[],
            last_messages: history, // Already limited by SessionManager
            human_handoff_active: session.human_handoff,
            instructions
        };
    }
}
