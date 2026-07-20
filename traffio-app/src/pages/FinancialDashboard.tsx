import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CreditCard,
    Download,
    Plus,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    TrendingUp,
} from 'lucide-react';
import { BillingService } from '../services/billingService';
import { supabase } from '../lib/supabase';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useTenantMoney } from '../hooks/useTenantMoney';
import { Button } from '../components/ui';
import { BillingRecordModal } from '../components/billing/BillingRecordModal';

/**
 * FinancialDashboard — lista de transações + criação de cobrança.
 *
 * A partir do reorg de Relatórios (roadmap item 7, 16/07/2026), os KPIs/
 * gráfico de mix de pagamento que viviam aqui foram extraídos para
 * `src/components/reports/FinanceiroReport.tsx` (aba "Financeiro" de
 * Relatórios). Esta página ficou só com a parte operacional: filtrar/marcar
 * pago/cancelar transações e criar novas cobranças.
 */
export const FinancialDashboard = ({ onNavigate }: { onNavigate?: (id: string) => void }) => {
    const { t } = useTranslation('tenantAdmin');
    const { formatDate } = useLocaleFormat();
    // Caixa = domínio operacional: valores já estão na moeda do tenant, sem conversão
    const { formatCentsIn } = useTenantMoney();
    const [records, setRecords] = useState<any[]>([]);
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
            const list = await BillingService.list(tenantId, statusFilter ? { status: statusFilter } : undefined);
            setRecords(list);
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
                    <p className="text-graphite-500 font-medium">{t('financialDashboard.header.subtitleTransactions')}</p>
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
                    <Button variant="secondary" onClick={() => onNavigate?.('reports')}>
                        <TrendingUp size={16} />
                        {t('financialDashboard.header.viewFullReportButton')}
                    </Button>
                    <button
                        onClick={() => setShowNewModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-xl font-bold hover:scale-105 transition-transform shadow-lg shadow-brand-primary/20 border-none cursor-pointer"
                    >
                        <Plus size={18} />
                        {t('financialDashboard.header.newBillingButton')}
                    </button>
                </div>
            </div>

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
                                                {rec.payment_method || t('financialDashboard.transactions.methodFallback')} · {formatDate(rec.due_date || rec.created_at)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${st.bg} ${st.color}`}>{st.label}</span>
                                        <p className="text-sm font-black text-graphite-900 w-28 text-right">{formatCentsIn(rec.amount_cents, rec.currency)}</p>

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
                <BillingRecordModal
                    tenantId={tenantId}
                    timezone={tenant?.timezone}
                    onClose={() => setShowNewModal(false)}
                    onSaved={() => { setShowNewModal(false); fetchData(); }}
                />
            )}
        </div>
    );
};
