import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Brain,
    MessageSquare,
    Save,
    Loader2,
    Activity,
    Clock,
    AlertCircle,
    X,
    Check,
    Settings,
    ChevronDown,
    ChevronUp,
    Bell,
    Star,
    Video,
    Upload,
    Trash2,
    AlertTriangle,
    Zap,
    MessageCircle,
    Phone,
    Image,
    Mail,
    Instagram,
    Facebook,
    Plus,
    Code2
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';
import { DEFAULT_BOOKING_CAPTIONS } from '../lib/messageDefaults';

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
    active_agent: 'human' | 'copilot' | 'ai_assistant' | 'flow_bot';
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
    recovery_captions?: Record<string, { pt: string; en: string; es: string }>;

    // Mantendo estes campos para compatibilidade de schema, mas não serão editáveis
    personality?: string;
    global_instructions?: string;
    identity?: { name: string; role: string };
    expertise?: string[];
    strict_rules?: string[];
    workflow?: string[];
}

export const Intelligence = () => {
    const { t } = useTranslation('tenantAdmin');
    const { showToast } = useToast();
    const { tenant, loading: tenantLoading, refresh: refreshTenant } = useTenant();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [healthStats, setHealthStats] = useState<MotorHealthStats>({
        pending: 0, sent24h: 0, failed24h: 0, categories: {}, loading: true
    });
    const [config, setConfig] = useState<BotConfig>({
        enabled: true,
        active_agent: 'human',
        no_show_prevention: true,
        nps_enabled: true,
        nps_delay_minutes: 180,
        default_notification_channel: 'whatsapp',
        booking_confirmation_captions: DEFAULT_BOOKING_CAPTIONS,
        recall_enabled: false,
        recall_days: 180,
        reminder_videos_enabled: false,
        reminder_captions: {
            '48h': { pt: 'Olá! Passando para confirmar seu agendamento em 48 horas.', en: 'Hello! Just confirming your appointment in 48 hours.', es: '¡Hola! Confirmamos tu cita en 48 horas.' },
            '24h': { pt: 'Olá! Seu agendamento é em 24 horas. Nos vemos em breve!', en: 'Hello! Your appointment is in 24 hours. See you soon!', es: '¡Hola! Tu cita es en 24 horas. ¡Nos vemos pronto!' },
            '2h': { pt: 'Lembrete: Seu agendamento é em 2 horas.', en: 'Reminder: Your appointment is in 2 hours.', es: 'Recordatorio: Tu cita es en 2 horas.' },
            '15m': { pt: 'Estamos te aguardando em 5 minutos!', en: 'We are waiting for you in 5 minutes!', es: '¡Te estamos esperando en 5 minutos!' }
        },
        active_reminders: {
            '48h': true,
            '24h': true,
            '2h': true,
            '15m': true
        },
        enabled_channels: {
            whatsapp: true,
            sms: true,
            mms: false,
            email: false,
            instagram: false,
            facebook: false
        },
        channel_automations: {
            whatsapp: { no_show: true, videos: true, nps: true, recovery: true },
            sms: { no_show: true, videos: false, nps: true, recovery: false },
            mms: { no_show: true, videos: true, nps: false },
            email: { no_show: false, videos: false, nps: true, recovery: false }
        },
        recovery_captions: DEFAULT_RECOVERY_CAPTIONS,
        custom_reminders: [
            {
                id: '48h-default',
                offset_minutes: -2880,
                type: 'no_show',
                videoUrl: null,
                caption: { pt: 'Olá! Passando para confirmar seu agendamento em 48 horas.', en: 'Hello! Just confirming your appointment in 48 hours.', es: '¡Hola! Confirmamos tu cita en 48 horas.' },
                enabled: true
            },
            {
                id: '24h-default',
                offset_minutes: -1440,
                type: 'no_show',
                videoUrl: null,
                caption: { pt: 'Olá! Seu agendamento é em 24 horas. Nos vemos em breve!', en: 'Hello! Your appointment is in 24 hours. See you soon!', es: '¡Hola! Tu cita es en 24 horas. ¡Nos vemos pronto!' },
                enabled: true
            },
            {
                id: '2h-default',
                offset_minutes: -120,
                type: 'no_show',
                videoUrl: null,
                caption: { pt: 'Lembrete: Seu agendamento é em 2 horas.', en: 'Reminder: Your appointment is in 2 hours.', es: 'Recordatorio: Tu cita es en 2 horas.' },
                enabled: true
            },
            {
                id: '15m-default',
                offset_minutes: -15,
                type: 'no_show',
                videoUrl: null,
                caption: { pt: 'Estamos te aguardando em 5 minutos!', en: 'We are waiting for you in 5 minutes!', es: '¡Te estamos esperando en 5 minutos!' },
                enabled: true
            }
        ]
    });

    useEffect(() => {
        if (!tenantLoading && tenant?.id) {
            fetchConfig();
        } else if (!tenantLoading) {
            setLoading(false);
        }
    }, [tenant?.id, tenantLoading]);

    useEffect(() => {
        if (!tenant?.id) return;
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const fetchHealth = async () => {
            const [pendingRes, sentRes, failedRes, categoriesRes] = await Promise.all([
                supabase.from('outbound_message_queue')
                    .select('*', { count: 'exact', head: true })
                    .eq('tenant_id', tenant.id).eq('status', 'pending'),
                supabase.from('outbound_message_queue')
                    .select('*', { count: 'exact', head: true })
                    .eq('tenant_id', tenant.id).eq('status', 'sent').gte('sent_at', since24h),
                supabase.from('outbound_message_queue')
                    .select('*', { count: 'exact', head: true })
                    .eq('tenant_id', tenant.id).eq('status', 'failed').gte('created_at', since24h),
                supabase.rpc('get_automation_hub_stats', { p_tenant_id: tenant.id }),
            ]);

            const categories: Record<string, AutomationCategoryStats> = {};
            for (const row of (categoriesRes.data as any[] | null) ?? []) {
                categories[row.category] = {
                    sent:    Number(row.sent_count)    || 0,
                    pending: Number(row.pending_count) || 0,
                };
            }

            setHealthStats({
                pending:  pendingRes.count  ?? 0,
                sent24h:  sentRes.count     ?? 0,
                failed24h: failedRes.count  ?? 0,
                categories,
                loading:  false,
            });
        };

        fetchHealth();
        const interval = setInterval(fetchHealth, 60_000);
        return () => clearInterval(interval);
    }, [tenant?.id]);

    const fetchConfig = async () => {
        try {
            if (!tenant?.id) return;

            const { data: tenantData, error } = await supabase
                .from('tenants')
                .select('bot_config')
                .eq('id', tenant.id)
                .single();

            if (error) {
                console.error('Error fetching tenant config:', error);
                return;
            }

            const savedConfig = tenantData?.bot_config as any;
            if (savedConfig) {
                const ensureRecordCaption = (cap: any, legacyKey?: string): Record<string, string> => {
                    if (!cap) {
                        if (legacyKey === '48h') return { pt: 'Olá! Passando para confirmar seu agendamento em 48 horas.', en: 'Hello! Just confirming your appointment in 48 hours.', es: '¡Hola! Confirmamos tu cita en 48 horas.' };
                        if (legacyKey === '24h') return { pt: 'Olá! Seu agendamento é em 24 horas. Nos vemos em breve!', en: 'Hello! Your appointment is in 24 hours. See you soon!', es: '¡Hola! Tu cita es en 24 horas. ¡Nos vemos pronto!' };
                        if (legacyKey === '2h') return { pt: 'Lembrete: Seu agendamento é em 2 horas.', en: 'Reminder: Your appointment is in 2 hours.', es: 'Recordatorio: Tu cita es en 2 horas.' };
                        return { pt: 'Estamos te aguardando em 5 minutos!', en: 'We are waiting for you in 5 minutes!', es: '¡Te estamos esperando en 5 minutos!' };
                    }
                    if (typeof cap === 'string') {
                        return { pt: cap, en: '', es: '' };
                    }
                    return {
                        pt: cap.pt || '',
                        en: cap.en || '',
                        es: cap.es || '',
                        ...cap
                    };
                };

                const customReminders = (savedConfig.custom_reminders || [
                    {
                        id: '48h-default',
                        offset_minutes: -2880,
                        type: 'no_show',
                        videoUrl: savedConfig.reminder_videos?.['48h'] || null,
                        caption: savedConfig.reminder_captions?.['48h'] || '',
                        enabled: savedConfig.active_reminders?.['48h'] !== false
                    },
                    {
                        id: '24h-default',
                        offset_minutes: -1440,
                        type: 'no_show',
                        videoUrl: savedConfig.reminder_videos?.['24h'] || null,
                        caption: savedConfig.reminder_captions?.['24h'] || '',
                        enabled: savedConfig.active_reminders?.['24h'] !== false
                    },
                    {
                        id: '2h-default',
                        offset_minutes: -120,
                        type: 'no_show',
                        videoUrl: savedConfig.reminder_videos?.['2h'] || null,
                        caption: savedConfig.reminder_captions?.['2h'] || '',
                        enabled: savedConfig.active_reminders?.['2h'] !== false
                    },
                    {
                        id: '15m-default',
                        offset_minutes: -15,
                        type: 'no_show',
                        videoUrl: savedConfig.reminder_videos?.['15m'] || null,
                        caption: savedConfig.reminder_captions?.['15m'] || '',
                        enabled: savedConfig.active_reminders?.['15m'] !== false
                    }
                ]).map((r: any) => ({
                    ...r,
                    caption: ensureRecordCaption(r.caption, r.id === '48h-default' ? '48h' : r.id === '24h-default' ? '24h' : r.id === '2h-default' ? '2h' : r.id === '15m-default' ? '15m' : undefined)
                }));

                const migratedCaptions: Record<string, Record<string, string>> = {};
                const sourceCaptions = savedConfig.reminder_captions || {};
                Object.keys(sourceCaptions).forEach(key => {
                    migratedCaptions[key] = ensureRecordCaption(sourceCaptions[key], key);
                });

                setConfig({
                    ...savedConfig,
                    // Dial de autonomia: só 'human' e 'copilot' são válidos na F1.
                    // Valores autônomos legados (ai_assistant/flow_bot) caem para
                    // 'human' até os níveis F2/F3 serem reativados com evals.
                    active_agent: savedConfig.active_agent === 'copilot' ? 'copilot' : 'human',
                    enabled: true,
                    nps_delay_minutes: savedConfig.nps_delay_minutes ?? 180,
                    default_notification_channel: savedConfig.default_notification_channel ?? 'whatsapp',
                    booking_confirmation_captions: savedConfig.booking_confirmation_captions || DEFAULT_BOOKING_CAPTIONS,
                    recall_enabled: savedConfig.recall_enabled ?? false,
                    recall_days: savedConfig.recall_days ?? 180,
                    custom_reminders: customReminders,
                    reminder_captions: Object.keys(migratedCaptions).length > 0 ? migratedCaptions : {
                        '48h': { pt: 'Olá! Passando para confirmar seu agendamento em 48 horas.', en: 'Hello! Just confirming your appointment in 48 hours.', es: '¡Hola! Confirmamos tu cita en 48 horas.' },
                        '24h': { pt: 'Olá! Seu agendamento é em 24 horas. Nos vemos em breve!', en: 'Hello! Your appointment is in 24 hours. See you soon!', es: '¡Hola! Tu cita es en 24 horas. ¡Nos vemos pronto!' },
                        '2h': { pt: 'Lembrete: Seu agendamento é em 2 horas.', en: 'Reminder: Your appointment is in 2 hours.', es: 'Recordatorio: Tu cita es en 2 horas.' },
                        '15m': { pt: 'Estamos te aguardando em 5 minutos!', en: 'We are waiting for you in 5 minutes!', es: '¡Te estamos esperando en 5 minutos!' }
                    },
                    active_reminders: savedConfig.active_reminders || {
                        '48h': true,
                        '24h': true,
                        '2h': true,
                        '15m': true
                    },
                    enabled_channels: savedConfig.enabled_channels || {
                        whatsapp: true,
                        sms: true,
                        mms: false,
                        email: false,
                        instagram: false,
                        facebook: false
                    },
                    channel_automations: (() => {
                        const base = savedConfig.channel_automations || {
                            whatsapp: {
                                no_show: savedConfig.no_show_prevention !== false,
                                videos: savedConfig.reminder_videos_enabled ?? true,
                                nps: savedConfig.nps_enabled !== false
                            },
                            sms: {
                                no_show: savedConfig.no_show_prevention !== false,
                                videos: false,
                                nps: savedConfig.nps_enabled !== false
                            },
                            mms: {
                                no_show: savedConfig.no_show_prevention !== false,
                                videos: savedConfig.reminder_videos_enabled ?? false,
                                nps: savedConfig.nps_enabled !== false
                            },
                            email: {
                                no_show: false,
                                videos: false,
                                nps: savedConfig.nps_enabled !== false
                            }
                        };
                        // Recovery: WhatsApp ligado por padrão (comportamento do motor CRM)
                        return {
                            ...base,
                            whatsapp: { recovery: true, ...(base.whatsapp || {}) },
                            sms: { recovery: false, ...(base.sms || {}) },
                            email: { recovery: false, ...(base.email || {}) }
                        };
                    })(),
                    recovery_captions: Object.fromEntries(
                        Object.keys(DEFAULT_RECOVERY_CAPTIONS).map(key => [key, {
                            ...DEFAULT_RECOVERY_CAPTIONS[key],
                            ...(savedConfig.recovery_captions?.[key] || {})
                        }])
                    )
                });
            }
        } catch (error) {
            console.error('Error fetching config:', error);
            showToast('error', t('intelligence.toasts.loadConfigError', { message: (error as Error).message }));
        } finally {
            setLoading(false);
        }
    };

    const saveConfig = async () => {
        setSaving(true);
        try {
            if (!tenant?.id) throw new Error(t('intelligence.toasts.tenantNotFound'));

            const noShowEnabled = !!(
                config.channel_automations?.whatsapp?.no_show ||
                config.channel_automations?.sms?.no_show ||
                config.channel_automations?.mms?.no_show ||
                config.channel_automations?.email?.no_show
            );
            const npsEnabled = !!(
                config.channel_automations?.whatsapp?.nps ||
                config.channel_automations?.sms?.nps ||
                config.channel_automations?.mms?.nps ||
                config.channel_automations?.email?.nps
            );
            const videosEnabled = !!(
                config.channel_automations?.whatsapp?.videos ||
                config.channel_automations?.mms?.videos
            );

            const enabledChannels = {
                whatsapp: !!(config.channel_automations?.whatsapp?.no_show || config.channel_automations?.whatsapp?.videos || config.channel_automations?.whatsapp?.nps || config.channel_automations?.whatsapp?.recovery),
                sms: !!(config.channel_automations?.sms?.no_show || config.channel_automations?.sms?.nps || config.channel_automations?.sms?.recovery),
                mms: !!(config.channel_automations?.mms?.no_show || config.channel_automations?.mms?.videos || config.channel_automations?.mms?.nps),
                email: !!(config.channel_automations?.email?.no_show || config.channel_automations?.email?.nps || config.channel_automations?.email?.recovery),
                instagram: false,
                facebook: false
            };

            // Rebuild legacy structures for database backwards compatibility
            const activeReminders: Record<string, boolean> = {
                '48h': false,
                '24h': false,
                '2h': false,
                '15m': false
            };
            const reminderVideos: Record<string, string | null> = {};
            const reminderCaptions: Record<string, Record<string, string>> = {};

            (config.custom_reminders || []).forEach(r => {
                let legacyKey = '';
                if (r.offset_minutes === -2880) legacyKey = '48h';
                else if (r.offset_minutes === -1440) legacyKey = '24h';
                else if (r.offset_minutes === -120) legacyKey = '2h';
                else if (r.offset_minutes === -15) legacyKey = '15m';

                if (legacyKey) {
                    activeReminders[legacyKey] = r.enabled;
                    reminderVideos[legacyKey] = r.videoUrl;
                    reminderCaptions[legacyKey] = r.caption;
                }
            });

            const payload = {
                ...config,
                no_show_prevention: noShowEnabled,
                nps_enabled: npsEnabled,
                reminder_videos_enabled: videosEnabled,
                enabled_channels: enabledChannels,
                active_reminders: {
                    ...(config.active_reminders || {}),
                    ...activeReminders
                },
                reminder_videos: {
                    ...(config.reminder_videos || {}),
                    ...reminderVideos
                },
                reminder_captions: {
                    ...(config.reminder_captions || {}),
                    ...reminderCaptions
                }
            };

            console.log('[DEBUG] Saving bot_config:', payload);

            const { error } = await supabase
                .from('tenants')
                .update({ bot_config: payload })
                .eq('id', tenant.id);

            if (error) throw error;

            await refreshTenant();
            showToast('success', t('intelligence.toasts.saveSuccess'));
        } catch (error: any) {
            console.error('[DEBUG] Error saving:', error);
            showToast('error', t('intelligence.toasts.saveError', { message: error.message || t('intelligence.toasts.saveErrorUnknown') }));
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-brand-primary" size={32} /></div>;

    return (
        <div className="w-full space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white">
                    <Zap size={32} />
                </div>
                <div>
                    <h1 className="text-3xl font-black text-graphite-900 tracking-tight">{t('intelligence.header.title')}</h1>
                    <p className="text-graphite-400 font-medium tracking-tight">{t('intelligence.header.subtitle')}</p>
                </div>
            </div>

            {/* Dial de autonomia da IA — F1: humano ou copiloto (docs/SPEC_AGENTE_IA_CLAUDE.md) */}
            <div className="bg-white border border-ice-100 rounded-3xl shadow-sm p-6 flex flex-wrap items-center gap-6">
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-black text-graphite-900">{t('intelligence.aiDial.title')}</h3>
                    <p className="text-xs font-medium text-graphite-400 mt-1">
                        {config.active_agent === 'copilot'
                            ? t('intelligence.aiDial.copilotHint')
                            : t('intelligence.aiDial.humanHint')}
                    </p>
                </div>
                <div className="flex bg-ice-100 p-1 rounded-xl border border-ice-200/60 shrink-0">
                    {([
                        { key: 'human', label: t('intelligence.aiDial.human') },
                        { key: 'copilot', label: t('intelligence.aiDial.copilot') },
                    ] as { key: 'human' | 'copilot'; label: string }[]).map(mode => (
                        <button
                            key={mode.key}
                            onClick={() => setConfig(prev => ({ ...prev, active_agent: mode.key }))}
                            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all border-0 cursor-pointer ${
                                config.active_agent === mode.key
                                    ? 'bg-white text-brand-primary shadow-sm'
                                    : 'bg-transparent text-graphite-500 hover:text-graphite-800'
                            }`}
                        >
                            {mode.label}
                        </button>
                    ))}
                </div>
            </div>

            <MotorHealth stats={healthStats} />

            <div className="space-y-6">
                <AutomationSettings
                    config={config}
                    setConfig={setConfig}
                    onSave={saveConfig}
                    saving={saving}
                />
            </div>
        </div>
    );
};

const MotorHealth = ({ stats }: { stats: MotorHealthStats }) => {
    const { t } = useTranslation('tenantAdmin');

    // Categorias do Automation Hub — mesmos rótulos das colunas da Matriz de Canais
    const categoryCards = [
        {
            key:   'no_show',
            label: t('intelligence.matrixSection.headers.noShow', { defaultValue: 'Prevenção de No-Show' }),
            icon:  Bell,
            color: 'text-brand-primary',
        },
        {
            key:   'videos',
            label: t('intelligence.matrixSection.headers.videos', { defaultValue: 'Vídeos de Confirmação' }),
            icon:  Video,
            color: 'text-indigo-500',
        },
        {
            key:   'nps',
            label: t('intelligence.matrixSection.headers.nps', { defaultValue: 'Pesquisa NPS' }),
            icon:  Star,
            color: 'text-amber-500',
        },
        {
            key:   'recovery',
            label: t('intelligence.matrixSection.headers.recovery', { defaultValue: 'Recuperação de Faltas' }),
            icon:  Clock,
            color: 'text-rose-500',
        },
    ];

    const cards = [
        {
            label: t('intelligence.health.pending', { defaultValue: 'Mensagens Pendentes' }),
            value: stats.pending,
            icon: Clock,
            color: stats.pending > 0 ? 'text-amber-600' : 'text-graphite-400',
            bg:    stats.pending > 0 ? 'bg-amber-50'   : 'bg-ice-50',
            dot:   stats.pending > 0 ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400',
        },
        {
            label: t('intelligence.health.sent24h', { defaultValue: 'Enviadas (24h)' }),
            value: stats.sent24h,
            icon: Check,
            color: 'text-emerald-600',
            bg:    'bg-emerald-50',
            dot:   'bg-emerald-400',
        },
        {
            label: t('intelligence.health.failed24h', { defaultValue: 'Falhas (24h)' }),
            value: stats.failed24h,
            icon: AlertCircle,
            color: stats.failed24h > 0 ? 'text-rose-600'  : 'text-graphite-400',
            bg:    stats.failed24h > 0 ? 'bg-rose-50'     : 'bg-ice-50',
            dot:   stats.failed24h > 0 ? 'bg-rose-500 animate-pulse' : 'bg-emerald-400',
        },
    ];

    const motorOk = !stats.loading && stats.failed24h === 0;

    return (
        <div className="bg-white rounded-3xl shadow-float p-6 space-y-4 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-2">
                    <Activity size={14} className="text-brand-primary" />
                    {t('intelligence.health.title', { defaultValue: 'Saúde do Motor de Notificações' })}
                </h4>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${motorOk ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${motorOk ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
                    {motorOk
                        ? t('intelligence.health.statusOk',    { defaultValue: 'Operacional' })
                        : t('intelligence.health.statusAlert', { defaultValue: 'Atenção' })}
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                {cards.map((card) => {
                    const Icon = card.icon;
                    return (
                        <div key={card.label} className={`${card.bg} rounded-2xl p-4 flex flex-col gap-2`}>
                            <div className="flex items-center justify-between">
                                <Icon size={16} className={card.color} />
                                <span className={`w-1.5 h-1.5 rounded-full ${card.dot}`} />
                            </div>
                            <p className="text-2xl font-black text-graphite-900 tabular-nums">
                                {stats.loading ? '—' : card.value}
                            </p>
                            <p className="text-[9px] font-bold text-graphite-400 uppercase leading-tight">{card.label}</p>
                        </div>
                    );
                })}
            </div>

            {stats.failed24h > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 rounded-xl">
                    <AlertTriangle size={13} className="text-rose-500 flex-shrink-0" />
                    <p className="text-[10px] font-bold text-rose-700">
                        {t('intelligence.health.failureHint', { defaultValue: 'Há falhas de envio nas últimas 24h. Verifique as credenciais de WhatsApp/SMS nas Configurações.' })}
                    </p>
                </div>
            )}

            {/* ── Enviadas × Pendentes por categoria de automação ── */}
            <div className="pt-2 border-t border-ice-100 space-y-3">
                <h4 className="text-[10px] font-black text-graphite-400 uppercase tracking-wider">
                    {t('intelligence.health.byCategory', { defaultValue: 'Mensagens por Automação' })}
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {categoryCards.map((card) => {
                        const Icon = card.icon;
                        const catStats = stats.categories[card.key] ?? { sent: 0, pending: 0 };
                        return (
                            <div key={card.key} className="bg-ice-50 rounded-2xl p-4 space-y-3">
                                <div className="flex items-center gap-1.5">
                                    <Icon size={14} className={card.color} />
                                    <p className="text-[9px] font-black text-graphite-400 uppercase leading-tight">
                                        {card.label}
                                    </p>
                                </div>
                                <div className="flex items-end gap-5">
                                    <div>
                                        <p className="text-xl font-black text-graphite-900 tabular-nums">
                                            {stats.loading ? '—' : catStats.sent}
                                        </p>
                                        <p className="text-[9px] font-bold text-emerald-600 uppercase">
                                            {t('intelligence.health.categorySent', { defaultValue: 'Enviadas' })}
                                        </p>
                                    </div>
                                    <div>
                                        <p className={`text-xl font-black tabular-nums ${catStats.pending > 0 ? 'text-amber-600' : 'text-graphite-300'}`}>
                                            {stats.loading ? '—' : catStats.pending}
                                        </p>
                                        <p className="text-[9px] font-bold text-graphite-400 uppercase">
                                            {t('intelligence.health.categoryPending', { defaultValue: 'Pendentes' })}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const formatOffsetLabel = (offsetMinutes: number, t: any) => {
    const isBefore = offsetMinutes < 0;
    const absMins = Math.abs(offsetMinutes);
    
    let value = absMins;
    let unit = 'minutes';
    
    if (absMins % 1440 === 0) {
        value = absMins / 1440;
        unit = 'days';
    } else if (absMins % 60 === 0) {
        value = absMins / 60;
        unit = 'hours';
    }
    
    const unitStr = t(`intelligence.videoSection.unit${unit.charAt(0).toUpperCase() + unit.slice(1)}${value === 1 ? 'Singular' : 'Plural'}`, { defaultValue: unit === 'days' ? (value === 1 ? 'dia' : 'dias') : unit === 'hours' ? (value === 1 ? 'hora' : 'horas') : (value === 1 ? 'minuto' : 'minutos') });
    const relationStr = t(`intelligence.videoSection.relation${isBefore ? 'Before' : 'After'}`, { defaultValue: isBefore ? 'antes' : 'depois' });
    
    return `${value} ${unitStr} ${relationStr}`;
};

// Ordem e rótulos dos cards da seção Recuperação de Pacientes
const RECOVERY_TEMPLATE_META: { key: string; chip: string; labelKey: string; defaultLabel: string }[] = [
    { key: 'recovery_immediate', chip: 'D0',     labelKey: 'intelligence.recoverySection.cards.immediate', defaultLabel: 'Imediata — logo após a falta' },
    { key: 'recovery_48h',       chip: 'D+2',    labelKey: 'intelligence.recoverySection.cards.after48h',  defaultLabel: '2 dias após a falta' },
    { key: 'recovery_7d',        chip: 'D+7',    labelKey: 'intelligence.recoverySection.cards.after7d',   defaultLabel: '7 dias após a falta' },
    { key: 'recall_immediate',   chip: 'RECALL', labelKey: 'intelligence.recoverySection.cards.recall',    defaultLabel: 'Reativação — retorno do paciente' },
];

// Canais elegíveis como padrão do tenant — mesmas cores da Matriz de Canais
// (MatrixRow) para manter consistência visual entre as duas seções.
const DEFAULT_CHANNEL_OPTIONS: { id: 'whatsapp' | 'sms' | 'email'; label: string; icon: React.ElementType; color: string; bgColor: string }[] = [
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
    { id: 'sms',      label: 'SMS',      icon: Phone,         color: 'text-graphite-600', bgColor: 'bg-ice-100' },
    { id: 'email',    label: 'E-mail',   icon: Mail,          color: 'text-violet-600',   bgColor: 'bg-violet-50' },
];

const DEFAULT_NPS_CAPTIONS = {
    pt: 'Olá {nome}! 😊 Como foi sua experiência na {clínica} hoje?\n\nDe *0 a 10*, o quanto você nos recomendaria? ⭐\n\nSó responda com um número — leva 5 segundos!',
    en: 'Hi {nome}! 😊 How was your experience at {clínica} today?\n\nOn a scale of *0 to 10*, how likely are you to recommend us? ⭐\n\nJust reply with a number — it only takes 5 seconds!',
    es: '¡Hola {nome}! 😊 ¿Cómo fue tu experiencia en {clínica} hoy?\n\nDel *0 al 10*, ¿qué tan probable es que nos recomiendes? ⭐\n\n¡Solo responde con un número — toma 5 segundos!',
};

// Cadência de recuperação do CRM (Faltou → D0/D2/D7) + reativação (recall_due).
// As chaves espelham crm_stage_automations.template_key; os textos são o ponto
// de partida editável — o process-outbound usa bot_config.recovery_captions
// quando presente, senão o template padrão do backend.
export const DEFAULT_RECOVERY_CAPTIONS: Record<string, { pt: string; en: string; es: string }> = {
    recovery_immediate: {
        pt: 'Olá {{nome_paciente}}! 😊 Aqui é a equipe da {{nome_clinica}}. Notamos que você não conseguiu comparecer à sua consulta. Aconteceu algum imprevisto?\n\nSem problemas — podemos remarcar em um horário melhor para você! 📅\n\nÉ só responder *REMARCAR* que cuidamos de tudo.',
        en: 'Hi {{nome_paciente}}! 😊 This is the team at {{nome_clinica}}. We noticed you couldn\'t make it to your appointment. Did something come up?\n\nNo worries — we can reschedule at a better time for you! 📅\n\nJust reply *RESCHEDULE* and we\'ll take care of everything.',
        es: '¡Hola {{nome_paciente}}! 😊 Somos el equipo de {{nome_clinica}}. Notamos que no pudiste asistir a tu cita. ¿Surgió algún imprevisto?\n\nNo hay problema — ¡podemos reagendar en un mejor horario para ti! 📅\n\nSolo responde *REAGENDAR* y nos encargamos de todo.'
    },
    recovery_48h: {
        pt: 'Oi {{nome_paciente}}! Ainda temos horários disponíveis esta semana na {{nome_clinica}}. ✨\n\nQue tal remarcarmos sua consulta? É rapidinho: responda *REMARCAR* que eu encontro o melhor horário para você. 😊',
        en: 'Hi {{nome_paciente}}! We still have openings this week at {{nome_clinica}}. ✨\n\nHow about rescheduling your appointment? It\'s quick: reply *RESCHEDULE* and I\'ll find the best time for you. 😊',
        es: '¡Hola {{nome_paciente}}! Todavía tenemos horarios disponibles esta semana en {{nome_clinica}}. ✨\n\n¿Qué tal si reagendamos tu cita? Es rápido: responde *REAGENDAR* y encuentro el mejor horario para ti. 😊'
    },
    recovery_7d: {
        pt: 'Olá {{nome_paciente}}! Passando uma última vez por aqui. 😊\n\nSua saúde é importante para nós da {{nome_clinica}}. Se quiser remarcar sua consulta, é só responder *REMARCAR*.\n\nSe preferir não receber mais mensagens, responda *SAIR*. 🙏',
        en: 'Hello {{nome_paciente}}! Just checking in one last time. 😊\n\nYour health matters to us at {{nome_clinica}}. If you\'d like to reschedule your appointment, just reply *RESCHEDULE*.\n\nIf you\'d rather not receive more messages, reply *STOP*. 🙏',
        es: '¡Hola {{nome_paciente}}! Paso por aquí una última vez. 😊\n\nTu salud es importante para nosotros en {{nome_clinica}}. Si quieres reagendar tu cita, solo responde *REAGENDAR*.\n\nSi prefieres no recibir más mensajes, responde *SALIR*. 🙏'
    },
    recall_immediate: {
        pt: 'Olá {{nome_paciente}}! 😊 Aqui é a equipe da {{nome_clinica}}. Está chegando a hora do seu retorno!\n\nQue tal agendar sua próxima consulta? Temos horários disponíveis. 📅\n\nResponda *AGENDAR* para ver as opções.',
        en: 'Hi {{nome_paciente}}! 😊 This is the team at {{nome_clinica}}. It\'s time for your follow-up visit!\n\nHow about booking your next appointment? We have openings available. 📅\n\nReply *SCHEDULE* to see the options.',
        es: '¡Hola {{nome_paciente}}! 😊 Somos el equipo de {{nome_clinica}}. ¡Ya es hora de tu visita de seguimiento!\n\n¿Qué tal agendar tu próxima cita? Tenemos horarios disponibles. 📅\n\nResponde *AGENDAR* para ver las opciones.'
    }
};

const AutomationSettings = ({ config, setConfig, onSave, saving }: {
    config: BotConfig,
    setConfig: React.Dispatch<React.SetStateAction<BotConfig>>,
    onSave: () => void,
    saving: boolean
}) => {
    const { t } = useTranslation('tenantAdmin');
    const { showToast } = useToast();

    // Add custom reminder states
    const [isAdding, setIsAdding] = useState(false);
    const [newOffset, setNewOffset] = useState<number>(2);
    const [newUnit, setNewUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
    const [newDirection, setNewDirection] = useState<'before' | 'after'>('before');

    const MAX_REMINDERS = 3;
    const MIN_SPACING_MINUTES = 60;
    const reminderCount = config.custom_reminders?.length || 0;

    // Idioma ativo — fonte de verdade do idioma de ENVIO das mensagens (não há
    // cadastro de idioma por paciente). A seleção aqui é persistida em
    // bot_config.notification_locale e usada pelo motor de notificações para
    // decidir em que idioma cada lembrete/NPS/recall é enviado.
    const [activeLang, setActiveLang] = useState<'pt' | 'en' | 'es'>(() => {
        const saved = localStorage.getItem('intelligence_activeLang');
        return (saved === 'en' || saved === 'es') ? saved : 'pt';
    });
    const handleLangChange = (lang: 'pt' | 'en' | 'es') => {
        setActiveLang(lang);
        localStorage.setItem('intelligence_activeLang', lang);
        setConfig(prev => ({ ...prev, notification_locale: lang }));
    };
    // Sincroniza com o valor salvo no tenant assim que o config carrega do banco
    useEffect(() => {
        if (config.notification_locale && config.notification_locale !== activeLang) {
            setActiveLang(config.notification_locale);
            localStorage.setItem('intelligence_activeLang', config.notification_locale);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.notification_locale]);
    return (
        <div className="bg-white rounded-3xl shadow-float overflow-hidden transition-all duration-300">
            <div className="p-8 space-y-8">
                {/* ── Canal Padrão de Notificação ── */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-ice-50/50 p-6 rounded-3xl shadow-float">
                    <div className="max-w-md">
                        <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-2">
                            <Settings size={14} className="text-brand-primary" />
                            {t('intelligence.defaultChannelSection.title', { defaultValue: 'Canal Padrão de Notificação' })}
                        </h4>
                        <p className="text-[10px] font-bold text-graphite-400 mt-1.5 leading-relaxed">
                            {t('intelligence.defaultChannelSection.hint', { defaultValue: 'Usado sempre que o paciente não tiver um canal definido manualmente no Atendimento. Escolha o canal mais usado pelos seus pacientes nesta região.' })}
                        </p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                        {DEFAULT_CHANNEL_OPTIONS.map((opt) => {
                            const row = config.channel_automations?.[opt.id];
                            const isActiveInMatrix = !!row && Object.values(row).some((v) => v === true);
                            const isSelected = (config.default_notification_channel ?? 'whatsapp') === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    disabled={!isActiveInMatrix}
                                    title={!isActiveInMatrix ? t('intelligence.defaultChannelSection.disabledHint', { defaultValue: 'Ative ao menos uma automação para este canal na matriz abaixo' }) : undefined}
                                    onClick={() => setConfig(prev => ({ ...prev, default_notification_channel: opt.id }))}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-xs font-black transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                        isSelected ? `${opt.bgColor} ${opt.color} border-transparent shadow-sm` : 'bg-white border-ice-200 text-graphite-400 hover:border-ice-300'
                                    }`}
                                >
                                    <opt.icon size={14} />
                                    {opt.label}
                                    {isSelected && <Check size={12} />}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* ── Matriz de Canais e Automações ── */}
                <div className="space-y-5">
                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-2">
                        <Activity size={14} className="text-brand-primary" /> {t('intelligence.matrixSection.title', { defaultValue: 'Matriz de Canais e Automações' })}
                    </h4>

                    <div className="overflow-x-auto shadow-float rounded-2xl bg-ice-50/20">
                        <table className="w-full border-collapse text-left">
                            <thead>
                                <tr className="border-b border-ice-100 bg-ice-50/50">
                                    <th className="p-4 text-[10px] font-black text-graphite-400 uppercase tracking-wider">{t('intelligence.matrixSection.headers.channel', { defaultValue: 'Canal' })}</th>
                                    <th className="p-4 text-[10px] font-black text-graphite-400 uppercase tracking-wider text-center">{t('intelligence.matrixSection.headers.noShow', { defaultValue: 'Prevenção de No-Show' })}</th>
                                    <th className="p-4 text-[10px] font-black text-graphite-400 uppercase tracking-wider text-center">{t('intelligence.matrixSection.headers.videos', { defaultValue: 'Vídeos de Confirmação' })}</th>
                                    <th className="p-4 text-[10px] font-black text-graphite-400 uppercase tracking-wider text-center">{t('intelligence.matrixSection.headers.nps', { defaultValue: 'Pesquisa NPS' })}</th>
                                    <th className="p-4 text-[10px] font-black text-graphite-400 uppercase tracking-wider text-center">{t('intelligence.matrixSection.headers.recovery', { defaultValue: 'Recuperação de Faltas' })}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ice-100 bg-white">
                                <MatrixRow
                                    channelId="whatsapp"
                                    icon={MessageCircle}
                                    color="text-emerald-600"
                                    bgColor="bg-emerald-50"
                                    label="WhatsApp"
                                    config={config}
                                    setConfig={setConfig}
                                    supports={{ no_show: true, videos: true, nps: true, recovery: true }}
                                />
                                <MatrixRow
                                    channelId="sms"
                                    icon={Phone}
                                    color="text-graphite-600"
                                    bgColor="bg-ice-100"
                                    label="SMS"
                                    config={config}
                                    setConfig={setConfig}
                                    supports={{ no_show: true, videos: false, nps: true, recovery: true }}
                                    videoFallbackLabel={t('intelligence.matrixSection.textOnly', { defaultValue: 'Apenas Texto' })}
                                />
                                <MatrixRow
                                    channelId="mms"
                                    icon={Image}
                                    color="text-indigo-600"
                                    bgColor="bg-indigo-50"
                                    label="MMS"
                                    config={config}
                                    setConfig={setConfig}
                                    supports={{ no_show: true, videos: true, nps: true, recovery: false }}
                                />
                                <MatrixRow
                                    channelId="email"
                                    icon={Mail}
                                    color="text-violet-600"
                                    bgColor="bg-violet-50"
                                    label="E-mail"
                                    config={config}
                                    setConfig={setConfig}
                                    supports={{ no_show: true, videos: false, nps: true, recovery: true }}
                                    videoFallbackLabel={t('intelligence.matrixSection.linkOnly', { defaultValue: 'Apenas Link' })}
                                />
                                <MatrixRowMetaDisabled
                                    icon={Instagram}
                                    color="text-pink-500"
                                    bgColor="bg-pink-50"
                                    label="Instagram DM"
                                />
                                <MatrixRowMetaDisabled
                                    icon={Facebook}
                                    color="text-blue-600"
                                    bgColor="bg-blue-50"
                                    label="Facebook Messenger"
                                />
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ── Lembretes Universais ── */}
                {!!(
                    config.channel_automations?.whatsapp?.no_show ||
                    config.channel_automations?.sms?.no_show ||
                    config.channel_automations?.mms?.no_show ||
                    config.channel_automations?.email?.no_show ||
                    config.channel_automations?.whatsapp?.videos ||
                    config.channel_automations?.mms?.videos
                ) && (
                    <div className="space-y-5 bg-indigo-50/30 p-8 rounded-3xl shadow-float animate-in fade-in duration-500">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-200">
                                <Bell size={20} />
                            </div>
                            <div>
                                <h4 className="text-lg font-black text-graphite-900 tracking-tight">{t('intelligence.universalSection.title', { defaultValue: 'Lembretes Universais' })}</h4>
                                <p className="text-[10px] font-bold text-indigo-600 uppercase">{t('intelligence.universalSection.subtitle', { defaultValue: 'Configure mensagens e mídias para seus alertas de presença' })}</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 px-1 py-1">
                            <span className="text-[10px] font-black text-graphite-400 uppercase">{t('intelligence.universalSection.activeChannelsLabel', { defaultValue: 'Canais Ativos:' })}</span>
                            {(config.channel_automations?.whatsapp?.no_show || config.channel_automations?.whatsapp?.videos) && (
                                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] font-bold border border-emerald-100 flex items-center gap-1.5 shadow-sm">
                                    <MessageCircle size={12} /> WhatsApp
                                </span>
                            )}
                            {(config.channel_automations?.sms?.no_show) && (
                                <span className="px-2.5 py-1 bg-ice-50 text-graphite-700 rounded-lg text-[10px] font-bold border border-ice-100 flex items-center gap-1.5 shadow-sm">
                                    <Phone size={12} /> SMS
                                </span>
                            )}
                            {(config.channel_automations?.mms?.no_show || config.channel_automations?.mms?.videos) && (
                                <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] font-bold border border-indigo-100 flex items-center gap-1.5 shadow-sm">
                                    <Image size={12} /> MMS
                                </span>
                            )}
                            {(config.channel_automations?.email?.no_show) && (
                                <span className="px-2.5 py-1 bg-violet-50 text-violet-700 rounded-lg text-[10px] font-bold border border-violet-100 flex items-center gap-1.5 shadow-sm">
                                    <Mail size={12} /> E-mail
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
                            {(config.custom_reminders || []).map((reminder) => {
                                return (
                                    <UniversalReminderCard
                                        key={reminder.id}
                                        offsetMinutes={reminder.offset_minutes}
                                        onOffsetChange={(newMins) => {
                                            setConfig(prev => ({
                                                ...prev,
                                                custom_reminders: prev.custom_reminders?.map(r =>
                                                    r.id === reminder.id ? { ...r, offset_minutes: newMins } : r
                                                )
                                            }));
                                        }}
                                        enabled={reminder.enabled}
                                        onToggle={() => {
                                            setConfig(prev => ({
                                                ...prev,
                                                custom_reminders: prev.custom_reminders?.map(r =>
                                                    r.id === reminder.id ? { ...r, enabled: !r.enabled } : r
                                                )
                                            }));
                                        }}
                                        videoUrl={reminder.videoUrl}
                                        caption={reminder.caption}
                                        onVideoChange={(url) => {
                                            setConfig(prev => ({
                                                ...prev,
                                                custom_reminders: prev.custom_reminders?.map(r =>
                                                    r.id === reminder.id ? { ...r, videoUrl: url } : r
                                                )
                                            }));
                                        }}
                                        onCaptionChange={(captionRecord) => {
                                            setConfig(prev => ({
                                                ...prev,
                                                custom_reminders: prev.custom_reminders?.map(r =>
                                                    r.id === reminder.id ? { ...r, caption: captionRecord } : r
                                                )
                                            }));
                                        }}
                                        onDelete={() => {
                                            setConfig(prev => ({
                                                ...prev,
                                                custom_reminders: prev.custom_reminders?.filter(r => r.id !== reminder.id)
                                            }));
                                        }}
                                        activeLang={activeLang}
                                        onLangChange={handleLangChange}
                                    />
                                );
                            })}

                            {/* Inline Add Reminder Card */}
                            {isAdding ? (
                                <div className="p-5 rounded-2xl border border-dashed border-indigo-300 bg-indigo-50/20 flex flex-col justify-between space-y-4">
                                    <div className="space-y-4">
                                        <h5 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">
                                            {t('intelligence.universalSection.newReminder', { defaultValue: 'Novo Lembrete' })}
                                        </h5>
                                        
                                        <div className="grid grid-cols-3 gap-2">
                                            <div>
                                                <label className="text-[9px] font-black text-graphite-400 uppercase">
                                                    {t('intelligence.universalSection.timeLabel', { defaultValue: 'Tempo' })}
                                                </label>
                                                <input 
                                                    type="number" 
                                                    min="1"
                                                    value={newOffset}
                                                    onChange={(e) => setNewOffset(Math.max(1, parseInt(e.target.value) || 1))}
                                                    className="w-full bg-white border border-transparent shadow-float rounded-xl p-2 text-xs font-bold outline-none focus:border-indigo-500"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-black text-graphite-400 uppercase">
                                                    {t('intelligence.universalSection.unitLabel', { defaultValue: 'Unidade' })}
                                                </label>
                                                <select
                                                    value={newUnit}
                                                    onChange={(e) => setNewUnit(e.target.value as any)}
                                                    className="w-full bg-white border border-transparent shadow-float rounded-xl p-2 text-xs font-bold outline-none focus:border-indigo-500 cursor-pointer"
                                                >
                                                    <option value="minutes">{t('intelligence.universalSection.minutesUnit', { defaultValue: 'Minutos' })}</option>
                                                    <option value="hours">{t('intelligence.universalSection.hoursUnit', { defaultValue: 'Horas' })}</option>
                                                    <option value="days">{t('intelligence.universalSection.daysUnit', { defaultValue: 'Dias' })}</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-black text-graphite-400 uppercase">
                                                    {t('intelligence.universalSection.relationLabel', { defaultValue: 'Relação' })}
                                                </label>
                                                <select
                                                    value={newDirection}
                                                    onChange={(e) => setNewDirection(e.target.value as any)}
                                                    className="w-full bg-white border border-transparent shadow-float rounded-xl p-2 text-xs font-bold outline-none focus:border-indigo-500 cursor-pointer"
                                                >
                                                    <option value="before">{t('intelligence.universalSection.beforeRelation', { defaultValue: 'Antes' })}</option>
                                                    <option value="after">{t('intelligence.universalSection.afterRelation', { defaultValue: 'Depois' })}</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="flex gap-2 justify-end pt-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsAdding(false)}
                                            className="px-3 py-1.5 bg-ice-100 hover:bg-ice-200 text-graphite-600 rounded-xl text-xs font-bold border-none cursor-pointer transition-colors"
                                        >
                                            {t('intelligence.universalSection.cancelButton', { defaultValue: 'Cancelar' })}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                let multiplier = 1;
                                                if (newUnit === 'hours') multiplier = 60;
                                                if (newUnit === 'days') multiplier = 1440;
                                                const offsetMinutes = newOffset * multiplier * (newDirection === 'before' ? -1 : 1);

                                                const tooClose = (config.custom_reminders || []).some(
                                                    r => Math.abs(r.offset_minutes - offsetMinutes) < MIN_SPACING_MINUTES
                                                );
                                                if (tooClose) {
                                                    showToast('error', t('intelligence.universalSection.reminderTooClose', {
                                                        minutes: MIN_SPACING_MINUTES,
                                                        defaultValue: `Esse lembrete está muito próximo de outro já configurado. Mantenha pelo menos ${MIN_SPACING_MINUTES} minutos de intervalo entre lembretes.`
                                                    }));
                                                    return;
                                                }

                                                const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9);
                                                
                                                const captionTextPt = `Lembrete: Seu agendamento é em ${newOffset} ${newUnit === 'days' ? 'dias' : newUnit === 'hours' ? 'horas' : 'minutos'}.`;
                                                const captionTextEn = `Reminder: Your appointment is in ${newOffset} ${newUnit === 'days' ? 'days' : newUnit === 'hours' ? 'hours' : 'minutes'}.`;
                                                const captionTextEs = `Recordatorio: Tu cita es en ${newOffset} ${newUnit === 'days' ? 'días' : newUnit === 'hours' ? 'horas' : 'minutos'}.`;

                                                const newReminder = {
                                                    id,
                                                    offset_minutes: offsetMinutes,
                                                    type: 'no_show' as const,
                                                    videoUrl: null,
                                                    caption: {
                                                        pt: captionTextPt,
                                                        en: captionTextEn,
                                                        es: captionTextEs
                                                    },
                                                    enabled: true
                                                };
                                                
                                                setConfig(prev => ({
                                                    ...prev,
                                                    custom_reminders: [...(prev.custom_reminders || []), newReminder]
                                                }));
                                                setIsAdding(false);
                                            }}
                                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold border-none cursor-pointer transition-colors"
                                        >
                                            {t('intelligence.universalSection.addReminder', { defaultValue: 'Adicionar' })}
                                        </button>
                                    </div>
                                </div>
                            ) : reminderCount < MAX_REMINDERS ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setNewOffset(2);
                                        setNewUnit('hours');
                                        setNewDirection('before');
                                        setIsAdding(true);
                                    }}
                                    className="flex flex-col items-center justify-center p-5 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/5 hover:bg-indigo-50/20 transition-all cursor-pointer group text-indigo-500 font-bold gap-2 min-h-[160px]"
                                >
                                    <span className="p-2 bg-indigo-100 text-indigo-600 rounded-full group-hover:scale-110 transition-transform">
                                        <Plus size={20} />
                                    </span>
                                    <span className="text-[10px] font-black uppercase tracking-wider">
                                        {t('intelligence.universalSection.addReminder', { defaultValue: 'Adicionar Lembrete' })}
                                    </span>
                                    <span className="text-[9px] font-bold text-indigo-300">
                                        {reminderCount}/{MAX_REMINDERS}
                                    </span>
                                </button>
                            ) : (
                                <div className="flex flex-col items-center justify-center p-5 rounded-2xl border border-dashed border-ice-200 bg-ice-50/30 text-graphite-400 font-bold gap-2 min-h-[160px] text-center">
                                    <Check size={20} className="text-ice-300" />
                                    <span className="text-[10px] font-black uppercase tracking-wider">
                                        {t('intelligence.universalSection.maxRemindersReached', { defaultValue: 'Limite de 3 lembretes atingido' })}
                                    </span>
                                    <span className="text-[9px] font-medium text-graphite-300 leading-relaxed px-2">
                                        {t('intelligence.universalSection.maxRemindersHint', { defaultValue: 'Remova um lembrete existente para adicionar outro' })}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="space-y-5 bg-blue-50/30 p-8 rounded-3xl shadow-float animate-in fade-in duration-500">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-200">
                            <MessageSquare size={20} />
                        </div>
                        <div>
                            <h4 className="text-lg font-black text-graphite-900 tracking-tight">{t('intelligence.bookingSection.title', { defaultValue: 'Confirmação de Agendamento' })}</h4>
                            <p className="text-[10px] font-bold text-blue-600 uppercase">{t('intelligence.bookingSection.subtitle', { defaultValue: 'Enviada no momento em que o agendamento é realizado no atendimento' })}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <p className="text-xs font-bold text-graphite-600 leading-relaxed">
                                {t('intelligence.bookingSection.description', { defaultValue: 'Personalize a mensagem automática que o paciente receberá ao ser agendado. Você pode traduzir e ajustar a mensagem para cada idioma que sua clínica atende.' })}
                            </p>
                            <div className="p-4 bg-blue-55 rounded-2xl flex items-start gap-2 border border-blue-100/50 bg-blue-50/50">
                                <AlertTriangle size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
                                <p className="text-[10px] font-bold text-blue-800 leading-relaxed">
                                    {t('intelligence.bookingSection.varsHintText', { defaultValue: 'Use as variáveis ao lado para preencher dados como nome do paciente, data, local e links automaticamente. Clique para inserir no final da mensagem.' })}
                                </p>
                            </div>
                        </div>

                        <div className="bg-white/80 rounded-2xl p-4 shadow-float space-y-3">
                            <div className="flex items-center justify-between">
                                <p className="text-[9px] font-black text-graphite-400 uppercase">
                                    {t('intelligence.bookingSection.messageLabel', { defaultValue: 'Mensagem Personalizada' })}
                                </p>
                                <div className="flex bg-ice-100 p-0.5 rounded-lg gap-0.5">
                                    {(['pt', 'en', 'es'] as const).map(lang => (
                                        <button
                                            key={lang}
                                            type="button"
                                            onClick={() => handleLangChange(lang)}
                                            className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase transition-all ${activeLang === lang ? 'bg-white shadow-sm text-graphite-900' : 'text-graphite-400 hover:text-graphite-700'}`}
                                        >
                                            {lang}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <textarea
                                value={config.booking_confirmation_captions?.[activeLang] ?? DEFAULT_BOOKING_CAPTIONS[activeLang]}
                                onChange={(e) => setConfig(prev => ({
                                    ...prev,
                                    booking_confirmation_captions: {
                                        ...(prev.booking_confirmation_captions ?? DEFAULT_BOOKING_CAPTIONS),
                                        [activeLang]: e.target.value
                                    }
                                }))}
                                rows={8}
                                className="w-full bg-blue-50/50 rounded-xl p-3 text-xs font-medium text-graphite-700 leading-relaxed border border-blue-100/50 outline-none focus:border-blue-300 resize-none transition-colors"
                            />
                            <div className="flex flex-wrap gap-1.5 pt-1">
                                {TEMPLATE_VARIABLES.map((v) => (
                                    <button
                                        key={v.placeholder}
                                        type="button"
                                        onClick={() => {
                                            const currentText = config.booking_confirmation_captions?.[activeLang] ?? DEFAULT_BOOKING_CAPTIONS[activeLang];
                                            const updatedText = currentText + v.placeholder;
                                            setConfig(prev => ({
                                                ...prev,
                                                booking_confirmation_captions: {
                                                    ...(prev.booking_confirmation_captions ?? DEFAULT_BOOKING_CAPTIONS),
                                                    [activeLang]: updatedText
                                                }
                                            }));
                                        }}
                                        className="px-1.5 py-0.5 text-[8px] font-mono font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border-none cursor-pointer transition-colors"
                                        title={v.label}
                                    >
                                        {v.placeholder}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-white/50 rounded-2xl shadow-float flex items-center gap-3">
                    <AlertTriangle size={16} className="text-indigo-500 flex-shrink-0" />
                    <p className="text-xs font-bold text-indigo-800 leading-relaxed">
                        {t('intelligence.universalSection.infoBanner')}
                    </p>
                </div>

                {/* ── Config NPS ── */}
                {!!(
                    config.channel_automations?.whatsapp?.nps ||
                    config.channel_automations?.sms?.nps ||
                    config.channel_automations?.email?.nps
                ) && (
                    <div className="space-y-5 bg-amber-50/30 p-8 rounded-3xl shadow-float animate-in fade-in duration-500">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-amber-500 text-white rounded-xl shadow-lg shadow-amber-200">
                                <Star size={20} />
                            </div>
                            <div>
                                <h4 className="text-lg font-black text-graphite-900 tracking-tight">{t('intelligence.npsSection.title', { defaultValue: 'Pesquisa NPS — Pós-Consulta' })}</h4>
                                <p className="text-[10px] font-bold text-amber-600 uppercase">{t('intelligence.npsSection.subtitle', { defaultValue: 'Disparada automaticamente após o agendamento ser marcado como "realizado"' })}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-graphite-400 uppercase">{t('intelligence.npsSection.delayLabel', { defaultValue: 'Enviar NPS após' })}</label>
                                <NpsDelayEditor
                                    minutes={config.nps_delay_minutes ?? 180}
                                    onChange={(mins) => setConfig(prev => ({ ...prev, nps_delay_minutes: mins }))}
                                />
                                <p className="text-[9px] font-medium text-graphite-400 leading-relaxed">
                                    {t('intelligence.npsSection.delayHint', { defaultValue: 'A mensagem é enviada automaticamente quando a recepção marca o agendamento como "realizado". Horário de silêncio (22h–8h) é sempre respeitado.' })}
                                </p>
                            </div>

                            <div className="bg-white/80 rounded-2xl p-4 shadow-float space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-[9px] font-black text-graphite-400 uppercase">
                                        {t('intelligence.npsSection.messageLabel', { defaultValue: 'Mensagem Personalizada' })}
                                    </p>
                                    <div className="flex bg-ice-100 p-0.5 rounded-lg gap-0.5">
                                        {(['pt', 'en', 'es'] as const).map(lang => (
                                            <button
                                                key={lang}
                                                type="button"
                                                onClick={() => handleLangChange(lang)}
                                                className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase transition-all ${activeLang === lang ? 'bg-white shadow-sm text-graphite-900' : 'text-graphite-400 hover:text-graphite-700'}`}
                                            >
                                                {lang}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <textarea
                                    value={config.nps_captions?.[activeLang] ?? DEFAULT_NPS_CAPTIONS[activeLang]}
                                    onChange={(e) => setConfig(prev => ({
                                        ...prev,
                                        nps_captions: {
                                            ...(prev.nps_captions ?? DEFAULT_NPS_CAPTIONS),
                                            [activeLang]: e.target.value
                                        }
                                    }))}
                                    rows={6}
                                    className="w-full bg-emerald-50 rounded-xl p-3 text-xs font-medium text-graphite-700 leading-relaxed border border-emerald-100 outline-none focus:border-emerald-300 resize-none transition-colors"
                                />
                                <p className="text-[9px] font-medium text-graphite-400">
                                    {t('intelligence.npsSection.variablesHint', { defaultValue: 'Variáveis disponíveis:' })}{' '}
                                    <span className="font-mono bg-ice-100 px-1 py-0.5 rounded text-graphite-600">{'{nome}'}</span>{' '}
                                    <span className="font-mono bg-ice-100 px-1 py-0.5 rounded text-graphite-600">{'{clínica}'}</span>
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Recuperação de Pacientes (Faltas — cadência D0/D2/D7 + Recall) ── */}
                {!!(
                    config.channel_automations?.whatsapp?.recovery ||
                    config.channel_automations?.sms?.recovery ||
                    config.channel_automations?.email?.recovery
                ) && (
                    <div className="space-y-5 bg-rose-50/30 p-8 rounded-3xl shadow-float animate-in fade-in duration-500">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-rose-500 text-white rounded-xl shadow-lg shadow-rose-200">
                                    <Clock size={20} />
                                </div>
                                <div>
                                    <h4 className="text-lg font-black text-graphite-900 tracking-tight">{t('intelligence.recoverySection.title', { defaultValue: 'Recuperação de Pacientes' })}</h4>
                                    <p className="text-[10px] font-bold text-rose-600 uppercase">{t('intelligence.recoverySection.subtitle', { defaultValue: 'Cadência automática após falta (imediata, 2 dias, 7 dias) e reativação de retorno' })}</p>
                                </div>
                            </div>

                            {/* Idioma padrão de ENVIO das mensagens (bot_config.notification_locale) */}
                            <div className="flex items-center gap-3 bg-white/70 px-4 py-2.5 rounded-2xl shadow-float">
                                <p className="text-[10px] font-black text-graphite-400 uppercase">
                                    {t('intelligence.recoverySection.defaultLangLabel', { defaultValue: 'Idioma padrão de envio' })}
                                </p>
                                <div className="flex bg-ice-100 p-0.5 rounded-lg gap-0.5">
                                    {(['pt', 'en', 'es'] as const).map(lang => (
                                        <button
                                            key={lang}
                                            type="button"
                                            onClick={() => handleLangChange(lang)}
                                            className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase transition-all border-none cursor-pointer ${activeLang === lang ? 'bg-white shadow-sm text-graphite-900' : 'bg-transparent text-graphite-400 hover:text-graphite-700'}`}
                                        >
                                            {lang}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="p-4 bg-rose-50/60 rounded-2xl flex items-start gap-2">
                            <AlertTriangle size={13} className="text-rose-500 flex-shrink-0 mt-0.5" />
                            <p className="text-[10px] font-bold text-rose-800 leading-relaxed">
                                {t('intelligence.recoverySection.hint', { defaultValue: 'Disparada quando o paciente falta à consulta (cartão movido para "Faltou" no CRM). A cadência para automaticamente se o paciente responder, agendar ou pagar. O idioma selecionado acima é o usado no envio de todas as mensagens automáticas.' })}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {RECOVERY_TEMPLATE_META.map(({ key, chip, labelKey, defaultLabel }) => (
                                <div key={key} className="bg-white/80 rounded-2xl p-4 shadow-float space-y-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[9px] font-black text-graphite-400 uppercase">
                                            {t(labelKey, { defaultValue: defaultLabel })}
                                        </p>
                                        <span className="px-2 py-0.5 bg-rose-50 text-rose-600 rounded-lg text-[9px] font-black uppercase border border-rose-100">
                                            {chip}
                                        </span>
                                    </div>
                                    <textarea
                                        value={config.recovery_captions?.[key]?.[activeLang] ?? DEFAULT_RECOVERY_CAPTIONS[key][activeLang]}
                                        onChange={(e) => setConfig(prev => ({
                                            ...prev,
                                            recovery_captions: {
                                                ...(prev.recovery_captions ?? DEFAULT_RECOVERY_CAPTIONS),
                                                [key]: {
                                                    ...(prev.recovery_captions?.[key] ?? DEFAULT_RECOVERY_CAPTIONS[key]),
                                                    [activeLang]: e.target.value
                                                }
                                            }
                                        }))}
                                        rows={6}
                                        className="w-full bg-rose-50/40 rounded-xl p-3 text-xs font-medium text-graphite-700 leading-relaxed border border-rose-100/50 outline-none focus:border-rose-300 resize-none transition-colors"
                                    />
                                    <p className="text-[9px] font-medium text-graphite-400">
                                        {t('intelligence.recoverySection.variablesHint', { defaultValue: 'Variáveis disponíveis:' })}{' '}
                                        <span className="font-mono bg-ice-100 px-1 py-0.5 rounded text-graphite-600">{'{{nome_paciente}}'}</span>{' '}
                                        <span className="font-mono bg-ice-100 px-1 py-0.5 rounded text-graphite-600">{'{{nome_clinica}}'}</span>{' '}
                                        <span className="font-mono bg-ice-100 px-1 py-0.5 rounded text-graphite-600">{'{{nome_procedimento}}'}</span>
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Config Recall ── */}
                <div className="space-y-5 bg-ice-50/30 p-8 rounded-3xl shadow-float">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 text-white rounded-xl shadow-lg ${config.recall_enabled ? 'bg-indigo-500 shadow-indigo-200' : 'bg-graphite-300 shadow-ice-200'}`}>
                                <Bell size={20} />
                            </div>
                            <div>
                                <h4 className="text-lg font-black text-graphite-900 tracking-tight">{t('intelligence.recallSection.title', { defaultValue: 'Reativação de Pacientes' })}</h4>
                                <p className="text-[10px] font-bold text-graphite-400 uppercase">{t('intelligence.recallSection.subtitle', { defaultValue: 'Mensagem automática para pacientes sem retorno' })}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setConfig(prev => ({ ...prev, recall_enabled: !prev.recall_enabled }))}
                            className={`relative w-12 h-6 rounded-full transition-all border-none cursor-pointer flex-shrink-0 ${config.recall_enabled ? 'bg-indigo-500' : 'bg-ice-200'}`}
                        >
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${config.recall_enabled ? 'left-6' : 'left-0.5'}`} />
                        </button>
                    </div>

                    {config.recall_enabled && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-graphite-400 uppercase">{t('intelligence.recallSection.daysLabel', { defaultValue: 'Disparar recall após' })}</label>
                                <div className="flex items-center gap-3">
                                    <select
                                        value={config.recall_days ?? 180}
                                        onChange={(e) => setConfig(prev => ({ ...prev, recall_days: parseInt(e.target.value) }))}
                                        className="bg-white border border-transparent shadow-float rounded-xl px-3 py-2 text-sm font-bold text-graphite-700 outline-none focus:border-indigo-500 cursor-pointer"
                                    >
                                        <option value={30}>30 {t('intelligence.recallSection.days', { defaultValue: 'dias' })}</option>
                                        <option value={60}>60 {t('intelligence.recallSection.days', { defaultValue: 'dias' })}</option>
                                        <option value={90}>90 {t('intelligence.recallSection.days', { defaultValue: 'dias' })}</option>
                                        <option value={180}>180 {t('intelligence.recallSection.days', { defaultValue: 'dias' })} (6 {t('intelligence.recallSection.months', { defaultValue: 'meses' })})</option>
                                        <option value={365}>365 {t('intelligence.recallSection.days', { defaultValue: 'dias' })} (1 {t('intelligence.recallSection.year', { defaultValue: 'ano' })})</option>
                                    </select>
                                    <p className="text-[10px] font-medium text-graphite-400">
                                        {t('intelligence.recallSection.daysHint', { defaultValue: 'sem visita registrada no sistema' })}
                                    </p>
                                </div>
                            </div>

                            <div className="p-4 bg-indigo-50/60 rounded-2xl flex items-start gap-2">
                                <AlertTriangle size={13} className="text-indigo-500 flex-shrink-0 mt-0.5" />
                                <p className="text-[10px] font-bold text-indigo-800 leading-relaxed">
                                    {t('intelligence.recallSection.hint', { defaultValue: 'O recall é enviado uma vez por período. O sistema aguarda metade do período configurado antes de reenviar para o mesmo paciente.' })}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Salvar ── */}
                <div className="flex flex-col md:flex-row items-center justify-end gap-6 pt-8 border-t border-ice-100">
                    <button
                        onClick={() => onSave()}
                        disabled={saving}
                        className="w-full md:w-auto flex items-center justify-center gap-2 bg-brand-primary text-white px-10 py-4 rounded-2xl font-black shadow-xl shadow-brand-primary/20 hover:scale-105 active:scale-95 transition-all border-none cursor-pointer disabled:opacity-50"
                    >
                        {saving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                        {t('intelligence.saveButton')}
                    </button>
                </div>
            </div>
        </div>
    );
};

const NpsDelayEditor = ({ minutes, onChange }: { minutes: number; onChange: (mins: number) => void }) => {
    const { t } = useTranslation('tenantAdmin');
    let value = minutes;
    let unit: 'minutes' | 'hours' | 'days' = 'minutes';
    if (minutes % 1440 === 0)      { value = minutes / 1440; unit = 'days'; }
    else if (minutes % 60 === 0)   { value = minutes / 60;   unit = 'hours'; }

    const toMinutes = (v: number, u: 'minutes' | 'hours' | 'days') =>
        u === 'days' ? v * 1440 : u === 'hours' ? v * 60 : v;

    return (
        <div className="flex items-center gap-2">
            <input
                type="number"
                min="1"
                value={value}
                onChange={(e) => onChange(toMinutes(Math.max(1, parseInt(e.target.value) || 1), unit))}
                className="w-16 bg-white border border-transparent shadow-float rounded-xl px-3 py-2 text-sm font-bold text-graphite-700 outline-none focus:border-amber-500 text-center"
            />
            <select
                value={unit}
                onChange={(e) => onChange(toMinutes(value, e.target.value as 'minutes' | 'hours' | 'days'))}
                className="bg-white border border-transparent shadow-float rounded-xl px-3 py-2 text-sm font-bold text-graphite-700 outline-none focus:border-amber-500 cursor-pointer"
            >
                <option value="minutes">{t('intelligence.npsSection.unitMinutes', { defaultValue: 'minutos' })}</option>
                <option value="hours">{t('intelligence.npsSection.unitHours', { defaultValue: 'horas' })}</option>
                <option value="days">{t('intelligence.npsSection.unitDays', { defaultValue: 'dias' })}</option>
            </select>
            <span className="text-xs font-medium text-graphite-400">
                {t('intelligence.npsSection.afterCompletion', { defaultValue: 'após conclusão da consulta' })}
            </span>
        </div>
    );
};

const DurationEditor = ({ offsetMinutes, onChange }: { offsetMinutes: number; onChange: (mins: number) => void }) => {
    const isBefore = offsetMinutes < 0;
    const absMins = Math.abs(offsetMinutes);
    
    let value = absMins;
    let unit: 'minutes' | 'hours' | 'days' = 'minutes';
    
    if (absMins % 1440 === 0) {
        value = absMins / 1440;
        unit = 'days';
    } else if (absMins % 60 === 0) {
        value = absMins / 60;
        unit = 'hours';
    }
    
    const handleValueChange = (newVal: number) => {
        let multiplier = 1;
        if (unit === 'hours') multiplier = 60;
        if (unit === 'days') multiplier = 1440;
        onChange(newVal * multiplier * (isBefore ? -1 : 1));
    };

    const handleUnitChange = (newUnit: 'minutes' | 'hours' | 'days') => {
        let multiplier = 1;
        if (newUnit === 'hours') multiplier = 60;
        if (newUnit === 'days') multiplier = 1440;
        onChange(value * multiplier * (isBefore ? -1 : 1));
    };

    const handleDirectionChange = (newDir: 'before' | 'after') => {
        let multiplier = 1;
        if (unit === 'hours') multiplier = 60;
        if (unit === 'days') multiplier = 1440;
        onChange(value * multiplier * (newDir === 'before' ? -1 : 1));
    };

    return (
        <div className="flex items-center gap-1 bg-ice-50/50 hover:bg-ice-50 px-2.5 py-1 rounded-xl shadow-float transition-all select-none">
            <input 
                type="number"
                min="1"
                value={value}
                onChange={(e) => handleValueChange(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-8 bg-transparent text-[10px] font-black text-graphite-700 outline-none text-center border-none p-0"
            />
            <select
                value={unit}
                onChange={(e) => handleUnitChange(e.target.value as any)}
                className="bg-transparent text-[10px] font-bold text-graphite-500 border-none outline-none cursor-pointer p-0 pr-1"
            >
                <option value="minutes">min</option>
                <option value="hours">h</option>
                <option value="days">d</option>
            </select>
            <select
                value={isBefore ? 'before' : 'after'}
                onChange={(e) => handleDirectionChange(e.target.value as any)}
                className="bg-transparent text-[10px] font-bold text-graphite-500 border-none outline-none cursor-pointer p-0"
            >
                <option value="before">antes</option>
                <option value="after">depois</option>
            </select>
        </div>
    );
};

const TEMPLATE_VARIABLES = [
    { placeholder: '{{nome_paciente}}',        label: 'Nome do Paciente',          example: 'Maria Silva' },
    { placeholder: '{{data_agendamento}}',     label: 'Data da Consulta',           example: '30/06/2026' },
    { placeholder: '{{horario_agendamento}}',  label: 'Horário da Consulta',        example: '10:00' },
    { placeholder: '{{nome_do_profissional}}', label: 'Nome do Profissional',       example: 'Dr. João Costa' },
    { placeholder: '{{nome_procedimento}}',    label: 'Tipo de Procedimento',       example: 'Consulta de Retorno' },
    { placeholder: '{{nome_local}}',           label: 'Unidade / Local',            example: 'Clínica Central' },
    { placeholder: '{{link_endereco}}',        label: 'Link Google Maps',           example: 'maps.google.com/...' },
    { placeholder: '{{link_sala_espera}}',     label: 'Sala de Espera Virtual',     example: 'traffio.app/checkin?apt=...&loc=...' },
    { placeholder: '{{link_checkin}}',         label: 'Link Check-in Express',      example: 'traffio.app/checkin' },
    { placeholder: '{{nome_clinica}}',         label: 'Nome da Clínica',            example: 'Clínica Exemplo' },
    { placeholder: '{{link_pagamento}}',       label: 'Link de Pagamento',          example: 'checkout.traffio.com/pay/...' },
] as const;

const UniversalReminderCard = ({ offsetMinutes, onOffsetChange, enabled, onToggle, videoUrl, caption, onVideoChange, onCaptionChange, onDelete, activeLang, onLangChange }: {
    offsetMinutes: number;
    onOffsetChange: (mins: number) => void;
    enabled: boolean;
    onToggle: () => void;
    videoUrl: string | null;
    caption: Record<string, string>;
    onVideoChange: (url: string | null) => void;
    onCaptionChange: (captionRecord: Record<string, string>) => void;
    onDelete?: () => void;
    activeLang: 'pt' | 'en' | 'es';
    onLangChange: (lang: 'pt' | 'en' | 'es') => void;
}) => {
    const { t } = useTranslation('tenantAdmin');
    const [uploading, setUploading] = useState(false);
    const { tenant } = useTenant();
    const { showToast } = useToast();
    const [showVarsPanel, setShowVarsPanel] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const insertVariable = (placeholder: string) => {
        const el = textareaRef.current;
        const current = caption[activeLang] || '';
        const start = el?.selectionStart ?? current.length;
        const end   = el?.selectionEnd   ?? current.length;
        const newValue = current.slice(0, start) + placeholder + current.slice(end);
        onCaptionChange({ ...caption, [activeLang]: newValue });
        setShowVarsPanel(false);
        setTimeout(() => {
            el?.focus();
            el?.setSelectionRange(start + placeholder.length, start + placeholder.length);
        }, 0);
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !tenant?.id) return;

        if (file.size > 16 * 1024 * 1024) {
            showToast('error', t('intelligence.toasts.videoTooLarge'));
            return;
        }

        setUploading(true);
        try {
            const fileName = `${tenant.id}/video-reminders/${Date.now()}-${file.name}`;
            const { error: uploadError } = await supabase.storage
                .from('chat-media')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('chat-media')
                .getPublicUrl(fileName);

            onVideoChange(publicUrl);
            showToast('success', t('intelligence.toasts.videoUploaded'));
        } catch (error: any) {
            console.error('Error uploading video:', error);
            showToast('error', t('intelligence.toasts.videoUploadError'));
        } finally {
            setUploading(false);
        }
    };

    const languages: { code: 'pt' | 'en' | 'es'; label: string }[] = [
        { code: 'pt', label: 'PT' },
        { code: 'en', label: 'EN' },
        { code: 'es', label: 'ES' }
    ];

    return (
        <div className={`p-5 rounded-2xl transition-all group/card ${enabled ? 'bg-white/40 shadow-float' : 'bg-ice-100/30 opacity-60'}`}>
            <div className="flex items-center justify-between mb-4">
                <DurationEditor offsetMinutes={offsetMinutes} onChange={onOffsetChange} />
                <div className="flex items-center gap-2">
                    {onDelete && (
                        <button
                            onClick={onDelete}
                            className="p-1 hover:bg-rose-50 text-rose-500 rounded-lg transition-all border-none bg-transparent cursor-pointer"
                            title={t('intelligence.universalSection.deleteButton', { defaultValue: 'Excluir lembrete' })}
                        >
                            <Trash2 size={13} />
                        </button>
                    )}
                    <button
                        onClick={onToggle}
                        className={`relative w-8 h-4 rounded-full transition-all border-none cursor-pointer flex-shrink-0 ${enabled ? 'bg-indigo-500' : 'bg-ice-300'}`}
                    >
                        <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all ${enabled ? 'left-4.5' : 'left-0.5'}`} />
                    </button>
                </div>
            </div>
            
            <div className={`grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-4 ${!enabled && 'pointer-events-none'}`}>
                {/* Video Area */}
                <div className="flex flex-col space-y-1.5">
                    <label className="text-[8px] font-black text-graphite-400 uppercase tracking-wider">
                        {t('intelligence.universalSection.mediaLabel', { defaultValue: 'Mídia (Opcional - WhatsApp/MMS)' })}
                    </label>
                    <div className="relative aspect-[9/16] w-full rounded-xl overflow-hidden bg-graphite-900 shadow-lg group">
                        {videoUrl ? (
                            <>
                                <video src={videoUrl} className="w-full h-full object-cover" muted autoPlay loop />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-end pb-3">
                                    <button 
                                        onClick={() => onVideoChange(null)}
                                        className="bg-rose-500 text-white p-2 rounded-full shadow-lg border-none cursor-pointer hover:scale-110 transition-transform"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </>
                        ) : (
                            <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer hover:bg-white/10 transition-all group/upload">
                                {uploading ? (
                                    <Loader2 size={20} className="text-brand-primary animate-spin" />
                                ) : (
                                    <>
                                        <div className="p-2 bg-indigo-500/10 rounded-full text-indigo-400 group-hover/upload:bg-indigo-500 group-hover/upload:text-white transition-all">
                                            <Upload size={18} />
                                        </div>
                                        <span className="text-[8px] font-black text-indigo-400 uppercase mt-2">{t('intelligence.videoSection.uploadLabel')}</span>
                                    </>
                                )}
                                <input type="file" accept="video/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                            </label>
                        )}
                    </div>
                </div>

                {/* Text Area */}
                <div className="flex flex-col space-y-2 flex-1">
                    <div className="flex items-center justify-between">
                        <label className="text-[8px] font-black text-graphite-400 uppercase tracking-wider flex items-center gap-1">
                            <MessageSquare size={10} className="text-indigo-500" />
                            {t('intelligence.universalSection.textLabel', { defaultValue: 'Mensagem (Todos os canais)' })}
                        </label>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setShowVarsPanel(true)}
                                className="flex items-center gap-1 px-2 py-1 text-[9px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-all border-none cursor-pointer"
                            >
                                <Code2 size={10} />
                                {t('intelligence.universalSection.variablesButton', { defaultValue: 'Variáveis' })}
                            </button>
                            <div className="flex bg-ice-100 p-0.5 rounded-lg shadow-float">
                                {languages.map((lang) => (
                                    <button
                                        key={lang.code}
                                        type="button"
                                        onClick={() => onLangChange(lang.code)}
                                        className={`px-2 py-0.5 text-[9px] font-black rounded-md transition-all border-none cursor-pointer ${
                                            activeLang === lang.code
                                                ? 'bg-white text-graphite-900 shadow-sm font-black'
                                                : 'text-graphite-400 hover:text-graphite-600 bg-transparent font-bold'
                                        }`}
                                    >
                                        {lang.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <textarea
                        ref={textareaRef}
                        value={caption[activeLang] || ''}
                        onChange={(e) => {
                            const updatedCaption = {
                                ...caption,
                                [activeLang]: e.target.value
                            };
                            onCaptionChange(updatedCaption);
                        }}
                        placeholder={t(`intelligence.universalSection.captionPlaceholder_${activeLang}`, {
                            defaultValue: activeLang === 'pt' ? 'Mensagem em português...' : activeLang === 'en' ? 'Message in English...' : 'Mensaje en español...'
                        })}
                        className="flex-1 w-full min-h-[120px] bg-white/80 border border-transparent shadow-float rounded-xl p-3 text-xs font-medium text-graphite-700 placeholder:text-graphite-300 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none outline-none leading-relaxed"
                    />
                    <div className="flex items-center justify-between">
                        <span className="text-[8px] font-bold text-graphite-300 uppercase">
                            {t('intelligence.universalSection.charCountLabel', { count: (caption[activeLang] || '').length, defaultValue: 'Aprox. ' + (caption[activeLang] || '').length + ' caracteres' })}
                        </span>
                        <div className="flex items-center gap-1">
                            <Check size={8} className="text-emerald-500" />
                            <span className="text-[8px] font-black text-emerald-500 uppercase">{t('intelligence.videoSection.syncedLabel')}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Painel de Variáveis (off-canvas) ─────────────────────────────── */}
            {showVarsPanel && (
                <>
                    <div
                        className="fixed inset-0 z-[80] bg-black/25 backdrop-blur-[1px]"
                        onClick={() => setShowVarsPanel(false)}
                    />
                    <div className="fixed right-0 top-0 h-full w-72 z-[90] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                        {/* Header */}
                        <div className="p-5 border-b border-ice-100 flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-black text-graphite-900">
                                    {t('intelligence.varsPanel.title', { defaultValue: 'Variáveis Disponíveis' })}
                                </p>
                                <p className="text-[10px] font-medium text-graphite-400 mt-0.5 leading-relaxed">
                                    {t('intelligence.varsPanel.subtitle', { defaultValue: 'Clique para inserir no cursor — idioma ativo:' })}{' '}
                                    <span className="font-black text-indigo-600 uppercase">{activeLang}</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowVarsPanel(false)}
                                className="p-1.5 hover:bg-ice-100 rounded-lg transition-all border-none bg-transparent cursor-pointer flex-shrink-0 mt-0.5"
                            >
                                <X size={15} className="text-graphite-500" />
                            </button>
                        </div>

                        {/* Lista de variáveis */}
                        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                            {TEMPLATE_VARIABLES.map((v) => (
                                <button
                                    key={v.placeholder}
                                    type="button"
                                    onClick={() => insertVariable(v.placeholder)}
                                    className="w-full text-left p-3 rounded-xl border border-transparent hover:border-indigo-200 hover:bg-indigo-50/60 transition-all cursor-pointer bg-ice-50/60 group"
                                >
                                    <p className="font-mono text-[10px] font-black text-indigo-600 group-hover:text-indigo-700">
                                        {v.placeholder}
                                    </p>
                                    <p className="text-[11px] font-bold text-graphite-700 mt-0.5">{v.label}</p>
                                    <p className="text-[9px] font-medium text-graphite-400 mt-0.5">
                                        ex: <span className="italic">{v.example}</span>
                                    </p>
                                </button>
                            ))}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-ice-100 bg-ice-50/50">
                            <p className="text-[9px] font-medium text-graphite-400 text-center leading-relaxed">
                                {t('intelligence.varsPanel.footer', { defaultValue: 'As variáveis são preenchidas automaticamente com os dados do agendamento no momento do envio.' })}
                            </p>
                        </div>
                    </div>
                </>
            )}
            {/* ─────────────────────────────────────────────────────────────────── */}
        </div>
    );
};

const MatrixRow = ({
    channelId,
    icon: Icon,
    color,
    bgColor,
    label,
    config,
    setConfig,
    supports,
    videoFallbackLabel
}: {
    channelId: 'whatsapp' | 'sms' | 'mms' | 'email';
    icon: React.ElementType;
    color: string;
    bgColor: string;
    label: string;
    config: BotConfig;
    setConfig: React.Dispatch<React.SetStateAction<BotConfig>>;
    supports: { no_show: boolean; videos: boolean; nps: boolean; recovery: boolean };
    videoFallbackLabel?: string;
}) => {
    const automations = config.channel_automations?.[channelId] || { no_show: false, videos: false, nps: false, recovery: false };

    const toggle = (key: 'no_show' | 'videos' | 'nps' | 'recovery') => {
        setConfig(prev => {
            const currentAutomations = prev.channel_automations || {};
            const channelCurrent = currentAutomations[channelId] || { no_show: false, videos: false, nps: false, recovery: false };
            const updated = {
                ...currentAutomations,
                [channelId]: {
                    ...channelCurrent,
                    [key]: !channelCurrent[key]
                }
            };
            return {
                ...prev,
                channel_automations: updated
            };
        });
    };

    return (
        <tr className="hover:bg-ice-50/30 transition-colors">
            <td className="p-4 font-bold text-graphite-900 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${bgColor} ${color}`}>
                    <Icon size={18} />
                </div>
                <span>{label}</span>
            </td>
            {/* Column: No-Show */}
            <td className="p-4 text-center">
                {supports.no_show ? (
                    <button
                        onClick={() => toggle('no_show')}
                        className={`relative inline-block w-12 h-6 rounded-full transition-all border-none cursor-pointer ${automations.no_show ? 'bg-brand-primary' : 'bg-ice-200'}`}
                    >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${automations.no_show ? 'left-6' : 'left-0.5'}`} />
                    </button>
                ) : (
                    <span className="text-xs text-graphite-300 font-bold uppercase">—</span>
                )}
            </td>
            {/* Column: Videos */}
            <td className="p-4 text-center">
                {supports.videos ? (
                    <button
                        onClick={() => toggle('videos')}
                        className={`relative inline-block w-12 h-6 rounded-full transition-all border-none cursor-pointer ${automations.videos ? 'bg-brand-primary' : 'bg-ice-200'}`}
                    >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${automations.videos ? 'left-6' : 'left-0.5'}`} />
                    </button>
                ) : (
                    <span className="text-[10px] text-graphite-400 font-bold uppercase bg-ice-100 px-2 py-1 rounded-lg border border-ice-200">{videoFallbackLabel || 'N/A'}</span>
                )}
            </td>
            {/* Column: NPS */}
            <td className="p-4 text-center">
                {supports.nps ? (
                    <button
                        onClick={() => toggle('nps')}
                        className={`relative inline-block w-12 h-6 rounded-full transition-all border-none cursor-pointer ${automations.nps ? 'bg-brand-primary' : 'bg-ice-200'}`}
                    >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${automations.nps ? 'left-6' : 'left-0.5'}`} />
                    </button>
                ) : (
                    <span className="text-xs text-graphite-300 font-bold uppercase">—</span>
                )}
            </td>
            {/* Column: Recuperação de Faltas (cadência D0/D2/D7 do CRM) */}
            <td className="p-4 text-center">
                {supports.recovery ? (
                    <button
                        onClick={() => toggle('recovery')}
                        className={`relative inline-block w-12 h-6 rounded-full transition-all border-none cursor-pointer ${automations.recovery ? 'bg-brand-primary' : 'bg-ice-200'}`}
                    >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${automations.recovery ? 'left-6' : 'left-0.5'}`} />
                    </button>
                ) : (
                    <span className="text-xs text-graphite-300 font-bold uppercase">—</span>
                )}
            </td>
        </tr>
    );
};

const MatrixRowMetaDisabled = ({
    icon: Icon,
    color,
    bgColor,
    label
}: {
    icon: React.ElementType;
    color: string;
    bgColor: string;
    label: string;
}) => {
    const { t } = useTranslation('tenantAdmin');
    return (
        <tr className="bg-ice-50/10">
            <td className="p-4 font-bold text-graphite-400 flex items-center gap-3">
                <div className={`p-2 rounded-lg opacity-60 ${bgColor} ${color}`}>
                    <Icon size={18} />
                </div>
                <span className="line-through">{label}</span>
            </td>
            <td colSpan={4} className="p-4 text-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-600 text-[10px] font-bold border border-rose-100">
                    <AlertCircle size={12} /> {t('intelligence.matrixSection.metaRestriction', { defaultValue: 'Indisponível (Restrição da Janela de 24h da Meta)' })}
                </span>
            </td>
        </tr>
    );
};
