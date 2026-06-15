import React, { useEffect, useState, useCallback } from 'react';
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
    BarChart3,
    ShieldCheck,
    X,
    Loader2,
    RefreshCw,
    Unlink,
    AlertCircle
} from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { 
    AreaChart, 
    Area, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ResponsiveContainer
} from 'recharts';



const StatCard = ({ label, value, subtext, trend, trendType, color }: {
    label: string, value: string, subtext?: string, trend: string, trendType: 'up' | 'down', color: string
}) => (
    <motion.div
        whileHover={{ scale: 1.02 }}
        className="glass p-6 rounded-[32px] space-y-4 relative overflow-hidden group cursor-pointer border-none shadow-xl shadow-ice-100/20"
    >
        <div className="flex justify-between items-start relative z-10">
            <div className={`p-4 rounded-2xl ${color} bg-opacity-10 text-${color.split('-')[1]}-600`}>
                <Zap size={22} className="stroke-[2.5px]" />
            </div>
            <div className={clsx(
                "flex items-center gap-1 text-[10px] font-black px-3 py-1.5 rounded-full shadow-sm",
                trendType === 'up' ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
            )}>
                {trendType === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {trend}
            </div>
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
    const [period] = useState<'today' | '7d' | '30d' | 'all'>('7d');
    const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
    const [activeTab, setActiveTab] = useState<'all' | 'meta' | 'google'>('all');
    

    const [leads, setLeads] = useState<any[]>([]);
    const [performanceData, setPerformanceData] = useState<any[]>([]);
    const [integrations, setIntegrations] = useState<{meta?: boolean, google?: boolean}>({});
    const [stats, setStats] = useState({
        totalLeads: '0',
        conversion: '0%',
        spent: 'R$ 0,00',
        roas: '0x',
        vagas: '15'
    });

    const [manageModal, setManageModal] = useState<{ platform: 'meta' | 'google' } | null>(null);
    const [manageData, setManageData] = useState<any>(null);
    const [manageLoading, setManageLoading] = useState(false);

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

                // 2. Fetch Real Ads Performance
                const { data: perfData } = await supabase
                    .from('ad_performance_daily')
                    .select('*')
                    .eq('tenant_id', tenant.id)
                    .order('date', { ascending: true });

                if (perfData && perfData.length > 0) {
                    // Aggregate for Chart
                    const chartFriendly = perfData.map(d => ({
                        name: new Date(d.date).toLocaleDateString('pt-BR', { weekday: 'short' }),
                        meta: d.platform === 'meta' ? d.leads_count : 0,
                        google: d.platform === 'google' ? d.leads_count : 0,
                        spend: Number(d.spend_cents) / 100
                    }));
                    setPerformanceData(chartFriendly);

                    // Update Top Stats
                    const totSpent = perfData.reduce((sum, d) => sum + Number(d.spend_cents), 0) / 100;
                    const totRev = perfData.reduce((sum, d) => sum + Number(d.revenue_cents), 0) / 100;
                    const totLeads = perfData.reduce((sum, d) => sum + Number(d.leads_count), 0);
                    const totConversions = perfData.reduce((sum, d) => sum + Number(d.conversion_count), 0);
                    
                    const conversionRate = totLeads > 0 ? (totConversions / totLeads) * 100 : 0;
                    const roas = totSpent > 0 ? (totRev / totSpent) : 0;

                    setStats(prev => ({
                        ...prev,
                        totalLeads: totLeads.toString(),
                        conversion: `${conversionRate.toFixed(1)}%`,
                        spent: `R$ ${totSpent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                        roas: `${roas.toFixed(1)}x`,
                        vagas: '15'
                    }));
                } else {
                    // Reset stats to 0 if no real performance data
                    setStats(prev => ({
                        ...prev,
                        totalLeads: '0',
                        conversion: '0.0%',
                        spent: 'R$ 0,00',
                        roas: '0.0x',
                        vagas: '15'
                    }));
                    setPerformanceData([]);
                }

                // Quick Agenda
                const todayStr = new Date().toISOString().split('T')[0];
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
    }, [tenant?.id]);

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

    const handleConnect = (platform: 'meta' | 'google') => {
        if (!tenant?.id) {
            showToast('error', 'Erro: Perfil da clínica não identificado. Atualize a página.');
            return;
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fyyhxmugxcfqhvoevuwf.supabase.co';
        const functionUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/auth-${platform}`;
        const redirectBack = window.location.origin;
        const authUrl = `${functionUrl}?tenant_id=${tenant.id}&redirect_back=${encodeURIComponent(redirectBack)}`;

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
            popup?.close();

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
                    popup?.close();
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

    const currentChartData = performanceData;
    const isLiveWithoutData = currentChartData.length === 0;

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
                            {period === '7d' ? 'Últimos 7 Dias' : period === '30d' ? 'Últimos 30 Dias' : 'Tudo'}
                        </button>
                    </div>

                    <button 
                        onClick={() => onNavigate?.('agenda')}
                        className="px-8 py-4 bg-brand-primary text-white rounded-[24px] text-sm font-black shadow-2xl shadow-brand-primary/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-3 border-none cursor-pointer"
                    >
                        <Plus size={18} className="stroke-[3px]" />
                        Nova Consulta
                    </button>
                </div>
            </header>

            {/* ── KPI GRID ────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Leads Totais" value={stats.totalLeads} subtext="Volume funnel geral" trend="+12%" trendType="up" color="bg-brand-primary" />
                <StatCard label="Conversão CRM" value={stats.conversion} subtext="Leads p/ Agendados" trend="+0.5%" trendType="up" color="bg-blue-500" />
                <StatCard label="Gasto Ads" value={stats.spent} subtext="Fevereiro (Meta/Google)" trend="-2%" trendType="down" color="bg-orange-500" />
                <StatCard label="ROAS Médio" value={stats.roas} subtext="Investimento x Faturamento" trend="+1.2x" trendType="up" color="bg-graphite-900" />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
                {/* ── TRAFFIC VOLUME CHART (RECHARTS) ───────────────────────────── */}
                <div className="xl:col-span-2 space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <h4 className="text-2xl font-black tracking-tight flex items-center gap-3">
                            <BarChart3 className="text-brand-primary" />
                            Evolução de Tráfego
                        </h4>
                        <div className="flex bg-ice-100/50 p-1 rounded-2xl">
                            {['all', 'meta', 'google'].map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab as any)}
                                    className={clsx(
                                        "px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border-none cursor-pointer",
                                        activeTab === tab ? "bg-white text-graphite-900 shadow-sm" : "text-graphite-400 hover:text-graphite-600"
                                    )}
                                >
                                    {tab === 'all' ? 'Todos' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>
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
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={currentChartData}>
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
                                        <p className="text-sm font-black text-graphite-900 tracking-tight">Meta Ads Hub</p>
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
                                Centralize resultados do Facebook e Instagram. ROI calculado automaticamente.
                            </p>
                            <button
                                onClick={() => integrations.meta ? openManageModal('meta') : handleConnect('meta')}
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
                                                ? new Date(manageData.settings.last_sync_at).toLocaleString('pt-BR')
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
