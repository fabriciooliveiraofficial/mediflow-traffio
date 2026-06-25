import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DollarSign,
    TrendingUp,
    CreditCard,
    Calendar,
    Download,
    Plus,
    X,
    Save,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    BarChart3,
    PieChart,
    ArrowUpRight,
    Shield
} from 'lucide-react';
import { motion } from 'framer-motion';
import { 
    PieChart as RePieChart, 
    Pie, 
    ResponsiveContainer, 
    Tooltip as ReTooltip, 
    Legend as ReLegend,
    Cell as ReCell
} from 'recharts';
import { BillingService } from '../services/billingService';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useTenantCurrency } from '../hooks/useTenantCurrency';
import { getTenantTodayString } from '../lib/timezoneUtils';

export const FinancialDashboard = () => {
    const { t } = useTranslation('tenantAdmin');
    const { formatDate, formatDateTime } = useLocaleFormat();
    const { formatDual, rateFetchedAt } = useTenantCurrency();
    const [records, setRecords] = useState<any[]>([]);
    const [summary, setSummary] = useState({ total: 0, paid: 0, pending: 0, overdue: 0 });
    const [analytics, setAnalytics] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [tenantId, setTenantId] = useState<string | null>(null);
    const [tenant, setTenant] = useState<any>(null);
    const [showNewModal, setShowNewModal] = useState(false);
    const [statusFilter, setStatusFilter] = useState<string>('');

    // Get tenant
    useEffect(() => {
        supabase.from('members').select('tenant_id').limit(1).single()
            .then(({ data }) => { 
                if (data) {
                    setTenantId(data.tenant_id);
                    supabase.from('tenants').select('*').eq('id', data.tenant_id).single()
                        .then(({ data: tData }) => {
                            if (tData) setTenant(tData);
                        });
                }
            });
    }, []);

    const fetchData = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const [list, sum, detailed] = await Promise.all([
                BillingService.list(tenantId, statusFilter ? { status: statusFilter } : undefined),
                BillingService.getSummary(tenantId),
                BillingService.getDetailedAnalytics(tenantId),
            ]);
            setRecords(list);
            setSummary(sum);
            setAnalytics(detailed);
        } catch (err) {
            console.error('Billing fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [tenantId, statusFilter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleMarkPaid = async (id: string) => {
        await BillingService.markPaid(id);
        fetchData();
    };

    const handleCancel = async (id: string) => {
        if (!confirm(t('financialDashboard.confirmCancel'))) return;
        await BillingService.cancel(id);
        fetchData();
    };

    const formatCurrency = (cents: number) =>
        `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

    // KPI cards de receita: valor convertido grande + valor BRL original pequeno abaixo.
    const dualKpiNode = (cents: number) => {
        const d = formatDual(cents / 100);
        if (!d.secondary) return d.primary;
        return (
            <span>
                {d.primary}
                <span
                    className="block text-xs font-medium text-graphite-400 mt-0.5"
                    title={rateFetchedAt ? `Cotação de ${formatDateTime(rateFetchedAt)}` : undefined}
                >
                    ({d.secondary})
                </span>
            </span>
        );
    };

    const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
        paid: { label: t('financialDashboard.transactions.statusLabels.paid'), color: 'text-emerald-600', bg: 'bg-emerald-100' },
        pending: { label: t('financialDashboard.transactions.statusLabels.pending'), color: 'text-amber-600', bg: 'bg-amber-100' },
        overdue: { label: t('financialDashboard.transactions.statusLabels.overdue'), color: 'text-rose-600', bg: 'bg-rose-100' },
        canceled: { label: t('financialDashboard.transactions.statusLabels.canceled'), color: 'text-graphite-400', bg: 'bg-ice-100' },
        refunded: { label: t('financialDashboard.transactions.statusLabels.refunded'), color: 'text-sky-600', bg: 'bg-sky-100' },
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-graphite-900 tracking-tight">{t('financialDashboard.header.title')}</h1>
                    <p className="text-graphite-500 font-medium">{t('financialDashboard.header.subtitle')}</p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-4 py-2 bg-white border-none shadow-float rounded-xl text-sm font-bold text-graphite-600 cursor-pointer focus:outline-none"
                    >
                        <option value="">{t('financialDashboard.header.filterAll')}</option>
                        <option value="paid">{t('financialDashboard.header.filterPaid')}</option>
                        <option value="pending">{t('financialDashboard.header.filterPending')}</option>
                        <option value="canceled">{t('financialDashboard.header.filterCanceled')}</option>
                    </select>
                    <button
                        onClick={() => setShowNewModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-xl font-bold hover:scale-105 transition-transform shadow-lg shadow-brand-primary/20 border-none cursor-pointer"
                    >
                        <Plus size={18} />
                        {t('financialDashboard.header.newBillingButton')}
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KPICard
                    title={t('financialDashboard.kpis.totalRevenue')}
                    value={dualKpiNode(summary.total)}
                    icon={DollarSign}
                    color="text-emerald-500"
                    bg="bg-emerald-500/10"
                />
                <KPICard
                    title={t('financialDashboard.kpis.received')}
                    value={dualKpiNode(summary.paid)}
                    icon={TrendingUp}
                    color="text-brand-primary"
                    bg="bg-brand-primary/10"
                />
                <KPICard
                    title={t('financialDashboard.kpis.toReceive')}
                    value={dualKpiNode(summary.pending)}
                    icon={CreditCard}
                    color="text-amber-500"
                    bg="bg-amber-500/10"
                />
                <KPICard
                    title={t('financialDashboard.kpis.billings')}
                    value={String(records.length)}
                    icon={Calendar}
                    color="text-sky-500"
                    bg="bg-sky-500/10"
                />
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
                                    (Math.max(1, records.filter(r => r.method === 'credit_card').length + (analytics.activeProposals || 1)))
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
                                                { name: t('financialDashboard.analytics.mixOthers'), value: analytics.mix.others }
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

            {/* Transactions List */}
            <div className="bg-white rounded-3xl border-none shadow-float overflow-hidden">
                <div className="px-8 py-5 border-b border-ice-100 flex justify-between items-center">
                    <h3 className="text-lg font-black text-graphite-900">{t('financialDashboard.transactions.title')}</h3>
                    <button className="flex items-center gap-2 text-xs font-bold text-graphite-400 hover:text-brand-primary transition-colors cursor-pointer border-none bg-transparent">
                        <Download size={14} /> {t('financialDashboard.transactions.exportButton')}
                    </button>
                </div>

                {loading ? (
                    <div className="p-12 text-center text-graphite-400 font-medium">{t('financialDashboard.transactions.loading')}</div>
                ) : records.length === 0 ? (
                    <div className="p-12 text-center text-graphite-400 font-medium">{t('financialDashboard.transactions.empty')}</div>
                ) : (
                    <div className="divide-y divide-ice-100">
                        {records.map((rec) => {
                            const st = statusConfig[rec.status] || statusConfig.pending;
                            return (
                                <div key={rec.id} className="flex items-center justify-between px-8 py-4 hover:bg-ice-50/50 transition-colors group">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${st.bg} ${st.color}`}>
                                            {rec.status === 'paid' ? <CheckCircle2 size={18} /> :
                                                rec.status === 'canceled' ? <XCircle size={18} /> :
                                                    rec.status === 'overdue' ? <AlertTriangle size={18} /> :
                                                        <CreditCard size={18} />}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-graphite-900">{rec.patients?.full_name || t('financialDashboard.transactions.patientFallback')}</p>
                                            <p className="text-[10px] text-graphite-400 font-bold uppercase">
                                                {rec.method || t('financialDashboard.transactions.methodFallback')} · {formatDate(rec.due_date || rec.created_at)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${st.bg} ${st.color}`}>{st.label}</span>
                                        <p className="text-sm font-black text-graphite-900 w-28 text-right">{formatCurrency(rec.amount_cents)}</p>

                                        {/* Actions */}
                                        {rec.status === 'pending' && (
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => handleMarkPaid(rec.id)} className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-none cursor-pointer transition-colors">
                                                    {t('financialDashboard.transactions.payButton')}
                                                </button>
                                                <button onClick={() => handleCancel(rec.id)} className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-50 text-rose-400 hover:bg-rose-100 border-none cursor-pointer transition-colors">
                                                    {t('financialDashboard.transactions.cancelButton')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* New Billing Modal */}
            {showNewModal && tenantId && (
                <NewBillingModal
                    tenantId={tenantId}
                    timezone={tenant?.timezone}
                    onClose={() => setShowNewModal(false)}
                    onSuccess={() => { setShowNewModal(false); fetchData(); }}
                />
            )}
        </div>
    );
};

// ---- KPI Card ----
const KPICard = ({ title, value, icon: Icon, color, bg }: any) => (
    <div className="bg-white p-6 rounded-3xl border-none shadow-float transition-shadow">
        <div className="flex items-start justify-between mb-4">
            <div className={`w-12 h-12 rounded-2xl ${bg} ${color} flex items-center justify-center`}>
                <Icon size={24} />
            </div>
        </div>
        <div>
            <p className="text-sm text-graphite-400 font-bold uppercase tracking-wider mb-1">{title}</p>
            <h4 className="text-2xl font-black text-graphite-900">{value}</h4>
        </div>
    </div>
);

// ---- New Billing Modal ----
const NewBillingModal = ({ tenantId, timezone, onClose, onSuccess }: { tenantId: string; timezone?: string; onClose: () => void; onSuccess: () => void }) => {
    const { t } = useTranslation('tenantAdmin');
    const { showToast } = useToast();
    const [patients, setPatients] = useState<any[]>([]);
    const [form, setForm] = useState({ patient_id: '', amount: '', due_date: '', method: 'pix', notes: '' });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        supabase.from('patients').select('id, full_name').order('full_name').then(({ data }) => {
            if (data) setPatients(data);
        });
    }, []);

    const handleSubmit = async () => {
        if (!form.patient_id || !form.amount) return;
        setSaving(true);
        try {
            await BillingService.create({
                tenant_id: tenantId,
                patient_id: form.patient_id,
                amount_cents: Math.round(parseFloat(form.amount) * 100),
                due_date: form.due_date || getTenantTodayString(timezone),
                method: form.method,
                notes: form.notes,
            });
            onSuccess();
        } catch (err) {
            console.error('Error creating billing:', err);
            showToast('error', t('financialDashboard.newBillingModal.createError'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]" onClick={onClose} />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-white pointer-events-auto w-full max-w-md rounded-3xl shadow-float overflow-hidden border-none">
                    <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50">
                        <h3 className="text-xl font-black text-graphite-900 flex items-center gap-2">
                            <DollarSign className="text-brand-primary" size={24} />
                            {t('financialDashboard.newBillingModal.title')}
                        </h3>
                        <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white border border-ice-100 flex items-center justify-center text-graphite-400 hover:text-brand-primary transition-all cursor-pointer">
                            <X size={20} />
                        </button>
                    </div>
                    <div className="p-8 space-y-5">
                        <div>
                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{t('financialDashboard.newBillingModal.patientLabel')}</label>
                            <select value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })} className="w-full bg-ice-50 border-none shadow-float rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 cursor-pointer focus:outline-none">
                                <option value="">{t('financialDashboard.newBillingModal.selectPlaceholder')}</option>
                                {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{t('financialDashboard.newBillingModal.amountLabel')}</label>
                                <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="150.00" className="w-full bg-ice-50 border-none shadow-float rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none" />
                            </div>
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{t('financialDashboard.newBillingModal.dueDateLabel')}</label>
                                <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="w-full bg-ice-50 border-none shadow-float rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none" />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{t('financialDashboard.newBillingModal.methodLabel')}</label>
                            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="w-full bg-ice-50 border-none shadow-float rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 cursor-pointer focus:outline-none">
                                <option value="pix">{t('financialDashboard.newBillingModal.methodPix')}</option>
                                <option value="credit_card">{t('financialDashboard.newBillingModal.methodCreditCard')}</option>
                                <option value="boleto">{t('financialDashboard.newBillingModal.methodBoleto')}</option>
                                <option value="cash">{t('financialDashboard.newBillingModal.methodCash')}</option>
                            </select>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={onClose} className="flex-1 py-3.5 rounded-2xl font-bold text-graphite-700 hover:bg-ice-50 border border-ice-100 transition-all cursor-pointer">{t('financialDashboard.newBillingModal.cancelButton')}</button>
                            <button onClick={handleSubmit} disabled={saving || !form.patient_id || !form.amount} className="flex-[2] bg-brand-primary text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 border-none cursor-pointer">
                                <Save size={18} />
                                {saving ? t('financialDashboard.newBillingModal.creating') : t('financialDashboard.newBillingModal.createButton')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
