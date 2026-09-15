import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DollarSign,
    TrendingUp,
    CreditCard,
    Calendar,
    BarChart3,
} from 'lucide-react';
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

            {/* Formas de pagamento — só dados reais de billing_records */}
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <KpiCard label={t('financialDashboard.analytics.avgTicketLabel')} value={formatCurrency(analytics.avgTicketCents)} icon={TrendingUp} accent="brand" />
                        <KpiCard label={t('financialDashboard.analytics.cardShareLabel')} value={`${analytics.cardSharePct.toFixed(1)}%`} icon={CreditCard} accent="info" />
                    </div>

                    <div className="bg-white p-8 rounded-3xl border-none shadow-float">
                        <h4 className="text-sm font-black text-graphite-900 uppercase tracking-widest mb-8">{t('financialDashboard.analytics.mixChartTitle')}</h4>
                        <div className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <RePieChart>
                                    <Pie
                                        data={[
                                            { name: t('financialDashboard.analytics.mixPix'), value: analytics.mix.pix },
                                            { name: t('financialDashboard.analytics.mixCard'), value: analytics.mix.card },
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
                </div>
            )}
        </div>
    );
}
