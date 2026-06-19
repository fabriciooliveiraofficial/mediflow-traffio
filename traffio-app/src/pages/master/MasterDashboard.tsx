import React, { useState, useEffect } from 'react';
import {
    Users,
    Building2,
    MessageSquare,
    TrendingUp,
    Activity,
    Shield,
    ArrowUpRight,
    Server,
    ExternalLink
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export const MasterDashboard = () => {
    const { t } = useTranslation('master');
    const navigate = useNavigate();
    const [stats, setStats] = useState({
        totalTenants: 0,
        activeInstances: 0,
        totalUsers: 0,
        mrr: 0
    });
    const [recentTenants, setRecentTenants] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            setLoading(true);

            // 1. Tenants Count
            const { count: tenantsCount, data: tenantsList, error: tenantsError } = await supabase
                .from('tenants')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .limit(5);

            if (tenantsError) throw tenantsError;

            // 2. Users Count
            // Note: We can't query auth.users directly from client easily without an RPC, 
            // but we can query public.profiles which mirrors users
            const { count: usersCount } = await supabase
                .from('profiles')
                .select('*', { count: 'exact' });

            // 3. Active Z-API Instances
            // Count tenants where zapi_instance_id is set
            const { count: instancesCount } = await supabase
                .from('tenants')
                .select('*', { count: 'exact' })
                .not('zapi_instance_id', 'is', null);

            setStats({
                totalTenants: tenantsCount || 0,
                activeInstances: instancesCount || 0,
                totalUsers: usersCount || 0,
                mrr: (tenantsCount || 0) * 297 // Mock MRR: R$297 per tenant
            });

            setRecentTenants(tenantsList || []);

        } catch (error) {
            console.error('Error fetching master stats:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-black text-white tracking-tight mb-2">{t('dashboard.headerTitle')}</h1>
                <p className="text-slate-400 font-medium">{t('dashboard.headerSubtitle')}</p>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                    title={t('dashboard.kpis.totalTenants')}
                    value={stats.totalTenants}
                    icon={Building2}
                    color="text-emerald-400"
                    bg="bg-emerald-400/10"
                    trend={t('dashboard.kpis.totalTenantsTrend')}
                />
                <KPICard
                    title={t('dashboard.kpis.instances')}
                    value={stats.activeInstances}
                    icon={MessageSquare}
                    color="text-sky-400"
                    bg="bg-sky-400/10"
                    trend={t('dashboard.kpis.instancesTrend')}
                />
                <KPICard
                    title={t('dashboard.kpis.totalUsers')}
                    value={stats.totalUsers}
                    icon={Users}
                    color="text-indigo-400"
                    bg="bg-indigo-400/10"
                    trend={t('dashboard.kpis.totalUsersTrend')}
                />
                <KPICard
                    title={t('dashboard.kpis.mrr')}
                    value={`R$ ${stats.mrr.toLocaleString('pt-BR')}`}
                    icon={TrendingUp}
                    color="text-amber-400"
                    bg="bg-amber-400/10"
                    trend={t('dashboard.kpis.mrrTrend')}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Main Chart / Area (Placeholder for now) */}
                <div className="lg:col-span-2 bg-[#0F1629] border border-[#1E293B] rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500">
                                <Activity size={20} />
                            </div>
                            <h3 className="text-lg font-bold text-white">{t('dashboard.networkActivity.title')}</h3>
                        </div>
                        <select className="bg-[#1A2035] border border-[#2D3B55] text-slate-400 text-xs font-bold rounded-lg px-3 py-1.5 focus:outline-none">
                            <option>{t('dashboard.networkActivity.last7Days')}</option>
                            <option>{t('dashboard.networkActivity.last30Days')}</option>
                        </select>
                    </div>

                    <div className="h-[300px] flex items-center justify-center border border-dashed border-[#2D3B55] rounded-xl bg-[#0B101F]">
                        <p className="text-slate-500 text-sm font-medium flex items-center gap-2">
                            <Shield size={16} />
                            {t('dashboard.networkActivity.comingSoon')}
                        </p>
                    </div>
                </div>

                {/* Recent Tenants */}
                <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-500">
                                <Server size={20} />
                            </div>
                            <h3 className="text-lg font-bold text-white">{t('dashboard.recentTenants.title')}</h3>
                        </div>
                        <button
                            onClick={() => navigate('/master/tenants')}
                            className="text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors border-none bg-transparent cursor-pointer"
                        >
                            {t('dashboard.recentTenants.viewAll')}
                        </button>
                    </div>

                    <div className="space-y-4">
                        {loading ? (
                            <div className="text-slate-500 text-sm text-center py-4">{t('dashboard.recentTenants.loading')}</div>
                        ) : recentTenants.map((tenant) => (
                            <div key={tenant.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#1A2035] border border-[#2D3B55] hover:border-indigo-500/30 transition-colors group cursor-pointer">
                                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                                    <Building2 size={18} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-bold text-white truncate group-hover:text-indigo-400 transition-colors">{tenant.name}</h4>
                                    <p className="text-xs text-slate-500 truncate">{tenant.slug || t('dashboard.recentTenants.noSlug')}</p>
                                </div>
                                <ExternalLink size={14} className="text-slate-600 group-hover:text-white transition-colors" />
                            </div>
                        ))}

                        {recentTenants.length === 0 && !loading && (
                            <div className="text-slate-500 text-sm text-center py-4">{t('dashboard.recentTenants.empty')}</div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

// Helper Component
const KPICard = ({ title, value, icon: Icon, color, bg, trend }: any) => (
    <div className="bg-[#0F1629] border border-[#1E293B] p-6 rounded-2xl hover:border-[#2D3B55] transition-colors">
        <div className="flex items-start justify-between mb-4">
            <div className={`p-3 rounded-xl ${bg} ${color}`}>
                <Icon size={24} />
            </div>
            {trend && (
                <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-400/5 px-2 py-1 rounded-full">
                    <ArrowUpRight size={12} />
                    {trend}
                </div>
            )}
        </div>
        <div>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
            <h3 className="text-2xl font-black text-white">{value}</h3>
        </div>
    </div>
);
