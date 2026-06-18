import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
    Activity,
    ArrowUpRight,
    ArrowDownRight,
    Plus,
    MoreVertical,
    Calendar as CalendarIcon,
    Search,
    Globe,
    Zap,
    Link as LinkIcon,
    Facebook,
    Instagram,
    Smartphone,
    MousePointer2,
    MousePointerClick,
    BarChart3,
    ShieldCheck,
    X,
    Loader2,
    RefreshCw,
    Unlink,
    AlertCircle,
    ChevronDown,
    Filter,
    Eye,
    Target,
    DollarSign,
    TrendingUp,
    FileText,
    FileSpreadsheet,
    ArrowUpDown
} from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';

type Period = 'today' | '7d' | '30d' | 'custom';
type Platform = 'all' | 'meta' | 'google';
type ChartMetric = 'leads' | 'spend' | 'impressions' | 'clicks' | 'conversions' | 'ctr' | 'cpc' | 'cpm';
type CampaignSortKey = 'campaign_name' | 'platform' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cpm' | 'conversions' | 'cpa' | 'roas';

type PlatformBucket = { spend: number; impressions: number; clicks: number; leads: number; conversions: number };

type CampaignRow = {
    campaign_name: string;
    platform: 'meta' | 'google';
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    leads: number;
    revenue: number;
    ctr: number;
    cpc: number;
    cpm: number;
    cpa: number;
    roas: number;
};

const PERIOD_LABELS: Record<Period, string> = {
    today: 'Hoje',
    '7d': 'Últimos 7 Dias',
    '30d': 'Últimos 30 Dias',
    custom: 'Personalizado',
};

const CHART_METRICS: { key: ChartMetric; label: string }[] = [
    { key: 'leads', label: 'Leads' },
    { key: 'spend', label: 'Gasto' },
    { key: 'impressions', label: 'Impressões' },
    { key: 'clicks', label: 'Cliques' },
    { key: 'conversions', label: 'Conversões' },
    { key: 'ctr', label: 'CTR' },
    { key: 'cpc', label: 'CPC' },
    { key: 'cpm', label: 'CPM' },
];

const CAMPAIGN_COLUMNS: { key: CampaignSortKey; label: string }[] = [
    { key: 'campaign_name', label: 'Campanha' },
    { key: 'platform', label: 'Plataforma' },
    { key: 'spend', label: 'Gasto' },
    { key: 'impressions', label: 'Impressões' },
    { key: 'clicks', label: 'Cliques' },
    { key: 'ctr', label: 'CTR' },
    { key: 'cpc', label: 'CPC' },
    { key: 'cpm', label: 'CPM' },
    { key: 'conversions', label: 'Conversões' },
    { key: 'cpa', label: 'CPA' },
    { key: 'roas', label: 'ROAS' },
];

const formatCurrency = (value: number) =>
    `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const StatCard = ({ label, value, subtext, trend, trendType, color, icon, iconColorClass }: {
    label: string, value: string, subtext?: string, trend?: string, trendType?: 'up' | 'down', color: string, icon?: React.ReactNode, iconColorClass?: string
}) => (
    <motion.div
        whileHover={{ scale: 1.02 }}
        className="glass p-6 rounded-[32px] space-y-4 relative overflow-hidden group cursor-pointer border-none shadow-xl shadow-ice-100/20"
    >
        <div className="flex justify-between items-start relative z-10">
            <div className={clsx("p-4 rounded-2xl bg-opacity-10", color, iconColorClass || `text-${color.split('-')[1]}-600`)}>
                {icon || <Zap size={22} className="stroke-[2.5px]" />}
            </div>
            {trend && (
                <div className={clsx(
                    "flex items-center gap-1 text-[10px] font-black px-3 py-1.5 rounded-full shadow-sm",
                    trendType === 'up' ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                )}>
                    {trendType === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {trend}
                </div>
            )}
        </div>
        <div className="space-y-1 relative z-10">
            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{label}</p>
            <h3 className="text-3xl font-black text-graphite-900 tracking-tighter tabular-nums">{value}</h3>
            {subtext && <p className="text-[10px] font-medium text-graphite-400">{subtext}</p>}
        </div>
    </motion.div>
);

export const Dashboard: React.FC<{ onNavigate?: (id: string) => void }> = ({ onNavigate }) => {
    const { tenant } = useTenant();
    const { showToast } = useToast();
    const { locale, formatDate, formatDateTime } = useLocaleFormat();

    const [period, setPeriod] = useState<Period>('30d');
    const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
    const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
    const [activeTab, setActiveTab] = useState<Platform>('all');
    const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
    const [chartMetric, setChartMetric] = useState<ChartMetric>('leads');
    const [sortKey, setSortKey] = useState<CampaignSortKey>('spend');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const [leads, setLeads] = useState<any[]>([]);
    const [rawPerformanceData, setRawPerformanceData] = useState<any[]>([]);
    const [integrations, setIntegrations] = useState<{meta?: boolean, google?: boolean}>({});

    const [manageModal, setManageModal] = useState<{ platform: 'meta' | 'google' } | null>(null);
    const [manageData, setManageData] = useState<any>(null);
    const [manageLoading, setManageLoading] = useState(false);

    // Meta connection features choice
    const [metaConnectModal, setMetaConnectModal] = useState(false);
    const [metaFeatures, setMetaFeatures] = useState({ ads: true, messaging: true });

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

                // 2. Fetch Real Ads Performance (últimos 90 dias — cobre os filtros today/7d/30d)
                const ninetyDaysAgo = new Date();
                ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
                const ninetyDaysAgoStr = formatter.format(ninetyDaysAgo);

                const { data: perfData } = await supabase
                    .from('ad_performance_daily')
                    .select('*')
                    .eq('tenant_id', tenant.id)
                    .gte('date', ninetyDaysAgoStr)
                    .order('date', { ascending: true });

                setRawPerformanceData(perfData || []);

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
                if (leadData) setLeads(leadData);

            } catch (error) {
                console.error('Error fetching dashboard data:', error);
            }
    }, [tenant?.id, tenant?.timezone]);

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
            showToast('error', 'Erro: Perfil da clínica não identificado. Atualize a página.');
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

            const platformLabel = platform === 'meta' ? 'Meta Ads' : 'Google Ads';
            if (data.type === 'OAUTH_CONNECTED') {
                setIntegrations(prev => ({ ...prev, [platform]: true }));
                showToast('success', `Conta ${platformLabel} conectada com sucesso!`);
                triggerSyncAndRefresh();
            } else {
                showToast('error', data.message || `Erro ao conectar com ${platformLabel}.`);
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
                .select('settings, updated_at')
                .eq('tenant_id', tenant.id)
                .eq('platform', platform)
                .maybeSingle();
            setManageData(data);
        } catch {
            setManageData(null);
        } finally {
            setManageLoading(false);
        }
    };

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
        setIntegrations(prev => ({ ...prev, [platform]: false }));
        showToast('success', 'Conexão desconectada.');
        closeManageModal();
        fetchDashboardData();
    };

    const handleSyncNow = () => {
        showToast('success', 'Sincronização iniciada. Os dados podem levar alguns segundos para atualizar.');
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
        showToast('success', 'Conta de anúncios atualizada.');
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
        showToast('success', 'Conta do Google Ads vinculada com sucesso.');
    };

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    // Fetch adicional sob-demanda quando o período personalizado ultrapassa a janela padrão de 90 dias
    useEffect(() => {
        if (!tenant?.id || period !== 'custom' || !customRange?.from) return;

        const tz = tenant?.timezone || 'America/Sao_Paulo';
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const ninetyDaysAgoStr = formatter.format(ninetyDaysAgo);

        if (customRange.from >= ninetyDaysAgoStr) return;

        (async () => {
            const { data: extraData } = await supabase
                .from('ad_performance_daily')
                .select('*')
                .eq('tenant_id', tenant.id)
                .gte('date', customRange.from)
                .lt('date', ninetyDaysAgoStr)
                .order('date', { ascending: true });

            if (extraData && extraData.length > 0) {
                setRawPerformanceData(prev => {
                    const existingKeys = new Set(prev.map((r: any) => `${r.platform}::${r.date}::${r.campaign_id}`));
                    const merged = [
                        ...extraData.filter((r: any) => !existingKeys.has(`${r.platform}::${r.date}::${r.campaign_id}`)),
                        ...prev,
                    ];
                    return merged.sort((a: any, b: any) => a.date.localeCompare(b.date));
                });
            }
        })();
    }, [tenant?.id, tenant?.timezone, period, customRange?.from]);

    // ── Período selecionado → range de datas (YYYY-MM-DD) ──────────────────
    const dateRange = useMemo(() => {
        const tz = tenant?.timezone || 'America/Sao_Paulo';
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
        const todayStr = formatter.format(new Date());

        if (period === 'today') {
            return { from: todayStr, to: todayStr };
        }
        if (period === '7d') {
            const today = new Date();
            const from = new Date(today);
            from.setDate(from.getDate() - 6);
            return { from: formatter.format(from), to: todayStr };
        }
        if (period === 'custom' && customRange?.from && customRange?.to) {
            return customRange;
        }
        const today = new Date();
        const from = new Date(today);
        from.setDate(from.getDate() - 29);
        return { from: formatter.format(from), to: todayStr };
    }, [period, customRange, tenant?.timezone]);

    // ── Dados filtrados por período + plataforma + campanha ─────────────────
    const filteredData = useMemo(() => {
        return rawPerformanceData.filter((row: any) => {
            if (row.date < dateRange.from || row.date > dateRange.to) return false;
            if (activeTab !== 'all' && row.platform !== activeTab) return false;
            if (selectedCampaign !== 'all' && (row.campaign_name || 'Sem nome') !== selectedCampaign) return false;
            return true;
        });
    }, [rawPerformanceData, dateRange, activeTab, selectedCampaign]);

    // ── Opções do filtro de campanha (respeita período + plataforma) ────────
    const campaignOptions = useMemo(() => {
        const names = new Set<string>();
        rawPerformanceData.forEach((row: any) => {
            if (row.date < dateRange.from || row.date > dateRange.to) return;
            if (activeTab !== 'all' && row.platform !== activeTab) return;
            names.add(row.campaign_name || 'Sem nome');
        });
        return Array.from(names).sort();
    }, [rawPerformanceData, dateRange, activeTab]);

    // Reseta o filtro de campanha se a opção selecionada deixar de existir (ex: troca de plataforma)
    useEffect(() => {
        if (selectedCampaign !== 'all' && !campaignOptions.includes(selectedCampaign)) {
            setSelectedCampaign('all');
        }
    }, [campaignOptions, selectedCampaign]);

    // ── KPIs agregados (linha 1 e 2 dos cards) ──────────────────────────────
    const kpis = useMemo(() => {
        const totSpent = filteredData.reduce((sum: number, d: any) => sum + Number(d.spend_cents || 0), 0) / 100;
        const totRev = filteredData.reduce((sum: number, d: any) => sum + Number(d.revenue_cents || 0), 0) / 100;
        const totLeads = filteredData.reduce((sum: number, d: any) => sum + Number(d.leads_count || 0), 0);
        const totConversions = filteredData.reduce((sum: number, d: any) => sum + Number(d.conversion_count || 0), 0);
        const totImpressions = filteredData.reduce((sum: number, d: any) => sum + Number(d.impressions || 0), 0);
        const totClicks = filteredData.reduce((sum: number, d: any) => sum + Number(d.clicks || 0), 0);

        const conversionRate = totLeads > 0 ? (totConversions / totLeads) * 100 : 0;
        const roas = totSpent > 0 ? totRev / totSpent : 0;
        const ctr = totImpressions > 0 ? (totClicks / totImpressions) * 100 : 0;
        const cpc = totClicks > 0 ? totSpent / totClicks : 0;
        const cpm = totImpressions > 0 ? (totSpent / totImpressions) * 1000 : 0;
        const cpa = totConversions > 0 ? totSpent / totConversions : 0;

        return {
            totalLeads: totLeads.toString(),
            conversion: `${conversionRate.toFixed(1)}%`,
            spent: formatCurrency(totSpent),
            roas: `${roas.toFixed(1)}x`,
            impressions: totImpressions.toLocaleString('pt-BR'),
            clicks: totClicks.toLocaleString('pt-BR'),
            ctr: `${ctr.toFixed(2)}%`,
            cpc: formatCurrency(cpc),
            cpm: formatCurrency(cpm),
            cpa: formatCurrency(cpa),
        };
    }, [filteredData]);

    // ── Série do gráfico (Meta x Google) de acordo com a métrica escolhida ──
    const chartData = useMemo(() => {
        const byDate: Record<string, { meta: PlatformBucket; google: PlatformBucket }> = {};

        filteredData.forEach((row: any) => {
            const date = row.date;
            if (!byDate[date]) {
                byDate[date] = {
                    meta: { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 },
                    google: { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 },
                };
            }
            const bucket = row.platform === 'meta' ? byDate[date].meta : row.platform === 'google' ? byDate[date].google : null;
            if (!bucket) return;
            bucket.spend += Number(row.spend_cents || 0) / 100;
            bucket.impressions += Number(row.impressions || 0);
            bucket.clicks += Number(row.clicks || 0);
            bucket.leads += Number(row.leads_count || 0);
            bucket.conversions += Number(row.conversion_count || 0);
        });

        const metricValue = (b: PlatformBucket) => {
            switch (chartMetric) {
                case 'spend': return b.spend;
                case 'impressions': return b.impressions;
                case 'clicks': return b.clicks;
                case 'conversions': return b.conversions;
                case 'ctr': return b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0;
                case 'cpc': return b.clicks > 0 ? b.spend / b.clicks : 0;
                case 'cpm': return b.impressions > 0 ? (b.spend / b.impressions) * 1000 : 0;
                default: return b.leads;
            }
        };

        return Object.keys(byDate).sort().map((date) => ({
            name: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(`${date}T00:00:00`)),
            meta: Number(metricValue(byDate[date].meta).toFixed(2)),
            google: Number(metricValue(byDate[date].google).toFixed(2)),
        }));
    }, [filteredData, chartMetric]);

    // ── Tabela de performance por campanha ──────────────────────────────────
    const campaignTable = useMemo<CampaignRow[]>(() => {
        const byCampaign: Record<string, CampaignRow> = {};

        filteredData.forEach((row: any) => {
            const name = row.campaign_name || 'Sem nome';
            const key = `${row.platform}::${name}`;
            if (!byCampaign[key]) {
                byCampaign[key] = {
                    campaign_name: name,
                    platform: row.platform,
                    spend: 0, impressions: 0, clicks: 0, conversions: 0, leads: 0, revenue: 0,
                    ctr: 0, cpc: 0, cpm: 0, cpa: 0, roas: 0,
                };
            }
            const c = byCampaign[key];
            c.spend += Number(row.spend_cents || 0) / 100;
            c.impressions += Number(row.impressions || 0);
            c.clicks += Number(row.clicks || 0);
            c.conversions += Number(row.conversion_count || 0);
            c.leads += Number(row.leads_count || 0);
            c.revenue += Number(row.revenue_cents || 0) / 100;
        });

        const rows = Object.values(byCampaign).map((c) => ({
            ...c,
            ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
            cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
            cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
            cpa: c.conversions > 0 ? c.spend / c.conversions : 0,
            roas: c.spend > 0 ? c.revenue / c.spend : 0,
        }));

        rows.sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            if (typeof av === 'string' && typeof bv === 'string') {
                return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
            }
            return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
        });

        return rows;
    }, [filteredData, sortKey, sortDir]);

    const handleSort = (key: CampaignSortKey) => {
        if (sortKey === key) {
            setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    // ── Exportação PDF ───────────────────────────────────────────────────────
    const handleExportPDF = () => {
        const doc = new jsPDF();
        const clinicName = tenant?.name || 'Clínica';
        const periodLabel = period === 'custom' && customRange
            ? `${formatDate(customRange.from)} a ${formatDate(customRange.to)}`
            : PERIOD_LABELS[period];

        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('Relatório de Performance — Analytics Pro', 14, 18);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Clínica: ${clinicName}`, 14, 26);
        doc.text(`Período: ${periodLabel}`, 14, 32);
        doc.text(`Gerado em: ${formatDateTime(new Date())}`, 14, 38);

        autoTable(doc, {
            startY: 45,
            head: [['Indicador', 'Valor']],
            body: [
                ['Leads Totais', kpis.totalLeads],
                ['Conversão CRM', kpis.conversion],
                ['Gasto em Ads', kpis.spent],
                ['ROAS Médio', kpis.roas],
                ['Impressões', kpis.impressions],
                ['Cliques', kpis.clicks],
                ['CTR', kpis.ctr],
                ['CPC', kpis.cpc],
                ['CPM', kpis.cpm],
                ['CPA (Custo/Conversão)', kpis.cpa],
            ],
            theme: 'grid',
            headStyles: { fillColor: [0, 129, 251] },
        });

        const afterSummaryY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : 90;

        autoTable(doc, {
            startY: afterSummaryY,
            head: [['Campanha', 'Plataforma', 'Gasto', 'Impressões', 'Cliques', 'CTR', 'CPC', 'CPM', 'Conversões', 'CPA', 'ROAS']],
            body: campaignTable.map(c => [
                c.campaign_name,
                c.platform === 'meta' ? 'Meta' : 'Google',
                formatCurrency(c.spend),
                c.impressions.toLocaleString('pt-BR'),
                c.clicks.toLocaleString('pt-BR'),
                `${c.ctr.toFixed(2)}%`,
                formatCurrency(c.cpc),
                formatCurrency(c.cpm),
                c.conversions.toString(),
                formatCurrency(c.cpa),
                `${c.roas.toFixed(1)}x`,
            ]),
            theme: 'striped',
            headStyles: { fillColor: [15, 23, 42] },
            styles: { fontSize: 8 },
        });

        doc.save(`analytics-pro-${new Date().toISOString().split('T')[0]}.pdf`);
    };

    // ── Exportação Excel ─────────────────────────────────────────────────────
    const handleExportExcel = () => {
        const summarySheet = XLSX.utils.json_to_sheet([
            { Indicador: 'Leads Totais', Valor: kpis.totalLeads },
            { Indicador: 'Conversão CRM', Valor: kpis.conversion },
            { Indicador: 'Gasto em Ads', Valor: kpis.spent },
            { Indicador: 'ROAS Médio', Valor: kpis.roas },
            { Indicador: 'Impressões', Valor: kpis.impressions },
            { Indicador: 'Cliques', Valor: kpis.clicks },
            { Indicador: 'CTR', Valor: kpis.ctr },
            { Indicador: 'CPC', Valor: kpis.cpc },
            { Indicador: 'CPM', Valor: kpis.cpm },
            { Indicador: 'CPA (Custo/Conversão)', Valor: kpis.cpa },
        ]);

        const campaignSheet = XLSX.utils.json_to_sheet(campaignTable.map(c => ({
            Campanha: c.campaign_name,
            Plataforma: c.platform === 'meta' ? 'Meta' : 'Google',
            'Gasto (R$)': Number(c.spend.toFixed(2)),
            Impressões: c.impressions,
            Cliques: c.clicks,
            'CTR (%)': Number(c.ctr.toFixed(2)),
            'CPC (R$)': Number(c.cpc.toFixed(2)),
            'CPM (R$)': Number(c.cpm.toFixed(2)),
            Conversões: c.conversions,
            'CPA (R$)': Number(c.cpa.toFixed(2)),
            ROAS: Number(c.roas.toFixed(2)),
        })));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, summarySheet, 'Resumo');
        XLSX.utils.book_append_sheet(wb, campaignSheet, 'Campanhas');
        XLSX.writeFile(wb, `analytics-pro-${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const isLiveWithoutData = rawPerformanceData.length === 0;
    const hasFilteredData = chartData.length > 0;
    const selectedChartMetricLabel = CHART_METRICS.find(m => m.key === chartMetric)?.label || 'Leads';

    return (
        <div className="px-2 space-y-10 pb-20 max-w-[1440px] mx-auto">
            {/* ── COMMAND CENTER HEADER ────────────────────────────────────────── */}
            <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 pt-4">
                <div className="space-y-2">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-brand-primary/10 rounded-lg">
                                <Activity size={18} className="text-brand-primary animate-pulse" />
                            </div>
                            <span className="text-[10px] font-black uppercase text-brand-primary tracking-widest">Traffio Intelligence 2.0</span>
                        </div>

                    </div>
                    <h2 className="text-5xl font-black text-graphite-900 tracking-tighter leading-tight">
                        Analytics <span className="text-brand-primary italic">Pro</span>
                    </h2>
                    <p className="text-graphite-400 font-medium max-w-lg leading-relaxed">
                        Orquestre seu tráfego pago, gerencie leads de alta intenção e visualize seu ROI em tempo real.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                        <button
                            onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
                            className="px-6 py-4 bg-white border border-ice-100 text-graphite-900 rounded-[24px] text-sm font-black shadow-xl shadow-ice-100/30 hover:bg-ice-50 transition-all flex items-center gap-3 border-none cursor-pointer"
                        >
                            <CalendarIcon size={18} className="text-brand-primary" />
                            {period === 'custom' && customRange ? `${formatDate(customRange.from)} - ${formatDate(customRange.to)}` : PERIOD_LABELS[period]}
                            <ChevronDown size={14} className={clsx("text-graphite-400 transition-transform", showPeriodDropdown && "rotate-180")} />
                        </button>

                        <AnimatePresence>
                            {showPeriodDropdown && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="absolute right-0 mt-2 w-72 bg-white rounded-[24px] border border-ice-100 shadow-2xl p-3 z-50 space-y-1"
                                >
                                    {(['today', '7d', '30d', 'custom'] as const).map((p) => (
                                        <button
                                            key={p}
                                            onClick={() => {
                                                setPeriod(p);
                                                if (p !== 'custom') setShowPeriodDropdown(false);
                                            }}
                                            className={clsx(
                                                "w-full text-left px-4 py-3 rounded-2xl text-xs font-black transition-all border-none cursor-pointer",
                                                period === p ? "bg-brand-primary text-white" : "text-graphite-600 hover:bg-ice-50"
                                            )}
                                        >
                                            {PERIOD_LABELS[p]}
                                        </button>
                                    ))}

                                    {period === 'custom' && (
                                        <div className="pt-2 space-y-2 px-1">
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="date"
                                                    value={customRange?.from || ''}
                                                    onChange={(e) => setCustomRange(prev => ({ from: e.target.value, to: prev?.to || e.target.value }))}
                                                    className="flex-1 px-3 py-2 bg-ice-50 rounded-xl text-xs font-bold text-graphite-900 border-none"
                                                />
                                                <span className="text-graphite-400 text-xs font-black">até</span>
                                                <input
                                                    type="date"
                                                    value={customRange?.to || ''}
                                                    onChange={(e) => setCustomRange(prev => ({ from: prev?.from || e.target.value, to: e.target.value }))}
                                                    className="flex-1 px-3 py-2 bg-ice-50 rounded-xl text-xs font-bold text-graphite-900 border-none"
                                                />
                                            </div>
                                            <button
                                                onClick={() => setShowPeriodDropdown(false)}
                                                disabled={!customRange?.from || !customRange?.to}
                                                className="w-full py-2 bg-brand-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest border-none cursor-pointer disabled:opacity-40"
                                            >
                                                Aplicar
                                            </button>
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <button
                        onClick={handleExportPDF}
                        className="px-5 py-4 bg-white border border-ice-100 text-graphite-900 rounded-[24px] text-xs font-black shadow-xl shadow-ice-100/30 hover:bg-ice-50 transition-all flex items-center gap-2 border-none cursor-pointer"
                    >
                        <FileText size={16} className="text-red-500" />
                        PDF
                    </button>

                    <button
                        onClick={handleExportExcel}
                        className="px-5 py-4 bg-white border border-ice-100 text-graphite-900 rounded-[24px] text-xs font-black shadow-xl shadow-ice-100/30 hover:bg-ice-50 transition-all flex items-center gap-2 border-none cursor-pointer"
                    >
                        <FileSpreadsheet size={16} className="text-green-600" />
                        Excel
                    </button>

                    <button
                        onClick={() => onNavigate?.('agenda')}
                        className="px-8 py-4 bg-brand-primary text-white rounded-[24px] text-sm font-black shadow-2xl shadow-brand-primary/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-3 border-none cursor-pointer"
                    >
                        <Plus size={18} className="stroke-[3px]" />
                        Nova Consulta
                    </button>
                </div>
            </header>

            {/* ── FILTROS AVANÇADOS ────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex bg-ice-100/50 p-1 rounded-2xl">
                    {(['all', 'meta', 'google'] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={clsx(
                                "px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border-none cursor-pointer",
                                activeTab === tab ? "bg-white text-graphite-900 shadow-sm" : "text-graphite-400 hover:text-graphite-600"
                            )}
                        >
                            {tab === 'all' ? 'Todas Plataformas' : tab === 'meta' ? 'Meta Ads' : 'Google Ads'}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2 bg-white border border-ice-100 rounded-2xl px-4 py-2.5 shadow-sm">
                    <Filter size={14} className="text-graphite-400" />
                    <select
                        value={selectedCampaign}
                        onChange={(e) => setSelectedCampaign(e.target.value)}
                        className="bg-transparent border-none text-[11px] font-black text-graphite-900 cursor-pointer focus:outline-none max-w-[220px]"
                    >
                        <option value="all">Todas as Campanhas</option>
                        {campaignOptions.map((name) => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* ── KPI GRID (PRINCIPAL) ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Leads Totais" value={kpis.totalLeads} subtext="Volume funnel no período" trend="+12%" trendType="up" color="bg-brand-primary" />
                <StatCard label="Conversão CRM" value={kpis.conversion} subtext="Leads p/ Agendados" trend="+0.5%" trendType="up" color="bg-blue-500" />
                <StatCard label="Gasto Ads" value={kpis.spent} subtext={PERIOD_LABELS[period]} trend="-2%" trendType="down" color="bg-orange-500" />
                <StatCard label="ROAS Médio" value={kpis.roas} subtext="Investimento x Faturamento" trend="+1.2x" trendType="up" color="bg-graphite-900" />
            </div>

            {/* ── KPI GRID (MÍDIA — métricas nativas das plataformas) ────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <StatCard label="Impressões" value={kpis.impressions} subtext="Alcance total" color="bg-purple-500" iconColorClass="text-purple-600" icon={<Eye size={20} className="stroke-[2.5px]" />} />
                <StatCard label="Cliques" value={kpis.clicks} subtext="Engajamento" color="bg-cyan-500" iconColorClass="text-cyan-600" icon={<MousePointerClick size={20} className="stroke-[2.5px]" />} />
                <StatCard label="CTR" value={kpis.ctr} subtext="Cliques / Impressões" color="bg-pink-500" iconColorClass="text-pink-600" icon={<Target size={20} className="stroke-[2.5px]" />} />
                <StatCard label="CPC" value={kpis.cpc} subtext="Custo por Clique" color="bg-amber-500" iconColorClass="text-amber-600" icon={<DollarSign size={20} className="stroke-[2.5px]" />} />
                <StatCard label="CPM" value={kpis.cpm} subtext="Custo / Mil Impressões" color="bg-indigo-500" iconColorClass="text-indigo-600" icon={<TrendingUp size={20} className="stroke-[2.5px]" />} />
                <StatCard label="CPA" value={kpis.cpa} subtext="Custo por Conversão" color="bg-rose-500" iconColorClass="text-rose-600" icon={<Zap size={20} className="stroke-[2.5px]" />} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
                {/* ── TRAFFIC VOLUME CHART (RECHARTS) ───────────────────────────── */}
                <div className="xl:col-span-2 space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <h4 className="text-2xl font-black tracking-tight flex items-center gap-3">
                            <BarChart3 className="text-brand-primary" />
                            Evolução de Tráfego
                        </h4>
                        <select
                            value={chartMetric}
                            onChange={(e) => setChartMetric(e.target.value as ChartMetric)}
                            className="px-4 py-2 bg-ice-100/50 rounded-2xl text-[10px] font-black uppercase text-graphite-600 border-none cursor-pointer focus:outline-none"
                        >
                            {CHART_METRICS.map((m) => (
                                <option key={m.key} value={m.key}>{m.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="glass p-8 rounded-[40px] h-[400px] border-none shadow-2xl shadow-ice-100/20 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-full opacity-[0.03] pointer-events-none">
                            <div className="absolute inset-0 bg-gradient-to-br from-brand-primary to-transparent"></div>
                        </div>

                        {isLiveWithoutData ? (
                            <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
                                <div className="p-6 bg-white rounded-full shadow-xl shadow-ice-100/30">
                                    <BarChart3 size={40} className="text-ice-100" />
                                </div>
                                <p className="text-xs font-black text-graphite-400 uppercase tracking-widest text-center px-20">
                                    Aguardando integração. Suas métricas de tráfego aparecerão aqui após conectar as contas de Ads.
                                </p>
                            </div>
                        ) : !hasFilteredData ? (
                            <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
                                <div className="p-6 bg-white rounded-full shadow-xl shadow-ice-100/30">
                                    <Filter size={40} className="text-ice-100" />
                                </div>
                                <p className="text-xs font-black text-graphite-400 uppercase tracking-widest text-center px-20">
                                    Nenhum dado para os filtros selecionados neste período.
                                </p>
                            </div>
                        ) : (
                            <>
                                <ResponsiveContainer width="99%" minHeight={300}>
                                    <AreaChart data={chartData}>
                                        <defs>
                                            <linearGradient id="colorMeta" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#0081FB" stopOpacity={0.8}/>
                                                <stop offset="95%" stopColor="#0081FB" stopOpacity={0}/>
                                            </linearGradient>
                                            <linearGradient id="colorGoogle" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#34A853" stopOpacity={0.8}/>
                                                <stop offset="95%" stopColor="#34A853" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <XAxis
                                            dataKey="name"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 900 }}
                                        />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                        <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
                                        <Tooltip
                                            contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                                            itemStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase' }}
                                            formatter={(value: any, name: any) => [value, name === 'meta' ? `Meta · ${selectedChartMetricLabel}` : `Google · ${selectedChartMetricLabel}`]}
                                        />
                                        {(activeTab === 'all' || activeTab === 'meta') && (
                                            <Area
                                                type="monotone"
                                                dataKey="meta"
                                                stroke="#0081FB"
                                                strokeWidth={4}
                                                fillOpacity={1}
                                                fill="url(#colorMeta)"
                                            />
                                        )}
                                        {(activeTab === 'all' || activeTab === 'google') && (
                                            <Area
                                                type="monotone"
                                                dataKey="google"
                                                stroke="#34A853"
                                                strokeWidth={4}
                                                fillOpacity={1}
                                                fill="url(#colorGoogle)"
                                            />
                                        )}
                                    </AreaChart>
                                </ResponsiveContainer>
                            </>
                        )}
                    </div>
                </div>

                {/* ── ADS INTEGRATION DRAWER (OAUTH) ───────────────────────────── */}
                <div className="space-y-8">
                    <div className="flex items-center justify-between">
                        <h4 className="text-2xl font-black tracking-tight">Conexões Ads</h4>
                        <LinkIcon size={20} className="text-graphite-400" />
                    </div>

                    <div className="space-y-5">
                         {/* Meta Ads Card */}
                         <div className="glass p-6 rounded-[32px] border-none shadow-xl shadow-blue-100/20 bg-gradient-to-br from-white to-blue-50/30 group">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 bg-[#0081FB] rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                                        <Facebook className="text-white" fill="white" size={28} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-black text-graphite-900 tracking-tight">Meta Hub (Ads &amp; Mensagens)</p>
                                        <div className="flex items-center gap-2">
                                            {integrations.meta ? (
                                                <div className="flex items-center gap-1">
                                                    <div className="w-1 h-1 bg-green-500 rounded-full"></div>
                                                    <span className="text-[8px] font-black text-green-600 uppercase tracking-widest">Ativo</span>
                                                </div>
                                            ) : (
                                                <span className="text-[8px] text-blue-600 font-black uppercase tracking-widest">Recomendado</span>
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
                                Centralize anúncios do Facebook/Instagram e gerencie conversas do Instagram DM e Messenger em tempo real.
                            </p>
                            <button
                                onClick={() => integrations.meta ? openManageModal('meta') : setMetaConnectModal(true)}
                                className={clsx(
                                    "w-full py-4 rounded-2xl font-black text-xs shadow-xl transition-all border-none cursor-pointer flex items-center justify-center gap-2",
                                    integrations.meta
                                        ? "bg-green-50 text-green-600 shadow-green-500/5 hover:bg-green-100"
                                        : "bg-[#0081FB] text-white shadow-blue-500/20 hover:translate-y-[-2px] active:scale-95"
                                )}
                            >
                                {integrations.meta ? <ShieldCheck size={16} /> : null}
                                {integrations.meta ? "Gerenciar Conexão" : "Conectar Conta Meta"}
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
                                        <p className="text-sm font-black text-graphite-900 tracking-tight">Google Ads Hub</p>
                                        <div className="flex items-center gap-2">
                                            {integrations.google ? (
                                                <div className="flex items-center gap-1">
                                                    <div className="w-1 h-1 bg-green-500 rounded-full"></div>
                                                    <span className="text-[8px] font-black text-green-600 uppercase tracking-widest">Ativo</span>
                                                </div>
                                            ) : (
                                                <span className="text-[8px] text-green-600 font-black uppercase tracking-widest">Tráfego Local</span>
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
                                Meça conversões de pesquisa do Google. Foco total em agendamentos diretos.
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
                                {integrations.google ? "Gerenciar Conexão" : "Conectar Google Ads"}
                            </button>
                         </div>

                         {/* AI Command Banner */}
                         <div className="p-8 bg-gradient-to-br from-brand-primary to-blue-600 rounded-[40px] text-white space-y-4 relative overflow-hidden group">
                            <div className="relative z-10 space-y-4">
                                <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20">
                                    <Smartphone size={24} className="text-white" />
                                </div>
                                <h5 className="text-2xl font-black leading-tight tracking-tight">
                                    Sugestão de Performance
                                </h5>
                                <p className="text-[12px] text-white/80 font-medium leading-relaxed">
                                    {isLiveWithoutData ?
                                        "Após conectar suas contas, nossa IA analisará o CPL e sugerirá remanejamento de orçamento em tempo real." :
                                        "Identificamos que Meta Ads está com CPL 30% menor nesta semana. Recomendamos migrar 15% do orçamento para o Gerenciador de Anúncios."
                                    }
                                </p>
                                <button className="px-6 py-3 bg-white text-brand-primary rounded-xl font-black text-[10px] uppercase tracking-tighter hover:bg-ice-50 transition-colors border-none cursor-pointer shadow-lg shadow-brand-primary/20">
                                    {isLiveWithoutData ? "Ver Simulação" : "Aplicar via Agente IA"}
                                </button>
                            </div>
                            <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-10 rounded-full group-hover:scale-110 transition-transform duration-1000"></div>
                         </div>
                    </div>
                </div>
            </div>

            {/* ── PERFORMANCE POR CAMPANHA ──────────────────────────────────────── */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h4 className="text-2xl font-black tracking-tight flex items-center gap-3">
                        <BarChart3 className="text-brand-primary" />
                        Performance por Campanha
                    </h4>
                    <span className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">
                        {campaignTable.length} campanha{campaignTable.length === 1 ? '' : 's'}
                    </span>
                </div>

                <div className="glass rounded-[32px] border-none shadow-2xl shadow-ice-100/20 overflow-hidden">
                    {campaignTable.length === 0 ? (
                        <div className="py-16 text-center">
                            <p className="text-xs font-black text-graphite-400 uppercase tracking-widest">
                                Nenhum dado de campanha para os filtros selecionados.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-ice-100">
                                        {CAMPAIGN_COLUMNS.map((col) => (
                                            <th
                                                key={col.key}
                                                onClick={() => handleSort(col.key)}
                                                className="px-4 py-4 text-left text-[10px] font-black uppercase tracking-widest text-graphite-400 cursor-pointer hover:text-graphite-900 transition-colors whitespace-nowrap select-none"
                                            >
                                                <div className="flex items-center gap-1">
                                                    {col.label}
                                                    <ArrowUpDown size={10} className={sortKey === col.key ? "text-brand-primary" : "text-ice-200"} />
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {campaignTable.map((c, i) => (
                                        <tr key={`${c.platform}-${c.campaign_name}-${i}`} className="border-b border-ice-50 last:border-none hover:bg-ice-50/50 transition-colors">
                                            <td className="px-4 py-4 font-black text-graphite-900 text-xs whitespace-nowrap">{c.campaign_name}</td>
                                            <td className="px-4 py-4">
                                                <span className={clsx("text-[9px] font-black uppercase px-2.5 py-1 rounded-full", c.platform === 'meta' ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600")}>
                                                    {c.platform === 'meta' ? 'Meta' : 'Google'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums whitespace-nowrap">{formatCurrency(c.spend)}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums">{c.impressions.toLocaleString('pt-BR')}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums">{c.clicks.toLocaleString('pt-BR')}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums">{c.ctr.toFixed(2)}%</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums whitespace-nowrap">{formatCurrency(c.cpc)}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums whitespace-nowrap">{formatCurrency(c.cpm)}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums">{c.conversions}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums whitespace-nowrap">{formatCurrency(c.cpa)}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums">{c.roas.toFixed(1)}x</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* ── CRM LEADS FEED ──────────────────────────────────────────────── */}
            <div className="space-y-8">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h4 className="text-3xl font-black tracking-tighter">Fluxo <span className="text-brand-primary">Recente</span></h4>
                        <p className="text-xs text-graphite-400 font-medium tracking-tight">Leads qualificados aguardando orquestração.</p>
                    </div>
                    <button className="px-6 py-3 bg-ice-100 rounded-2xl text-[10px] font-black uppercase tracking-widest text-graphite-600 hover:bg-ice-200 transition-all border-none cursor-pointer">Ver Funil Completo</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {leads.length > 0 ? leads.map((lead, i) => (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            key={lead.id}
                            className="glass p-6 rounded-[32px] flex flex-col gap-4 group cursor-pointer border-none shadow-lg shadow-ice-100/30"
                        >
                            <div className="flex justify-between items-start">
                                <div className="w-12 h-12 bg-ice-50 rounded-2xl flex items-center justify-center border border-transparent group-hover:border-brand-primary/20 transition-all ring-4 ring-transparent group-hover:ring-brand-primary/5">
                                    {i % 2 === 0 ? <Facebook size={20} className="text-[#0081FB]" /> : <Instagram size={20} className="text-[#E4405F]" />}
                                </div>
                                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                                    <button className="p-2 bg-ice-50 rounded-xl hover:bg-brand-primary hover:text-white transition-all border-none cursor-pointer"><MousePointer2 size={14} /></button>
                                    <button className="p-2 bg-ice-50 rounded-xl hover:bg-brand-primary hover:text-white transition-all border-none cursor-pointer"><MoreVertical size={14} /></button>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[15px] font-black text-graphite-900 tracking-tight">{lead.full_name}</p>
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                                    <p className="text-[10px] text-graphite-400 font-bold uppercase tracking-tighter">Captura: Form Ads</p>
                                </div>
                            </div>
                            <div className="pt-4 border-t border-ice-100/50 flex items-center justify-between">
                                <span className="text-[9px] font-black uppercase text-graphite-400 bg-ice-50 px-2.5 py-1 rounded-full">3h atrás</span>
                                <div className="flex items-center gap-1 text-brand-primary">
                                    <Zap size={12} fill="currentColor" />
                                    <span className="text-[10px] font-black tracking-tighter">Qualificado</span>
                                </div>
                            </div>
                        </motion.div>
                    )) : (
                        <div className="col-span-full py-20 text-center space-y-4">
                            <div className="w-20 h-20 bg-ice-50 rounded-full mx-auto flex items-center justify-center">
                                <Search size={32} className="text-ice-200" />
                            </div>
                            <p className="text-sm font-black text-graphite-400 italic tracking-tight">O radar de tráfego está ativo, mas nenhum lead novo foi capturado.</p>
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
                            className="relative w-full max-w-md bg-white rounded-[32px] border border-ice-100 shadow-2xl p-8 space-y-6"
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
                                        <h3 className="text-base font-black text-graphite-900 tracking-tight">
                                            {manageModal.platform === 'meta' ? 'Meta Ads Hub' : 'Google Ads Hub'}
                                        </h3>
                                        <span className="text-[10px] font-black text-green-600 uppercase tracking-widest">Ativo</span>
                                    </div>
                                </div>
                                <button
                                    onClick={closeManageModal}
                                    className="p-2 rounded-xl hover:bg-ice-50 border-none cursor-pointer transition-colors"
                                >
                                    <X size={18} className="text-graphite-400" />
                                </button>
                            </div>

                            {manageLoading ? (
                                <div className="py-10 flex items-center justify-center">
                                    <Loader2 className="animate-spin text-brand-primary" size={28} />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {manageModal.platform === 'meta' && (
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">Conta de Anúncios</p>
                                            {(manageData?.settings?.available_ad_accounts?.length > 1) ? (
                                                <select
                                                    value={manageData?.settings?.ad_account_id || ''}
                                                    onChange={(e) => handleChangeAdAccount(e.target.value)}
                                                    className="w-full px-4 py-3 bg-ice-50 rounded-2xl text-sm font-bold text-graphite-900 border-none cursor-pointer"
                                                >
                                                    {manageData.settings.available_ad_accounts.map((acc: any) => (
                                                        <option key={acc.id} value={acc.id}>{acc.name} ({acc.id})</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <p className="text-sm font-bold text-graphite-900">
                                                    {manageData?.settings?.ad_account_id || 'Nenhuma conta vinculada'}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {manageModal.platform === 'google' && (
                                        <div className="space-y-4 border-b border-ice-100/50 pb-4">
                                            {manageData?.settings?.available_customers?.length > 1 ? (
                                                <div className="space-y-2">
                                                    <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">Selecione a Conta Google Ads</p>
                                                    <select
                                                        value={manageData?.settings?.customer_id || ''}
                                                        onChange={(e) => handleChangeGoogleCustomer(e.target.value)}
                                                        className="w-full px-4 py-3 bg-ice-50 rounded-2xl text-sm font-bold text-graphite-900 border-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-primary"
                                                    >
                                                        <option value="">Selecione uma conta...</option>
                                                        {manageData.settings.available_customers.map((cId: string) => (
                                                            <option key={cId} value={cId}>Conta: {formatGoogleCustomerId(cId)}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ) : manageData?.settings?.customer_id ? (
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">Conta Vinculada</p>
                                                    <p className="text-sm font-bold text-graphite-900">
                                                        ID: {formatGoogleCustomerId(manageData.settings.customer_id)}
                                                    </p>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-graphite-400 font-medium leading-relaxed">
                                                    Nenhuma conta de anúncios selecionada. Tente desconectar e se autenticar novamente.
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">Última Sincronização</p>
                                        <p className="text-sm font-bold text-graphite-900">
                                            {manageData?.settings?.last_sync_at
                                                ? formatDateTime(manageData.settings.last_sync_at)
                                                : 'Ainda não sincronizado'}
                                        </p>
                                    </div>

                                    {manageData?.settings?.last_sync_error && (
                                        <div className="p-4 bg-red-50 rounded-2xl flex items-start gap-3">
                                            <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
                                            <p className="text-xs font-bold text-red-600 leading-relaxed">
                                                {manageData.settings.last_sync_error}
                                            </p>
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-3 pt-2">
                                        <button
                                            onClick={handleSyncNow}
                                            className="w-full py-3 bg-brand-primary text-white rounded-2xl font-black text-xs flex items-center justify-center gap-2 border-none cursor-pointer hover:translate-y-[-1px] transition-all"
                                        >
                                            <RefreshCw size={14} />
                                            Sincronizar Agora
                                        </button>
                                        <button
                                            onClick={() => handleDisconnect(manageModal.platform)}
                                            className="w-full py-3 bg-red-50 text-red-600 rounded-2xl font-black text-xs flex items-center justify-center gap-2 border-none cursor-pointer hover:bg-red-100 transition-all"
                                        >
                                            <Unlink size={14} />
                                            Desconectar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ── CONEXÃO META SELEÇÃO DE RECURSOS MODAL ───────────────────────── */}
            <AnimatePresence>
                {metaConnectModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setMetaConnectModal(false)}
                            className="absolute inset-0 bg-graphite-900/40 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="relative w-full max-w-md bg-white rounded-[32px] border border-ice-100 shadow-2xl p-8 space-y-6"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-2xl bg-[#0081FB] flex items-center justify-center shrink-0">
                                        <Facebook className="text-white" fill="white" size={22} />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-black text-graphite-900 tracking-tight">
                                            Conectar ao Meta
                                        </h3>
                                        <p className="text-[10px] font-bold text-graphite-400">Escolha o que deseja habilitar</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setMetaConnectModal(false)}
                                    className="p-2 rounded-xl hover:bg-ice-50 border-none cursor-pointer transition-colors"
                                >
                                    <X size={18} className="text-graphite-400" />
                                </button>
                            </div>

                            <div className="space-y-4">
                                <label className="flex items-start gap-3 p-4 rounded-2xl border-2 border-ice-100 hover:border-brand-primary/30 transition-all cursor-pointer bg-white">
                                    <input
                                        type="checkbox"
                                        checked={metaFeatures.ads}
                                        onChange={(e) => setMetaFeatures(prev => ({ ...prev, ads: e.target.checked }))}
                                        className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
                                    />
                                    <div>
                                        <p className="font-black text-sm text-graphite-900 leading-none">Anúncios (Meta Ads)</p>
                                        <p className="text-[11px] font-bold text-graphite-400 mt-1">
                                            Sincronizar resultados de campanhas e ROI no painel do Analytics Pro.
                                        </p>
                                    </div>
                                </label>

                                <label className="flex items-start gap-3 p-4 rounded-2xl border-2 border-ice-100 hover:border-brand-primary/30 transition-all cursor-pointer bg-white">
                                    <input
                                        type="checkbox"
                                        checked={metaFeatures.messaging}
                                        onChange={(e) => setMetaFeatures(prev => ({ ...prev, messaging: e.target.checked }))}
                                        className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
                                    />
                                    <div>
                                        <p className="font-black text-sm text-graphite-900 leading-none">Mensagens (Instagram &amp; Messenger)</p>
                                        <p className="text-[11px] font-bold text-graphite-400 mt-1">
                                            Receber e responder directs do Instagram e Messenger em tempo real no Atendimento.
                                        </p>
                                    </div>
                                </label>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setMetaConnectModal(false)}
                                    className="flex-1 py-3.5 bg-ice-50 hover:bg-ice-100 text-graphite-600 rounded-2xl font-black text-xs transition-colors border-none cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    disabled={!metaFeatures.ads && !metaFeatures.messaging}
                                    onClick={() => {
                                        const featuresStr = [
                                            metaFeatures.ads ? 'ads' : '',
                                            metaFeatures.messaging ? 'messaging' : ''
                                        ].filter(Boolean).join(',');
                                        handleConnect('meta', featuresStr);
                                        setMetaConnectModal(false);
                                    }}
                                    className="flex-1 py-3.5 bg-[#0081FB] hover:bg-blue-600 text-white rounded-2xl font-black text-xs transition-colors border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Continuar para Facebook
                                </button>
                            </div>
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

function clsx(...classes: any[]) {
    return classes.filter(Boolean).join(' ');
}
