import { supabase } from '../lib/supabase';

export interface BotConfig {
    enabled: boolean;
    personality: 'formal' | 'acolhedor' | 'objetivo';
    global_instructions: string;
    interactive_mode: boolean;
    /**
     * Dial de autonomia da IA (docs/SPEC_AGENTE_IA_CLAUDE.md):
     * human = IA desligada · copilot = IA sugere, humano envia (Nível 0)
     * ai_always = IA atende e decide quando transferir (fail-safe → fila humana)
     * ai_assistant/flow_bot = valores legados (mapeados para human na UI)
     */
    active_agent: 'human' | 'copilot' | 'ai_always' | 'ai_assistant' | 'flow_bot';
}

export const aiConfigService = {
    async getBotConfig(tenantId: string): Promise<BotConfig | null> {
        try {
            const { data, error } = await supabase
                .from('tenants')
                .select('bot_config')
                .eq('id', tenantId)
                .single();

            if (error || !data) {
                console.error('[AI Config] Error fetching bot config:', error);
                return null;
            }

            const config = data.bot_config as any;
            return {
                enabled: config.enabled ?? false,
                personality: config.personality ?? 'formal',
                global_instructions: config.global_instructions ?? '',
                interactive_mode: config.interactive_mode ?? true,
                active_agent: config.active_agent ?? (config.enabled ? 'ai_assistant' : 'human')
            };
        } catch (err) {
            console.error('[AI Config] Critical error:', err);
            return null;
        }
    }
};
