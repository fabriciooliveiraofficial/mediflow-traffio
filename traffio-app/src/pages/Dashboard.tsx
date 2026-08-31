import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
    MoreVertical,
    Search,
    Globe,
    Facebook,
    Instagram,
    ShieldCheck,
    X,
    Loader2,
    RefreshCw,
    Unlink,
    AlertCircle,
    Target,
    Smartphone,
    MessageCircle,
    TrendingUp,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { PageHeader, Button } from '../components/ui';

/**
 * Ícone real por canal (Leads Feed, 2026-08-13) — antes alternava por posição
 * no array (`i % 2`), sem relação nenhuma com o canal real do paciente.
 */
/** Nome do canal real (WhatsApp/Instagram/Facebook são nomes de marca, iguais
 * nos 3 idiomas — só Live Chat é traduzido). Correção 13/08/2026: o rótulo
 * mostrava só o status de anúncio ("Contato direto"/"via anúncio") sem NUNCA
 * dizer o canal — usuário reportou "diz Direct Contact, mas é WhatsApp". */
function channelLabel(channel: string | null | undefined, t: (key: string) => string): string {
    switch (channel) {
        case 'instagram': return 'Instagram';
        case 'facebook':  return 'Facebook';
        case 'livechat':  return t('leadsFeed.channelLivechat');
        case 'whatsapp':
        default:          return 'WhatsApp';
    }
}

function channelIcon(channel: string | null | undefined) {
    switch (channel) {
        case 'instagram': return <Instagram size={20} className="text-[#E4405F]" />;
        case 'facebook':  return <Facebook size={20} className="text-[#0081FB]" />;
        case 'livechat':  return <Globe size={20} className="text-brand-primary" />;
        case 'whatsapp':
        default:          return <MessageCircle size={20} className="text-[#25D366]" />;
    }
}

/** Tempo relativo real a partir de `created_at` — antes era um texto fixo ("3h ago") igual para todo lead. */
function formatRelativeTime(dateStr: string | null | undefined, t: (key: string, opts?: any) => string): string {
    if (!dateStr) return '';
    const minutes = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (minutes < 1) return t('leadsFeed.timeJustNow');
    if (minutes < 60) return t('leadsFeed.timeMinutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('leadsFeed.timeHoursAgo', { count: hours });
    return t('leadsFeed.timeDaysAgo', { count: Math.floor(hours / 24) });
}

/**
 * Dashboard — gestão de integração de anúncios (Meta/Google Ads).
 *
 * A partir do reorg de Relatórios (roadmap item 7, 16/07/2026), os KPIs/
 * gráfico/tabela de campanhas que viviam aqui foram extraídos para
 * `src/components/reports/MarketingReport.tsx` (aba "Marketing" de
 * Relatórios). Esta página ficou só com a parte operacional: conectar/
 * gerenciar/desconectar as integrações OAuth e o feed de leads recentes.
 */
export const Dashboard: React.FC = () => {
    const { t } = useTranslation('dashboard');
    const { t: tSettings } = useTranslation('settings');
    const { tenant } = useTenant();
    const { showToast } = useToast();
    const { formatDateTime } = useLocaleFormat();
    const navigate = useNavigate();

    const [leads, setLeads] = useState<any[]>([]);
    const [integrations, setIntegrations] = useState<{meta?: boolean, google?: boolean}>({});
    const [adPerf, setAdPerf] = useState<{ platform: string; spend_cents: number; leads_count: number }[]>([]);
    const [openMenuLeadId, setOpenMenuLeadId] = useState<string | null>(null);

    const [manageModal, setManageModal] = useState<{ platform: 'meta' | 'google' } | null>(null);
    const [manageData, setManageData] = useState<any>(null);
    const [manageLoading, setManageLoading] = useState(false);

    const [metaPages, setMetaPages] = useState<any[]>([]);

    const fetchDashboardData = useCallback(async () => {
            if (!tenant?.id) return;

            try {
                // 1. Fetch Integrations Status
                const { data: intData } = await supabase
                    .from('ad_integrations')
                    .select('platform, status')
                    .eq('tenant_id', tenant.id);

                const intMap = intData?.reduce((acc: any, item: any) => {
                    acc[item.platform] = item.status === 'active';
                    return acc;
                }, {});
                setIntegrations(intMap || {});

                const tz = tenant?.timezone || 'America/Sao_Paulo';
                const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });

                // Quick Agenda
                const todayStr = formatter.format(new Date());
                await supabase
                    .from('appointments')
                    .select('*, patients(full_name)')
                    .eq('tenant_id', tenant.id)
                    .gte('date', todayStr)
                    .order('date', { ascending: true })
                    .limit(3);

                // Quick Leads
                const { data: leadData } = await supabase
                    .from('patients')
                    .select('*')
                    .eq('tenant_id', tenant.id)
                    .order('created_at', { ascending: false })
                    .limit(4);

                // Atribuição real de canal/anúncio (Leads Feed, 2026-08-13) — antes
                // o ícone/origem do card eram inventados (posição no array). Busca
                // a identidade de canal ligada a cada paciente (channel_identities,
                // já capturada no 1º contato — ver whatsapp-bot/meta-social-webhook)
                // pra mostrar o canal real e o `referral` de anúncio quando existir.
                if (leadData && leadData.length > 0) {
                    const { data: identities } = await supabase
                        .from('channel_identities')
                        .select('patient_id, channel, platform_meta')
                        .eq('tenant_id', tenant.id)
                        .in('patient_id', leadData.map((l: any) => l.id));
                    const byPatientId = new Map((identities || []).map((i: any) => [i.patient_id, i]));
                    setLeads(leadData.map((lead: any) => ({ ...lead, _identity: byPatientId.get(lead.id) || null })));
                } else if (leadData) {
                    setLeads(leadData);
                }

                // Sugestão de performance real (2026-08-13) — antes era um texto fixo
                // ("Meta Ads tem CPL 30% menor...") igual pra qualquer tenant. Usa o
                // mesmo dado já sincronizado por sync-ads-performance (ver
                // MarketingReport.tsx, mesma tabela/colunas) — spend_cents/leads_count
                // reais dos últimos 7 dias, por plataforma.
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                const { data: perfData } = await supabase
                    .from('ad_performance_daily')
                    .select('platform, spend_cents, leads_count')
                    .eq('tenant_id', tenant.id)
                    .gte('date', formatter.format(sevenDaysAgo));
                setAdPerf(perfData || []);

            } catch (error) {
                console.error('Error fetching dashboard data:', error);
            }
    }, [tenant?.id, tenant?.timezone]);

    const fetchMetaPages = useCallback(async () => {
        if (!tenant?.id) return;
        const { data } = await supabase
            .from('tenant_meta_pages')
            .select('id, page_id, page_name, page_category, instagram_account_id, instagram_username, instagram_profile_picture_url, is_active, last_refreshed_at, scope_granted')
            .eq('tenant_id', tenant.id)
            .order('page_name');
        setMetaPages(data ?? []);
    }, [tenant?.id]);

    const disconnectMetaPage = async (pageId: string) => {
        await supabase
            .from('tenant_meta_pages')
            .update({ is_active: false })
            .eq('id', pageId);
        fetchMetaPages();
        showToast('success', tSettings('toasts.metaPageDisconnected'));
    };

    // Fire-and-forget call to sync-ads-performance, then refresh once new data lands
    const triggerSyncAndRefresh = () => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fyyhxmugxcfqhvoevuwf.supabase.co';
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

        fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/sync-ads-performance`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${anonKey}`,
            },
            body: JSON.stringify({}),
        }).catch(() => { /* best-effort */ });

        setTimeout(() => {
            fetchDashboardData();
        }, 4000);
    };

    const handleConnect = (platform: 'meta' | 'google', features?: string) => {
        if (!tenant?.id) {
            showToast('error', t('toasts.tenantNotIdentified'));
            return;
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fyyhxmugxcfqhvoevuwf.supabase.co';
        const functionUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/auth-${platform}`;
        const redirectBack = window.location.origin;
        const featuresParam = (platform === 'meta' && features) ? `&features=${features}` : '';
        const authUrl = `${functionUrl}?tenant_id=${tenant.id}&redirect_back=${encodeURIComponent(redirectBack)}${featuresParam}`;

        // Open the OAuth flow in a popup, keeping a reference so we can close it from here
        const popup = window.open(authUrl, '_blank', 'width=600,height=700,scrollbars=yes');

        const handles: { interval?: ReturnType<typeof setInterval>; timeout?: ReturnType<typeof setTimeout> } = {};

        const cleanup = () => {
            if (handles.interval) clearInterval(handles.interval);
            if (handles.timeout) clearTimeout(handles.timeout);
            window.removeEventListener('message', handleMessage);
        };

        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data;
            if (!data || (data.type !== 'OAUTH_CONNECTED' && data.type !== 'OAUTH_ERROR')) return;
            if (data.platform !== platform) return;

            cleanup();
            try {
                popup?.close();
            } catch (e) {
                console.warn('COOP blocked window.close call:', e);
            }

            const platformLabel = platform === 'meta' ? t('filters.metaAds') : t('filters.googleAds');
            if (data.type === 'OAUTH_CONNECTED') {
                setIntegrations(prev => ({ ...prev, [platform]: true }));
                showToast('success', t('toasts.platformConnected', { platformLabel }));
                triggerSyncAndRefresh();
            } else {
                showToast('error', data.message || t('toasts.platformConnectError', { platformLabel }));
            }
        };

        window.addEventListener('message', handleMessage);

        // Fallback: poll ad_integrations in case postMessage doesn't arrive (e.g. popup blocked)
        handles.interval = setInterval(async () => {
            try {
                const { data } = await supabase
                    .from('ad_integrations')
                    .select('status')
                    .eq('tenant_id', tenant.id)
                    .eq('platform', platform)
                    .eq('status', 'active')
                    .maybeSingle();

                if (data) {
                    cleanup();
                    try {
                        popup?.close();
                    } catch (e) {
                        console.warn('COOP blocked window.close call:', e);
                    }
                    setIntegrations(prev => ({ ...prev, [platform]: true }));
                    triggerSyncAndRefresh();
                }
            } catch { /* silently retry */ }
        }, 2000);

        // Stop polling after 5 minutes (timeout safety)
        handles.timeout = setTimeout(cleanup, 300000);
    };

    const openManageModal = async (platform: 'meta' | 'google') => {
        if (!tenant?.id) return;
        setManageModal({ platform });
        setManageLoading(true);
        setManageData(null);
        try {
            const { data } = await supabase
                .from('ad_integrations')
                .select('settings, updated_at, status')
                .eq('tenant_id', tenant.id)
                .eq('platform', platform)
                .maybeSingle();
            setManageData(data);

            if (platform === 'meta') {
                await fetchMetaPages();
            }
        } catch {
            setManageData(null);
        } finally {
            setManageLoading(false);
        }
    };

    const metaScopes = useMemo(() => {
        const scopesSet = new Set<string>();
        metaPages.forEach(page => {
            if (Array.isArray(page.scope_granted)) {
                page.scope_granted.forEach((s: string) => scopesSet.add(s));
            }
        });
        if (integrations.meta && manageData?.settings?.ad_account_id) {
            scopesSet.add('ads_management');
            scopesSet.add('ads_read');
            scopesSet.add('pages_manage_ads');
        }
        return Array.from(scopesSet);
    }, [metaPages, integrations.meta, manageData?.settings]);

    const closeManageModal = () => {
        setManageModal(null);
        setManageData(null);
    };


    const handleDisconnect = async (platform: 'meta' | 'google') => {
        if (!tenant?.id) return;
        await supabase
            .from('ad_integrations')
            .update({ status: 'inactive' })
            .eq('tenant_id', tenant.id)
            .eq('platform', platform);

        // NÃO desativar tenant_meta_pages aqui: Meta Ads (auth-meta) e
        // mensagens IG/Messenger (auth-meta-messaging) são produtos separados.
        // Este bloco derrubava TODOS os canais de mensagem Meta ao desconectar
        // anúncios — causa raiz do incidente 17/08/2026 (mensagens de pacientes
        // descartadas em silêncio por 15 dias). Desconectar mensagens tem ação
        // própria e deliberada: disconnectMetaPage (por página).

        setIntegrations(prev => ({ ...prev, [platform]: false }));
        showToast('success', t('toasts.disconnectedSuccess'));
        closeManageModal();
        fetchDashboardData();
    };

    const handleSyncNow = () => {
        showToast('success', t('toasts.syncStarted'));
        triggerSyncAndRefresh();
        closeManageModal();
    };

    const handleChangeAdAccount = async (accountId: string) => {
        if (!tenant?.id || !manageModal) return;
        const newSettings = { ...(manageData?.settings || {}), ad_account_id: accountId };
        await supabase
            .from('ad_integrations')
            .update({ settings: newSettings })
            .eq('tenant_id', tenant.id)
            .eq('platform', manageModal.platform);
        setManageData((prev: any) => ({ ...prev, settings: newSettings }));
        showToast('success', t('toasts.adAccountUpdated'));
    };

    const handleChangeGoogleCustomer = async (customerId: string) => {
        if (!tenant?.id || !manageModal) return;
        const newSettings = { ...(manageData?.settings || {}), customer_id: customerId };
        await supabase
            .from('ad_integrations')
            .update({ settings: newSettings })
            .eq('tenant_id', tenant.id)
            .eq('platform', 'google');
        setManageData((prev: any) => ({ ...prev, settings: newSettings }));
        showToast('success', t('toasts.googleAccountLinked'));
    };

    useEffect(() => {
        fetchDashboardData();
        fetchMetaPages();
    }, [fetchDashboardData, fetchMetaPages]);

    // Comparação real de CPL entre plataformas (2026-08-13) — só mostra a
    // sugestão "com dado" quando as DUAS plataformas têm spend real nos
    // últimos 7 dias; caso contrário cai no texto de estado vazio já
    // existente (nunca inventa um número quando não há base suficiente).
    const cplComparison = useMemo(() => {
        const byPlatform = new Map<string, { spend: number; leads: number }>();
        for (const row of adPerf) {
            const cur = byPlatform.get(row.platform) || { spend: 0, leads: 0 };
            cur.spend += Number(row.spend_cents || 0) / 100;
            cur.leads += Number(row.leads_count || 0);
            byPlatform.set(row.platform, cur);
        }
        const meta = byPlatform.get('meta');
        const google = byPlatform.get('google');
        if (!meta || !google || meta.spend <= 0 || google.spend <= 0) return null;

        const cplMeta = meta.spend / Math.max(meta.leads, 1);
        const cplGoogle = google.spend / Math.max(google.leads, 1);
        const [lower, higher, lowerName] = cplMeta <= cplGoogle
            ? [cplMeta, cplGoogle, 'Meta Ads']
            : [cplGoogle, cplMeta, 'Google Ads'];
        if (higher <= 0) return null;
        const percent = Math.round((1 - lower / higher) * 100);
        if (percent <= 0) return null;
        return { platform: lowerName, percent };
    }, [adPerf]);

    return (
        <div className="w-full px-2 space-y-10 pb-20">
            <PageHeader
                icon={Target}
                title={t('integrations.title')}
                subtitle={t('integrations.pageSubtitle')}
                actions={
                    <Button variant="secondary" onClick={() => navigate('/dashboard/reports?tab=marketing')}>
                        <TrendingUp size={16} />
                        {t('header.viewFullReportButton')}
                    </Button>
                }
            />

            {/* ── ADS INTEGRATION DRAWER (OAUTH) ───────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {/* Meta Ads Card */}
                 <div className="glass p-6 rounded-[32px] border-none shadow-xl shadow-blue-100/20 bg-gradient-to-br from-white to-blue-50/30 group">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-[#0081FB] rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                                <Facebook className="text-white" fill="white" size={28} />
                            </div>
                            <div>
                                <p className="text-sm font-black text-graphite-900 tracking-tight">{t('integrations.metaHubName')}</p>
                                <div className="flex items-center gap-2">
                                    {integrations.meta ? (
                                        <div className="flex items-center gap-1">
                                            <div className="w-1 h-1 bg-green-500 rounded-full"></div>
                                            <span className="text-[8px] font-black text-green-600 uppercase tracking-widest">{t('integrations.active')}</span>
                                        </div>
                                    ) : (
                                        <span className="text-[8px] text-blue-600 font-black uppercase tracking-widest">{t('integrations.recommended')}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className={clsx(
                            "flex h-2 w-2 rounded-full",
                            integrations.meta ? "bg-green-400" : "bg-red-400 animate-pulse"
                        )}></div>
                    </div>
                    <p className="text-[11px] text-graphite-400 leading-relaxed font-medium mb-6">
                        {t('integrations.metaDescription')}
                    </p>
                    {integrations.meta && metaPages[0]?.instagram_username && (
                        <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-pink-50 text-[#E4405F] rounded-2xl w-fit">
                            {metaPages[0].instagram_profile_picture_url ? (
                                <img
                                    src={metaPages[0].instagram_profile_picture_url}
                                    alt={metaPages[0].instagram_username}
                                    className="w-6 h-6 rounded-full object-cover border border-pink-200"
                                />
                            ) : (
                                <Instagram size={14} />
                            )}
                            <span className="text-[11px] font-black">@{metaPages[0].instagram_username}</span>
                        </div>
                    )}
                    <button
                        onClick={() => integrations.meta ? openManageModal('meta') : handleConnect('meta', 'ads,messaging')}
                        className={clsx(
                            "w-full py-4 rounded-2xl font-black text-xs shadow-xl transition-all border-none cursor-pointer flex items-center justify-center gap-2",
                            integrations.meta
                                ? "bg-green-50 text-green-600 shadow-green-500/5 hover:bg-green-100"
                                : "bg-[#0081FB] text-white shadow-blue-500/20 hover:translate-y-[-2px] active:scale-95"
                        )}
                    >
                        {integrations.meta ? <ShieldCheck size={16} /> : null}
                        {integrations.meta ? t('integrations.manageConnection') : t('integrations.connectMetaAccount')}
                    </button>
                 </div>

                 {/* Google Ads Card */}
                 <div className="glass p-6 rounded-[32px] border-none shadow-xl shadow-green-100/20 bg-gradient-to-br from-white to-green-50/30 group">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-white border border-ice-100 rounded-2xl flex items-center justify-center shadow-lg shadow-ice-200/50">
                                <Globe className="text-[#34A853]" size={28} />
                            </div>
                            <div>
                                <p className="text-sm font-black text-graphite-900 tracking-tight">{t('integrations.googleHubName')}</p>
                                <div className="flex items-center gap-2">
                                    {integrations.google ? (
                                        <div className="flex items-center gap-1">
                                            <div className="w-1 h-1 bg-green-500 rounded-full"></div>
                                            <span className="text-[8px] font-black text-green-600 uppercase tracking-widest">{t('integrations.active')}</span>
                                        </div>
                                    ) : (
                                        <span className="text-[8px] text-green-600 font-black uppercase tracking-widest">{t('integrations.localTraffic')}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className={clsx(
                            "flex h-2 w-2 rounded-full",
                            integrations.google ? "bg-green-400" : "bg-ice-200"
                        )}></div>
                    </div>
                    <p className="text-[11px] text-graphite-400 leading-relaxed font-medium mb-6">
                        {t('integrations.googleDescription')}
                    </p>
                    <button
                        onClick={() => integrations.google ? openManageModal('google') : handleConnect('google')}
                        className={clsx(
                            "w-full py-4 rounded-2xl font-black text-xs shadow-xl transition-all border-none cursor-pointer flex items-center justify-center gap-2",
                            integrations.google
                                ? "bg-green-50 text-green-600 shadow-green-500/5 hover:bg-green-100"
                                : "bg-graphite-900 text-white shadow-graphite-900/20 hover:translate-y-[-2px] active:scale-95"
                        )}
                    >
                        {integrations.google ? <ShieldCheck size={16} /> : null}
                        {integrations.google ? t('integrations.manageConnection') : t('integrations.connectGoogleAds')}
                    </button>
                 </div>
            </div>

            {/* AI Command Banner */}
            <div className="p-8 bg-gradient-to-br from-brand-primary to-blue-600 rounded-[40px] text-white space-y-4 relative overflow-hidden group">
                <div className="relative z-10 space-y-4">
                    <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20">
                        <Smartphone size={24} className="text-white" />
                    </div>
                    <h5 className="text-2xl font-black leading-tight tracking-tight">
                        {t('integrations.performanceSuggestionTitle')}
                    </h5>
                    <p className="text-[12px] text-white/80 font-medium leading-relaxed">
                        {cplComparison ?
                            t('integrations.performanceSuggestionTextReal', { platform: cplComparison.platform, percent: cplComparison.percent }) :
                            t('integrations.performanceSuggestionTextEmpty')
                        }
                    </p>
                    {/* Sem automação real de realocação de orçamento hoje (só leitura de
                        performance) — o CTA leva ao relatório de verdade em vez de fingir
                        uma ação de "aplicar" que não existe. */}
                    <button
                        onClick={() => navigate('/dashboard/reports?tab=marketing')}
                        className="px-6 py-3 bg-white text-brand-primary rounded-xl font-black text-[10px] uppercase tracking-tighter hover:bg-ice-50 transition-colors border-none cursor-pointer shadow-lg shadow-brand-primary/20"
                    >
                        {cplComparison ? t('header.viewFullReportButton') : t('integrations.viewSimulation')}
                    </button>
                </div>
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-10 rounded-full group-hover:scale-110 transition-transform duration-1000"></div>
            </div>

            {/* ── CRM LEADS FEED ──────────────────────────────────────────────── */}
            <div className="space-y-8">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h4 className="text-3xl font-black tracking-tighter">{t('leadsFeed.titlePrefix')} <span className="text-brand-primary">{t('leadsFeed.titleHighlight')}</span></h4>
                        <p className="text-xs text-graphite-400 font-medium tracking-tight">{t('leadsFeed.subtitle')}</p>
                    </div>
                    <button className="px-6 py-3 bg-ice-100 rounded-2xl text-[10px] font-black uppercase tracking-widest text-graphite-600 hover:bg-ice-200 transition-all border-none cursor-pointer">{t('leadsFeed.viewFullFunnel')}</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {leads.length > 0 ? leads.map((lead, i) => (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            key={lead.id}
                            onClick={() => navigate('/dashboard/patients/' + lead.id)}
                            className="glass p-6 rounded-[32px] flex flex-col gap-4 group cursor-pointer border-none shadow-lg shadow-ice-100/30"
                        >
                            <div className="flex justify-between items-start">
                                <div className="w-12 h-12 bg-ice-50 rounded-2xl flex items-center justify-center border border-transparent group-hover:border-brand-primary/20 transition-all ring-4 ring-transparent group-hover:ring-brand-primary/5">
                                    {channelIcon(lead._identity?.channel)}
                                </div>
                                {/* Menu real (2026-08-13) — antes eram 2 botões sem onClick, só
                                    visíveis no hover, com bg-ice-50 quase invisível sobre o card
                                    .glass. Agora: contraste real (fundo branco + borda, padrão de
                                    IconButton/WorkQueue.tsx) e opacity-70 em repouso (não 0). */}
                                <div className="relative opacity-70 group-hover:opacity-100 transition-all">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setOpenMenuLeadId(openMenuLeadId === lead.id ? null : lead.id); }}
                                        className="w-8 h-8 rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 hover:text-brand-primary transition-all cursor-pointer"
                                    >
                                        <MoreVertical size={14} />
                                    </button>
                                    {openMenuLeadId === lead.id && (
                                        <>
                                            <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpenMenuLeadId(null); }} />
                                            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl border border-ice-100 shadow-xl z-20 overflow-hidden">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setOpenMenuLeadId(null); navigate('/dashboard/patients/' + lead.id); }}
                                                    className="w-full text-left px-4 py-2.5 text-xs font-bold text-graphite-700 hover:bg-ice-50 border-none bg-transparent cursor-pointer"
                                                >
                                                    {t('leadsFeed.viewFullProfile')}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenMenuLeadId(null);
                                                        navigator.clipboard.writeText(lead.phone || '');
                                                        showToast('success', t('leadsFeed.phoneCopied'));
                                                    }}
                                                    className="w-full text-left px-4 py-2.5 text-xs font-bold text-graphite-700 hover:bg-ice-50 border-none bg-transparent cursor-pointer"
                                                >
                                                    {t('leadsFeed.copyPhone')}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[15px] font-black text-graphite-900 tracking-tight">{lead.full_name}</p>
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                                    <p className="text-[10px] text-graphite-400 font-bold uppercase tracking-tighter">
                                        {lead._identity?.platform_meta?.referral
                                            ? t('leadsFeed.sourceViaAd', { channel: channelLabel(lead._identity?.channel, t) })
                                            : channelLabel(lead._identity?.channel, t)}
                                    </p>
                                </div>
                            </div>
                            <div className="pt-4 border-t border-ice-100/50 flex items-center justify-between">
                                <span className="text-[9px] font-black uppercase text-graphite-400 bg-ice-50 px-2.5 py-1 rounded-full">{formatRelativeTime(lead.created_at, t)}</span>
                            </div>
                        </motion.div>
                    )) : (
                        <div className="col-span-full py-20 text-center space-y-4">
                            <div className="w-20 h-20 bg-ice-50 rounded-full mx-auto flex items-center justify-center">
                                <Search size={32} className="text-ice-200" />
                            </div>
                            <p className="text-sm font-black text-graphite-400 italic tracking-tight">{t('leadsFeed.emptyState')}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ── GERENCIAR CONEXÃO MODAL ──────────────────────────────────────── */}
            <AnimatePresence>
                {manageModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={closeManageModal}
                            className="absolute inset-0 bg-graphite-900/40 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="relative w-full max-w-5xl max-h-[97vh] bg-white rounded-[32px] border border-ice-100 shadow-2xl p-6 space-y-4 overflow-y-auto"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={clsx(
                                        "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                                        manageModal.platform === 'meta' ? "bg-[#0081FB]" : "bg-white border border-ice-100"
                                    )}>
                                        {manageModal.platform === 'meta'
                                            ? <Facebook className="text-white" fill="white" size={22} />
                                            : <Globe className="text-[#34A853]" size={22} />}
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-graphite-900 tracking-tight">
                                            {manageModal.platform === 'meta' ? t('manageModal.metaAdsHub') : t('manageModal.googleAdsHub')}
                                        </h3>
                                        <span className="text-sm font-black text-green-600 uppercase tracking-widest">{t('manageModal.active')}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={closeManageModal}
                                    className="p-2 rounded-xl hover:bg-ice-50 border-none cursor-pointer transition-colors"
                                >
                                    <X size={20} className="text-graphite-400" />
                                </button>
                            </div>

                            {manageLoading ? (
                                <div className="py-10 flex items-center justify-center">
                                    <Loader2 className="animate-spin text-brand-primary" size={28} />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {manageModal.platform === 'meta' && (
                                        <div className="space-y-4">
                                            {/* Conta de Anúncios */}
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-lg bg-blue-50 text-[#0081FB] flex items-center justify-center">
                                                        <Target size={16} />
                                                    </div>
                                                    <h4 className="text-base font-black text-graphite-900 tracking-tight">{t('manageModal.adAccountLabel')}</h4>
                                                </div>

                                                <div className="bg-ice-50/50 border border-ice-100 rounded-2xl p-3">
                                                    {manageData?.settings?.available_ad_accounts?.length > 1 ? (
                                                        <select
                                                            value={manageData?.settings?.ad_account_id || ''}
                                                            onChange={(e) => handleChangeAdAccount(e.target.value)}
                                                            className="w-full bg-transparent text-base font-bold text-graphite-900 border-none cursor-pointer focus:outline-none focus:ring-0"
                                                        >
                                                            {manageData.settings.available_ad_accounts.map((acc: any) => (
                                                                <option key={acc.id} value={acc.id}>{acc.name} ({acc.id})</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <p className="text-base font-bold text-graphite-900">
                                                            {manageData?.settings?.ad_account_id || t('manageModal.noAccountLinked')}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Canais de Mensagem */}
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-lg bg-pink-50 text-pink-500 flex items-center justify-center">
                                                        <MessageCircle size={16} />
                                                    </div>
                                                    <h4 className="text-base font-black text-graphite-900 tracking-tight">{t('manageModal.channelsLabel')}</h4>
                                                </div>

                                                {metaPages.length === 0 ? (
                                                    <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-50/50 border border-amber-100/50">
                                                        <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                                                            <AlertCircle size={18} />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm text-amber-900 font-bold">Nenhum canal conectado</p>
                                                            <p className="text-xs text-amber-700/80 font-medium">Reconecte sua conta para selecionar páginas.</p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-1 gap-2">
                                                        {metaPages.map((page) => (
                                                            <div key={page.id} className="p-4 rounded-2xl bg-ice-50/50 border border-ice-100 space-y-3">
                                                                <div className="flex items-center justify-between group">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-11 h-11 rounded-xl bg-blue-50/50 flex items-center justify-center shrink-0 border border-blue-100/50 text-[#0081FB]">
                                                                            <Facebook size={20} fill="#0081FB" />
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-base font-black text-graphite-900 leading-tight">{page.page_name}</p>
                                                                            <div className="flex flex-wrap gap-2 mt-1.5">
                                                                                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-[#0081FB] rounded-lg text-xs font-black uppercase tracking-wider">
                                                                                    <Facebook size={12} fill="#0081FB" />
                                                                                    <span>Messenger</span>
                                                                                </div>
                                                                                {page.instagram_username && (
                                                                                    <div className="flex flex-col gap-1">
                                                                                        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-pink-50 text-[#E4405F] rounded-lg text-xs font-black uppercase tracking-wider w-fit">
                                                                                            {page.instagram_profile_picture_url ? (
                                                                                                <img src={page.instagram_profile_picture_url} alt={page.instagram_username} className="w-6 h-6 rounded-full object-cover border border-pink-200" />
                                                                                            ) : (
                                                                                                <Instagram size={14} />
                                                                                            )}
                                                                                            <span>Instagram (@{page.instagram_username})</span>
                                                                                        </div>
                                                                                        <p className="text-[11px] font-medium text-pink-600/80 leading-snug max-w-[420px]">
                                                                                            We use instagram_business_basic to display the connected clinic's avatar and username here.
                                                                                        </p>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <div className={clsx("w-2 h-2 rounded-full", page.is_active ? "bg-green-500" : "bg-red-500")}></div>
                                                                            <span className={clsx("text-xs font-black uppercase tracking-widest", page.is_active ? "text-green-600" : "text-red-600")}>
                                                                                {page.is_active ? t('manageModal.active') : 'Inativo'}
                                                                            </span>
                                                                        </div>
                                                                        <div className="w-px h-4 bg-ice-100"></div>
                                                                        <button
                                                                            onClick={() => disconnectMetaPage(page.id)}
                                                                            className="p-1.5 text-graphite-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all border-none cursor-pointer"
                                                                            title={tSettings('clinics.metaDisconnectTitle')}
                                                                        >
                                                                            <Unlink size={16} />
                                                                        </button>
                                                                    </div>
                                                                </div>

                                                                <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-ice-100/50 text-xs text-graphite-400 font-medium">
                                                                    {page.page_category && (
                                                                        <div>
                                                                            <span className="block font-black text-graphite-500 uppercase tracking-wider">{t('manageModal.categoryLabel')}</span>
                                                                            <span className="block text-sm text-graphite-600 mt-0.5">{page.page_category}</span>
                                                                        </div>
                                                                    )}
                                                                    {page.last_refreshed_at && (
                                                                        <div>
                                                                            <span className="block font-black text-graphite-500 uppercase tracking-wider">{t('manageModal.tokenRefreshed')}</span>
                                                                            <span className="block text-sm text-graphite-600 mt-0.5">{formatDateTime(page.last_refreshed_at)}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Permissões Concedidas */}
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
                                                        <ShieldCheck size={16} />
                                                    </div>
                                                    <h4 className="text-base font-black text-graphite-900 tracking-tight">{t('manageModal.permissionsLabel')}</h4>
                                                </div>

                                                {metaScopes.length === 0 ? (
                                                    <p className="text-sm text-graphite-400 font-medium leading-relaxed bg-ice-50/50 border border-ice-100 rounded-2xl p-4">
                                                        {t('manageModal.noPermissions')}
                                                    </p>
                                                ) : (
                                                    <div className="grid grid-cols-3 gap-2 bg-ice-50/50 border border-ice-100 rounded-2xl p-3">
                                                        {metaScopes.map((scope) => (
                                                            <div key={scope} className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-ice-100 rounded-xl text-graphite-700 shadow-sm">
                                                                <ShieldCheck size={18} className="shrink-0 text-green-500" />
                                                                <div className="flex flex-col min-w-0">
                                                                    <span className="text-sm font-black text-graphite-900 tracking-tight truncate">
                                                                        {t(`manageModal.scopes.${scope}`, { defaultValue: scope })}
                                                                    </span>
                                                                    <span className="text-[11px] text-graphite-400 font-medium tracking-tight truncate">
                                                                        {scope}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {manageModal.platform === 'google' && (
                                        <div className="space-y-4 border-b border-ice-100/50 pb-4">
                                            {manageData?.settings?.available_customers?.length > 1 ? (
                                                <div className="space-y-2">
                                                    <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{t('manageModal.selectGoogleAccountLabel')}</p>
                                                    <select
                                                        value={manageData?.settings?.customer_id || ''}
                                                        onChange={(e) => handleChangeGoogleCustomer(e.target.value)}
                                                        className="w-full px-4 py-3 bg-ice-50 rounded-2xl text-sm font-bold text-graphite-900 border-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-primary"
                                                    >
                                                        <option value="">{t('manageModal.selectAccountPlaceholder')}</option>
                                                        {manageData.settings.available_customers.map((cId: string) => (
                                                            <option key={cId} value={cId}>{t('manageModal.accountOption', { customerId: formatGoogleCustomerId(cId) })}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ) : manageData?.settings?.customer_id ? (
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{t('manageModal.linkedAccountLabel')}</p>
                                                    <p className="text-sm font-bold text-graphite-900">
                                                        {t('manageModal.idLabel', { customerId: formatGoogleCustomerId(manageData.settings.customer_id) })}
                                                    </p>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-graphite-400 font-medium leading-relaxed">
                                                    {t('manageModal.noAdAccountSelected')}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between border-t border-ice-100/50 pt-3">
                                        <p className="text-xs font-black text-graphite-400 uppercase tracking-widest">{t('manageModal.lastSyncLabel')}</p>
                                        <p className="text-sm font-bold text-graphite-900">
                                            {manageData?.settings?.last_sync_at
                                                ? formatDateTime(manageData.settings.last_sync_at)
                                                : t('manageModal.notSyncedYet')}
                                        </p>
                                    </div>

                                    {manageData?.settings?.last_sync_error && (
                                        <div className="p-3 bg-red-50 rounded-2xl flex items-start gap-3">
                                            <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
                                            <p className="text-sm font-bold text-red-600 leading-relaxed">
                                                {manageData.settings.last_sync_error}
                                            </p>
                                        </div>
                                    )}

                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <button
                                            onClick={handleSyncNow}
                                            className="flex-1 py-3 bg-brand-primary text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 border-none cursor-pointer hover:translate-y-[-1px] transition-all"
                                        >
                                            <RefreshCw size={16} />
                                            {t('manageModal.syncNow')}
                                        </button>
                                        {manageModal.platform === 'meta' && (
                                            <button
                                                onClick={() => {
                                                    handleConnect('meta', 'ads,messaging');
                                                    closeManageModal();
                                                }}
                                                className="flex-1 py-3 bg-ice-50 hover:bg-ice-100 text-graphite-600 rounded-2xl font-black text-sm flex items-center justify-center gap-2 border-none cursor-pointer transition-all"
                                            >
                                                <RefreshCw size={16} />
                                                Reconectar Conta Meta
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDisconnect(manageModal.platform)}
                                            className="flex-1 py-3 bg-red-50 text-red-600 rounded-2xl font-black text-sm flex items-center justify-center gap-2 border-none cursor-pointer hover:bg-red-100 transition-all"
                                        >
                                            <Unlink size={16} />
                                            {t('manageModal.disconnect')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

const formatGoogleCustomerId = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 10);
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 6) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 6)}-${numbers.slice(6)}`;
};
