/**
 * useBotConfig — fonte única de load/save do tenants.bot_config.
 *
 * Consumida por Intelligence.tsx (Dial de IA: active_agent, business_hours)
 * e por NotificationsPage.tsx (canais, lembretes, NPS, recall, recuperação).
 * Ambas as páginas escrevem no MESMO objeto bot_config — cada uma faz o
 * ciclo completo fetch → edita só a própria fatia → salva o objeto inteiro,
 * preservando os campos que não edita. Como as páginas nunca ficam montadas
 * ao mesmo tempo (navegação single-screen), isso nunca gera clobbering.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';
import { DEFAULT_BOOKING_CAPTIONS } from '../lib/messageDefaults';
import type { BotConfig } from '../types/botConfig';

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

const INITIAL_CONFIG: BotConfig = {
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
};

export function useBotConfig() {
    const { t } = useTranslation('tenantAdmin');
    const { showToast } = useToast();
    const { tenant, loading: tenantLoading, refresh: refreshTenant } = useTenant();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<BotConfig>(INITIAL_CONFIG);

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
                    // Dial de autonomia: 'human', 'copilot' e 'ai_always' são válidos.
                    // Valores autônomos legados (ai_assistant/flow_bot) caem para 'human'.
                    active_agent: ['copilot', 'ai_always'].includes(savedConfig.active_agent)
                        ? savedConfig.active_agent
                        : 'human',
                    enabled: true,
                    nps_delay_minutes: savedConfig.nps_delay_minutes ?? 180,
                    default_notification_channel: savedConfig.default_notification_channel ?? 'whatsapp',
                    booking_confirmation_captions: savedConfig.booking_confirmation_captions || DEFAULT_BOOKING_CAPTIONS,
                    booking_confirmation_image_url: savedConfig.booking_confirmation_image_url || '',
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

            const { error } = await supabase
                .from('tenants')
                .update({ bot_config: payload })
                .eq('id', tenant.id);

            if (error) throw error;

            await refreshTenant();
            showToast('success', t('intelligence.toasts.saveSuccess'));
        } catch (error: any) {
            console.error('Error saving bot_config:', error);
            showToast('error', t('intelligence.toasts.saveError', { message: error.message || t('intelligence.toasts.saveErrorUnknown') }));
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        if (!tenantLoading && tenant?.id) {
            fetchConfig();
        } else if (!tenantLoading) {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenant?.id, tenantLoading]);

    return { config, setConfig, loading, saving, saveConfig };
}
