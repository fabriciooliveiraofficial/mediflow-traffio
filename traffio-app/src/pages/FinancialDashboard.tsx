import { useState, useEffect, useCallback } from 'react';
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

export const FinancialDashboard = () => {
    const { formatDate } = useLocaleFormat();
    const [records, setRecords] = useState<any[]>([]);
    const [summary, setSummary] = useState({ total: 0, paid: 0, pending: 0, overdue: 0 });
    const [analytics, setAnalytics] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [tenantId, setTenantId] = useState<string | null>(null);
    const [showNewModal, setShowNewModal] = useState(false);
    const [statusFilter, setStatusFilter] = useState<string>('');

    // Get tenant
    useEffect(() => {
        supabase.from('members').select('tenant_id').limit(1).single()
            .then(({ data }) => { if (data) setTenantId(data.tenant_id); });
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
        if (!confirm('Cancelar esta cobrança?')) return;
        await BillingService.cancel(id);
        fetchData();
    };

    const formatCurrency = (cents: number) =>
        `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

    const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
        paid: { label: 'Pago', color: 'text-emerald-600', bg: 'bg-emerald-100' },
        pending: { label: 'Pendente', color: 'text-amber-600', bg: 'bg-amber-100' },
        overdue: { label: 'Vencido', color: 'text-rose-600', bg: 'bg-rose-100' },
        canceled: { label: 'Cancelado', color: 'text-graphite-400', bg: 'bg-ice-100' },
        refunded: { label: 'Estornado', color: 'text-sky-600', bg: 'bg-sky-100' },
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto pb-12">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-graphite-900 tracking-tight">Financeiro</h1>
                    <p className="text-graphite-500 font-medium">Visão consolidada de todas as suas unidades e conversão de hub.</p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-4 py-2 bg-white border border-ice-200 rounded-xl text-sm font-bold text-graphite-600 cursor-pointer focus:outline-none focus:border-brand-primary"
                    >
                        <option value="">Todos</option>
                        <option value="paid">Pagos</option>
                        <option value="pending">Pendentes</option>
                        <option value="canceled">Cancelados</option>
                    </select>
                    <button
                        onClick={() => setShowNewModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-xl font-bold hover:scale-105 transition-transform shadow-lg shadow-brand-primary/20 border-none cursor-pointer"
                    >
                        <Plus size={18} />
                        Nova Cobrança
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KPICard
                    title="Receita Total"
                    value={formatCurrency(summary.total)}
                    icon={DollarSign}
                    color="text-emerald-500"
                    bg="bg-emerald-500/10"
                />
                <KPICard
                    title="Recebido"
                    value={formatCurrency(summary.paid)}
                    icon={TrendingUp}
                    color="text-brand-primary"
                    bg="bg-brand-primary/10"
                />
                <KPICard
                    title="A Receber"
                    value={formatCurrency(summary.pending)}
                    icon={CreditCard}
                    color="text-amber-500"
                    bg="bg-amber-500/10"
                />
                <KPICard
                    title="Cobranças"
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
                            <h3 className="text-xl font-black text-graphite-900">Conversão de Procedimentos</h3>
                            <p className="text-xs text-graphite-400 font-bold uppercase tracking-widest">Performance Dr. Cash & Pagar.me</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white p-6 rounded-[32px] border border-ice-100 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                                    <CheckCircle2 size={20} />
                                </div>
                                <div className="flex items-center gap-1 text-emerald-500 font-black text-xs">
                                    <ArrowUpRight size={14} />
                                    <span>High Approval</span>
                                </div>
                            </div>
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">Taxa Aprovação Dr. Cash</p>
                            <h4 className="text-3xl font-black text-graphite-900">{analytics.approvalRate.toFixed(1)}%</h4>
                        </div>

                        <div className="bg-white p-6 rounded-[32px] border border-ice-100 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-10 h-10 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center">
                                    <Shield size={20} />
                                </div>
                            </div>
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">Volume de Crédito Assinado</p>
                            <h4 className="text-3xl font-black text-graphite-900">{formatCurrency(analytics.totalFinancingVolume)}</h4>
                        </div>

                        <div className="bg-white p-6 rounded-[32px] border border-brand-primary/20 bg-brand-primary/[0.02] shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10">
                                <PieChart size={80} />
                            </div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-10 h-10 rounded-xl bg-brand-primary text-white flex items-center justify-center">
                                    <TrendingUp size={20} />
                                </div>
                            </div>
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">Ticket Médio (Hub Híbrido)</p>
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
                        <div className="bg-white p-8 rounded-[32px] border border-ice-100 shadow-sm">
                            <h4 className="text-sm font-black text-graphite-900 uppercase tracking-widest mb-8">Mix de Recebimento</h4>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RePieChart>
                                        <Pie
                                            data={[
                                                { name: 'Pix', value: analytics.mix.pix },
                                                { name: 'Cartão (Pagar.me)', value: analytics.mix.card },
                                                { name: 'Financiamento (Dr. Cash)', value: analytics.mix.financing },
                                                { name: 'Outros', value: analytics.mix.others }
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
                        <div className="bg-graphite-900 p-8 rounded-[32px] shadow-2xl relative overflow-hidden text-white">
                            <div className="absolute top-[-10%] right-[-10%] w-64 h-64 bg-brand-primary/10 rounded-full blur-3xl"></div>
                            <h4 className="text-sm font-black uppercase tracking-widest mb-6 opacity-60">Status do Pipeline Dr. Cash</h4>
                            
                            <div className="space-y-6 relative z-10">
                                <div>
                                    <div className="flex justify-between items-end mb-2">
                                        <span className="text-xs font-bold uppercase">Propostas em Análise</span>
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
                                            <p className="text-lg font-black italic">Conversão Otimizada</p>
                                            <p className="text-xs font-medium opacity-60 leading-relaxed">
                                                O uso do Hub Híbrido aumentou o ticket médio em comparação a pagamentos tradicionais em vista.
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
            <div className="bg-white rounded-[32px] border border-ice-200 shadow-sm overflow-hidden">
                <div className="px-8 py-5 border-b border-ice-100 flex justify-between items-center">
                    <h3 className="text-lg font-black text-graphite-900">Cobranças</h3>
                    <button className="flex items-center gap-2 text-xs font-bold text-graphite-400 hover:text-brand-primary transition-colors cursor-pointer border-none bg-transparent">
                        <Download size={14} /> Exportar
                    </button>
                </div>

                {loading ? (
                    <div className="p-12 text-center text-graphite-400 font-medium">Carregando...</div>
                ) : records.length === 0 ? (
                    <div className="p-12 text-center text-graphite-400 font-medium">Nenhuma cobrança encontrada.</div>
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
                                            <p className="text-sm font-bold text-graphite-900">{rec.patients?.full_name || 'Paciente'}</p>
                                            <p className="text-[10px] text-graphite-400 font-bold uppercase">
                                                {rec.method || 'Não definido'} · {formatDate(rec.due_date || rec.created_at)}
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
                                                    Pagar
                                                </button>
                                                <button onClick={() => handleCancel(rec.id)} className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-50 text-rose-400 hover:bg-rose-100 border-none cursor-pointer transition-colors">
                                                    Cancelar
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
                    onClose={() => setShowNewModal(false)}
                    onSuccess={() => { setShowNewModal(false); fetchData(); }}
                />
            )}
        </div>
    );
};

// ---- KPI Card ----
const KPICard = ({ title, value, icon: Icon, color, bg }: any) => (
    <div className="bg-white p-6 rounded-[24px] border border-ice-100 shadow-sm hover:shadow-md transition-shadow">
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
const NewBillingModal = ({ tenantId, onClose, onSuccess }: { tenantId: string; onClose: () => void; onSuccess: () => void }) => {
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
                due_date: form.due_date || new Date().toISOString().split('T')[0],
                method: form.method,
                notes: form.notes,
            });
            onSuccess();
        } catch (err) {
            console.error('Error creating billing:', err);
            showToast('error', 'Erro ao criar cobrança.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]" onClick={onClose} />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-white pointer-events-auto w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden border border-white/20">
                    <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50">
                        <h3 className="text-xl font-black text-graphite-900 flex items-center gap-2">
                            <DollarSign className="text-brand-primary" size={24} />
                            Nova Cobrança
                        </h3>
                        <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 hover:text-brand-primary transition-all cursor-pointer">
                            <X size={20} />
                        </button>
                    </div>
                    <div className="p-8 space-y-5">
                        <div>
                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Paciente</label>
                            <select value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })} className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 cursor-pointer focus:outline-none focus:border-brand-primary">
                                <option value="">Selecione...</option>
                                {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Valor (R$)</label>
                                <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="150.00" className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary" />
                            </div>
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Vencimento</label>
                                <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary" />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">Método</label>
                            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 cursor-pointer focus:outline-none focus:border-brand-primary">
                                <option value="pix">Pix</option>
                                <option value="credit_card">Cartão de Crédito</option>
                                <option value="boleto">Boleto</option>
                                <option value="cash">Dinheiro</option>
                            </select>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={onClose} className="flex-1 py-3.5 rounded-2xl font-bold text-graphite-700 hover:bg-ice-50 border border-ice-200 transition-all cursor-pointer">Cancelar</button>
                            <button onClick={handleSubmit} disabled={saving || !form.patient_id || !form.amount} className="flex-[2] bg-brand-primary text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 border-none cursor-pointer">
                                <Save size={18} />
                                {saving ? 'Criando...' : 'Criar Cobrança'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
