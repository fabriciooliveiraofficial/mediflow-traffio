import { useState, useEffect } from 'react';
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
    Plus
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';

export interface ChannelAutomation {
    no_show: boolean;
    videos: boolean;
    nps: boolean;
}

export interface CustomReminder {
    id: string;
    offset_minutes: number;
    type: 'no_show' | 'nps' | 'custom';
    videoUrl: string | null;
    caption: Record<string, string>;
    enabled: boolean;
}

export interface BotConfig {
    enabled: boolean;
    active_agent: 'human' | 'ai_assistant' | 'flow_bot';
    no_show_prevention?: boolean;
    nps_enabled?: boolean;
    test_mode_15m?: boolean;
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
    const [config, setConfig] = useState<BotConfig>({
        enabled: true,
        active_agent: 'human',
        no_show_prevention: true,
        nps_enabled: true,
        test_mode_15m: false,
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
            whatsapp: { no_show: true, videos: true, nps: true },
            sms: { no_show: true, videos: false, nps: true },
            mms: { no_show: true, videos: true, nps: false },
            email: { no_show: false, videos: false, nps: true }
        },
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
                    active_agent: 'human',
                    enabled: true,
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
                    channel_automations: savedConfig.channel_automations || {
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
                    }
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
                whatsapp: !!(config.channel_automations?.whatsapp?.no_show || config.channel_automations?.whatsapp?.videos || config.channel_automations?.whatsapp?.nps),
                sms: !!(config.channel_automations?.sms?.no_show || config.channel_automations?.sms?.nps),
                mms: !!(config.channel_automations?.mms?.no_show || config.channel_automations?.mms?.videos || config.channel_automations?.mms?.nps),
                email: !!(config.channel_automations?.email?.no_show || config.channel_automations?.email?.nps),
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
        <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
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

const AutomationSettings = ({ config, setConfig, onSave, saving }: {
    config: BotConfig,
    setConfig: React.Dispatch<React.SetStateAction<BotConfig>>,
    onSave: () => void,
    saving: boolean
}) => {
    const { t } = useTranslation('tenantAdmin');
    
    // Add custom reminder states
    const [isAdding, setIsAdding] = useState(false);
    const [newOffset, setNewOffset] = useState<number>(2);
    const [newUnit, setNewUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
    const [newDirection, setNewDirection] = useState<'before' | 'after'>('before');
    return (
        <div className="bg-white border border-ice-200 rounded-3xl shadow-sm overflow-hidden transition-all duration-300">
            <div className="p-8 space-y-8">
                {/* ── Matriz de Canais e Automações ── */}
                <div className="space-y-5">
                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-2">
                        <Activity size={14} className="text-brand-primary" /> {t('intelligence.matrixSection.title', { defaultValue: 'Matriz de Canais e Automações' })}
                    </h4>

                    <div className="overflow-x-auto border border-ice-100 rounded-2xl bg-ice-50/20">
                        <table className="w-full border-collapse text-left">
                            <thead>
                                <tr className="border-b border-ice-100 bg-ice-50/50">
                                    <th className="p-4 text-[10px] font-black text-graphite-400 uppercase tracking-wider">{t('intelligence.matrixSection.headers.channel', { defaultValue: 'Canal' })}</th>
                                    <th className="p-4 text-[10px] font-black text-graphite-400 uppercase tracking-wider text-center">{t('intelligence.matrixSection.headers.noShow', { defaultValue: 'Prevenção de No-Show' })}</th>
                                    <th className="p-4 text-[10px] font-black text-graphite-400 uppercase tracking-wider text-center">{t('intelligence.matrixSection.headers.videos', { defaultValue: 'Vídeos de Confirmação' })}</th>
                                    <th className="p-4 text-[10px] font-black text-graphite-400 uppercase tracking-wider text-center">{t('intelligence.matrixSection.headers.nps', { defaultValue: 'Pesquisa NPS' })}</th>
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
                                    supports={{ no_show: true, videos: true, nps: true }}
                                />
                                <MatrixRow
                                    channelId="sms"
                                    icon={Phone}
                                    color="text-graphite-600"
                                    bgColor="bg-ice-100"
                                    label="SMS"
                                    config={config}
                                    setConfig={setConfig}
                                    supports={{ no_show: true, videos: false, nps: true }}
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
                                    supports={{ no_show: true, videos: true, nps: true }}
                                />
                                <MatrixRow
                                    channelId="email"
                                    icon={Mail}
                                    color="text-violet-600"
                                    bgColor="bg-violet-50"
                                    label="E-mail"
                                    config={config}
                                    setConfig={setConfig}
                                    supports={{ no_show: true, videos: false, nps: true }}
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
                    <div className="space-y-5 bg-indigo-50/30 p-8 rounded-3xl border border-indigo-100 animate-in fade-in duration-500">
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
                                                    className="w-full bg-white border border-ice-200 rounded-xl p-2 text-xs font-bold outline-none focus:border-indigo-500"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-black text-graphite-400 uppercase">
                                                    {t('intelligence.universalSection.unitLabel', { defaultValue: 'Unidade' })}
                                                </label>
                                                <select
                                                    value={newUnit}
                                                    onChange={(e) => setNewUnit(e.target.value as any)}
                                                    className="w-full bg-white border border-ice-200 rounded-xl p-2 text-xs font-bold outline-none focus:border-indigo-500 cursor-pointer"
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
                                                    className="w-full bg-white border border-ice-200 rounded-xl p-2 text-xs font-bold outline-none focus:border-indigo-500 cursor-pointer"
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
                            ) : (
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
                                </button>
                            )}
                        </div>
                    </div>
                )}

                <div className="p-4 bg-white/50 rounded-2xl border border-indigo-100 flex items-center gap-3">
                    <AlertTriangle size={16} className="text-indigo-500 flex-shrink-0" />
                    <p className="text-xs font-bold text-indigo-800 leading-relaxed">
                        {t('intelligence.universalSection.infoBanner')}
                    </p>
                </div>

                {/* ── Teste e Salvar ── */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-8 border-t border-ice-100">
                    <div className="flex items-center gap-4 bg-ice-50 px-5 py-3 rounded-2xl border border-ice-100">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            <p className="text-[10px] font-black text-graphite-400 uppercase">{t('intelligence.testModeLabel')}</p>
                        </div>
                        <button
                            onClick={() => setConfig(prev => ({ ...prev, test_mode_15m: !prev.test_mode_15m }))}
                            className={`relative w-10 h-5 rounded-full transition-all border-none cursor-pointer flex-shrink-0 ${config.test_mode_15m ? 'bg-amber-500' : 'bg-ice-200'}`}
                        >
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${config.test_mode_15m ? 'left-5' : 'left-0.5'}`} />
                        </button>
                    </div>

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
        <div className="flex items-center gap-1 bg-ice-50/50 hover:bg-ice-50 px-2.5 py-1 rounded-xl border border-ice-100/50 transition-all select-none">
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

const UniversalReminderCard = ({ offsetMinutes, onOffsetChange, enabled, onToggle, videoUrl, caption, onVideoChange, onCaptionChange, onDelete }: { 
    offsetMinutes: number;
    onOffsetChange: (mins: number) => void;
    enabled: boolean;
    onToggle: () => void;
    videoUrl: string | null; 
    caption: Record<string, string>;
    onVideoChange: (url: string | null) => void;
    onCaptionChange: (captionRecord: Record<string, string>) => void;
    onDelete?: () => void;
}) => {
    const { t } = useTranslation('tenantAdmin');
    const [uploading, setUploading] = useState(false);
    const { tenant } = useTenant();
    const { showToast } = useToast();
    const [activeLang, setActiveLang] = useState<'pt' | 'en' | 'es'>('pt');

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
        <div className={`p-5 rounded-2xl border transition-all group/card ${enabled ? 'bg-white/40 border-indigo-100/50 shadow-sm hover:shadow-md' : 'bg-ice-100/30 border-ice-200/50 opacity-60'}`}>
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
                        
                        <div className="flex bg-ice-100 p-0.5 rounded-lg border border-ice-200">
                            {languages.map((lang) => (
                                <button
                                    key={lang.code}
                                    type="button"
                                    onClick={() => setActiveLang(lang.code)}
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
                    <textarea
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
                        className="flex-1 w-full min-h-[120px] bg-white/80 border border-ice-200 rounded-xl p-3 text-xs font-medium text-graphite-700 placeholder:text-graphite-300 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none outline-none leading-relaxed"
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
    supports: { no_show: boolean; videos: boolean; nps: boolean };
    videoFallbackLabel?: string;
}) => {
    const automations = config.channel_automations?.[channelId] || { no_show: false, videos: false, nps: false };

    const toggle = (key: 'no_show' | 'videos' | 'nps') => {
        setConfig(prev => {
            const currentAutomations = prev.channel_automations || {};
            const channelCurrent = currentAutomations[channelId] || { no_show: false, videos: false, nps: false };
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
            <td colSpan={3} className="p-4 text-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-600 text-[10px] font-bold border border-rose-100">
                    <AlertCircle size={12} /> {t('intelligence.matrixSection.metaRestriction', { defaultValue: 'Indisponível (Restrição da Janela de 24h da Meta)' })}
                </span>
            </td>
        </tr>
    );
};
