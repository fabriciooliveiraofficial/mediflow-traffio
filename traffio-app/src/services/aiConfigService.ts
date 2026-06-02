import { supabase } from '../lib/supabase';

export interface BotConfig {
    enabled: boolean;
    personality: 'formal' | 'acolhedor' | 'objetivo';
    global_instructions: string;
    interactive_mode: boolean;
    active_agent: 'human' | 'ai_assistant' | 'flow_bot';
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
