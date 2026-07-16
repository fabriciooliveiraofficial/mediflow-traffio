import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DollarSign,
    TrendingUp,
    CreditCard,
    Calendar,
    CheckCircle2,
    BarChart3,
    PieChart,
    ArrowUpRight,
    Shield,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
    PieChart as RePieChart,
    Pie,
    ResponsiveContainer,
    Tooltip as ReTooltip,
    Legend as ReLegend,
    Cell as ReCell,
} from 'recharts';
import { BillingService } from '../../services/billingService';
import { useTenant } from '../../contexts/TenantContext';
import { useTenantMoney } from '../../hooks/useTenantMoney';
import { KpiCard } from '../ui';

/**
 * FinanceiroReport — aba "Financeiro" de Relatórios (roadmap item 7, 16/07/2026).
 * Extraído de FinancialDashboard.tsx (que agora só cuida da lista de
 * transações + criação de cobrança) — mesma query/lógica de moeda, só
 * relocado. Refaz sua própria leitura de `BillingService.list` só para o
 * denominador do Ticket Médio (duplica uma leitura que a página de
 * transações também faz, aceito para manter os componentes desacoplados).
 */
export function FinanceiroReport() {
    const { t } = useTranslation('tenantAdmin');
    const { tenant } = useTenant();
    // Caixa = domínio operacional: valores já estão na moeda do tenant, sem conversão
    const { formatCents } = useTenantMoney();
    const [summary, setSummary] = useState({ total: 0, paid: 0, pending: 0, overdue: 0 });
    const [analytics, setAnalytics] = useState<any>(null);
    const [records, setRecords] = useState<any[]>([]);

    const fetchData = useCallback(async () => {
        if (!tenant?.id) return;
        try {
            const [list, sum, detailed] = await Promise.all([
                BillingService.list(tenant.id),
                BillingService.getSummary(tenant.id),
                BillingService.getDetailedAnalytics(tenant.id),
            ]);
            setRecords(list);
            setSummary(sum);
            setAnalytics(detailed);
        } catch (err) {
            console.error('Financeiro report fetch error:', err);
        }
    }, [tenant?.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const formatCurrency = formatCents;

    return (
        <div className="space-y-8">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KpiCard label={t('financialDashboard.kpis.totalRevenue')} value={formatCents(summary.total)} icon={DollarSign} accent="success" />
                <KpiCard label={t('financialDashboard.kpis.received')} value={formatCents(summary.paid)} icon={TrendingUp} accent="brand" />
                <KpiCard label={t('financialDashboard.kpis.toReceive')} value={formatCents(summary.pending)} icon={CreditCard} accent="warning" />
                <KpiCard label={t('financialDashboard.kpis.billings')} value={String(records.length)} icon={Calendar} accent="info" />
            </div>

            {/* Payment Hub Analytics */}
            {analytics && (
                <div className="space-y-6">
                    <div className="flex items-center gap-3 pt-4">
                        <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                            <BarChart3 size={20} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-graphite-900">{t('financialDashboard.analytics.sectionTitle')}</h3>
                            <p className="text-xs text-graphite-400 font-bold uppercase tracking-widest">{t('financialDashboard.analytics.sectionSubtitle')}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white p-6 rounded-3xl border-none shadow-float">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                                    <CheckCircle2 size={20} />
                                </div>
                                <div className="flex items-center gap-1 text-emerald-500 font-black text-xs">
                                    <ArrowUpRight size={14} />
                                    <span>{t('financialDashboard.analytics.highApproval')}</span>
                                </div>
                            </div>
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">{t('financialDashboard.analytics.approvalRateLabel')}</p>
                            <h4 className="text-3xl font-black text-graphite-900">{analytics.approvalRate.toFixed(1)}%</h4>
                        </div>

                        <div className="bg-white p-6 rounded-3xl border-none shadow-float">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-10 h-10 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center">
                                    <Shield size={20} />
                                </div>
                            </div>
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">{t('financialDashboard.analytics.financingVolumeLabel')}</p>
                            <h4 className="text-3xl font-black text-graphite-900">{formatCurrency(analytics.totalFinancingVolume)}</h4>
                        </div>

                        <div className="bg-white p-6 rounded-3xl border-none bg-brand-primary/[0.02] shadow-float relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10">
                                <PieChart size={80} />
                            </div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-10 h-10 rounded-xl bg-brand-primary text-white flex items-center justify-center">
                                    <TrendingUp size={20} />
                                </div>
                            </div>
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">{t('financialDashboard.analytics.avgTicketLabel')}</p>
                            <h4 className="text-3xl font-black text-graphite-900">
                                {formatCurrency(
                                    ((analytics.mix.card + analytics.mix.financing) || 0) /
                                    (Math.max(1, records.filter(r => ['credit_card', 'card_machine', 'stripe'].includes(r.payment_method)).length + (analytics.activeProposals || 1)))
                                )}
                            </h4>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Mix Distribution Chart */}
                        <div className="bg-white p-8 rounded-3xl border-none shadow-float">
                            <h4 className="text-sm font-black text-graphite-900 uppercase tracking-widest mb-8">{t('financialDashboard.analytics.mixChartTitle')}</h4>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RePieChart>
                                        <Pie
                                            data={[
                                                { name: t('financialDashboard.analytics.mixPix'), value: analytics.mix.pix },
                                                { name: t('financialDashboard.analytics.mixCard'), value: analytics.mix.card },
                                                { name: t('financialDashboard.analytics.mixFinancing'), value: analytics.mix.financing },
                                                { name: t('financialDashboard.analytics.mixOthers'), value: analytics.mix.others },
                                            ].filter(d => d.value > 0)}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={8}
                                            dataKey="value"
                                        >
                                            <ReCell fill="#0066FF" />
                                            <ReCell fill="#10B981" />
                                            <ReCell fill="#F59E0B" />
                                            <ReCell fill="#64748B" />
                                        </Pie>
                                        <ReTooltip
                                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                            formatter={(value: any) => formatCurrency(Number(value || 0))}
                                        />
                                        <ReLegend verticalAlign="bottom" height={36}/>
                                    </RePieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Conversion Context */}
                        <div className="bg-graphite-900 p-8 rounded-3xl border-none shadow-float relative overflow-hidden text-white">
                            <div className="absolute top-[-10%] right-[-10%] w-64 h-64 bg-brand-primary/10 rounded-full blur-3xl"></div>
                            <h4 className="text-sm font-black uppercase tracking-widest mb-6 opacity-60">{t('financialDashboard.analytics.pipelineTitle')}</h4>

                            <div className="space-y-6 relative z-10">
                                <div>
                                    <div className="flex justify-between items-end mb-2">
                                        <span className="text-xs font-bold uppercase">{t('financialDashboard.analytics.activeProposalsLabel')}</span>
                                        <span className="text-xl font-black">{analytics.activeProposals}</span>
                                    </div>
                                    <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: '40%' }}
                                            className="h-full bg-brand-primary"
                                        />
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-white/5">
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-emerald-400">
                                            <CheckCircle2 size={24} />
                                        </div>
                                        <div>
                                            <p className="text-lg font-black italic">{t('financialDashboard.analytics.conversionOptimizedTitle')}</p>
                                            <p className="text-xs font-medium opacity-60 leading-relaxed">
                                                {t('financialDashboard.analytics.conversionOptimizedDescription')}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
