export interface ChannelAutomation {
    no_show: boolean;
    videos: boolean;
    nps: boolean;
    recovery?: boolean;
}

export interface CustomReminder {
    id: string;
    offset_minutes: number;
    type: 'no_show' | 'nps' | 'custom';
    videoUrl: string | null;
    caption: Record<string, string>;
    enabled: boolean;
}

export interface AutomationCategoryStats {
    sent: number;
    pending: number;
}

export interface MotorHealthStats {
    pending: number;
    sent24h: number;
    failed24h: number;
    categories: Record<string, AutomationCategoryStats>;
    loading: boolean;
}

export interface BotConfig {
    enabled: boolean;
    active_agent: 'human' | 'copilot' | 'ai_always' | 'ai_assistant' | 'flow_bot';
    /** Horário da equipe humana (fuso do tenant) — roteia cancelamentos no modo IA Atende */
    business_hours?: { start: string; end: string; days: number[] };
    no_show_prevention?: boolean;
    nps_enabled?: boolean;
    nps_delay_minutes?: number;
    nps_captions?: { pt: string; en: string; es: string };
    notification_locale?: 'pt' | 'en' | 'es';
    default_notification_channel?: 'whatsapp' | 'sms' | 'email';
    recall_enabled?: boolean;
    recall_days?: number;
    reminder_videos_enabled?: boolean;
    reminder_videos?: {
        '48h'?: string | null;
        '24h'?: string | null;
        '2h'?: string | null;
        '15m'?: string | null;
        [key: string]: string | null | undefined;
    };
    reminder_captions?: {
        '48h'?: string | Record<string, string>;
        '24h'?: string | Record<string, string>;
        '2h'?: string | Record<string, string>;
        '15m'?: string | Record<string, string>;
        [key: string]: string | Record<string, string> | undefined;
    };
    active_reminders?: {
        '48h'?: boolean;
        '24h'?: boolean;
        '2h'?: boolean;
        '15m'?: boolean;
        [key: string]: boolean | undefined;
    };
    custom_reminders?: CustomReminder[];
    enabled_channels?: {
        whatsapp?: boolean;
        sms?: boolean;
        mms?: boolean;
        email?: boolean;
        instagram?: boolean;
        facebook?: boolean;
    };
    channel_automations?: {
        whatsapp?: ChannelAutomation;
        sms?: ChannelAutomation;
        mms?: ChannelAutomation;
        email?: ChannelAutomation;
    };
    booking_confirmation_captions?: {
        pt: string;
        en: string;
        es: string;
    };
    booking_confirmation_image_url?: string;
    recovery_captions?: Record<string, { pt: string; en: string; es: string }>;
    /** F2 (docs/ROADMAP_PRODUTO_2026.md) — kill-switch das respostas automáticas
     * determinísticas a recovery/waitlist (clique de horário, "REMARCAR", "Sim").
     * Default ligado quando ausente. */
    structured_flows_enabled?: boolean;

    // Mantendo estes campos para compatibilidade de schema, mas não serão editáveis
    personality?: string;
    global_instructions?: string;
    identity?: { name: string; role: string };
    expertise?: string[];
    strict_rules?: string[];
    workflow?: string[];
}
