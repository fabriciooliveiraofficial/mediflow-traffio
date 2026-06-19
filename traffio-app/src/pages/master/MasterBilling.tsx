import { useState, useEffect, useMemo } from 'react';
import {
    CreditCard,
    TrendingUp,
    Users,
    CheckCircle2,
    Clock,
    XCircle,
    AlertTriangle,
    DollarSign,
    ArrowUpRight,
    BarChart3,
    Activity,
    ShieldAlert,
    Loader2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';

interface TenantProfitability {
    id: string;
    name: string;
    plan: string;
    status: string;
    balance: number;
    cost: number;
    spent: number;
    profit: number;
    margin: number;
}

export const MasterBilling = () => {
    const { t } = useTranslation('master');
    const [loading, setLoading] = useState(true);
    const [tenants, setTenants] = useState<any[]>([]);
    const [wallets, setWallets] = useState<any[]>([]);
    const [usageLogs, setUsageLogs] = useState<any[]>([]);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [masterBalance, setMasterBalance] = useState<{ balance: number; currency: string } | null>(null);
    const [refreshingBalance, setRefreshingBalance] = useState(false);

    const fetchMasterBalance = async () => {
        setRefreshingBalance(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const res = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telnyx-balance`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            if (res.ok) {
                const data = await res.json();
                setMasterBalance({
                    balance: parseFloat(data.balance) || 0,
                    currency: data.currency || 'USD'
                });
            } else {
                console.error('Failed to fetch Telnyx master balance. Status:', res.status);
            }
        } catch (err) {
            console.error('Error fetching Telnyx master balance:', err);
        } finally {
            setRefreshingBalance(false);
        }
    };

    useEffect(() => {
        const fetchMasterBillingData = async () => {
            setLoading(true);
            try {
                // Fetch tenants
                const { data: tenantsData } = await supabase
                    .from('tenants')
                    .select('id, name, plan, subscription_status, billing_cycle, created_at, subscription_renews_at');
                setTenants(tenantsData ?? []);

                // Fetch wallets
                const { data: walletsData } = await supabase
                    .from('tenant_wallets')
                    .select('*');
                setWallets(walletsData ?? []);

                // Fetch usage logs
                const { data: logsData } = await supabase
                    .from('tenant_usage_log')
                    .select('tenant_id, telnyx_cost_brl, total_price_brl, net_profit_brl');
                setUsageLogs(logsData ?? []);

                // Fetch recharge transactions
                const { data: txsData } = await supabase
                    .from('wallet_transactions')
                    .select('tenant_id, amount_brl, type')
                    .eq('type', 'recharge');
                setTransactions(txsData ?? []);

                // Fetch Telnyx master balance
                await fetchMasterBalance();
            } catch (e) {
                console.error('Error fetching master billing data:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchMasterBillingData();
    }, []);

    const stats = useMemo(() => {
        const planPrices: Record<string, number> = {
            essencial: 197,
            clinica: 397,
            rede: 897
        };
        
        let mrr = 0;
        tenants.forEach(tenant => {
            if (tenant.subscription_status === 'active') {
                const basePrice = planPrices[tenant.plan] || 0;
                mrr += tenant.billing_cycle === 'annual' ? basePrice * 0.8 : basePrice;
            }
        });

        let totalRecharged = 0;
        transactions.forEach(tx => {
            totalRecharged += Number(tx.amount_brl) || 0;
        });

        let totalTelnyxCost = 0;
        let totalTenantSpent = 0;
        let totalNetProfit = 0;

        usageLogs.forEach(l => {
            totalTelnyxCost += Number(l.telnyx_cost_brl) || 0;
            totalTenantSpent += Number(l.total_price_brl) || 0;
            totalNetProfit += Number(l.net_profit_brl) || 0;
        });

        return {
            mrr,
            arr: mrr * 12,
            totalRecharged,
            totalTelnyxCost,
            totalTenantSpent,
            totalNetProfit
        };
    }, [tenants, transactions, usageLogs]);

    const tenantProfitability = useMemo<TenantProfitability[]>(() => {
        return tenants.map(tenant => {
            const wallet = wallets.find(w => w.tenant_id === tenant.id);
            const balance = wallet ? Number(wallet.balance_brl) : 0;

            const tenantLogs = usageLogs.filter(l => l.tenant_id === tenant.id);
            let cost = 0;
            let spent = 0;
            let profit = 0;

            tenantLogs.forEach(l => {
                cost += Number(l.telnyx_cost_brl) || 0;
                spent += Number(l.total_price_brl) || 0;
                profit += Number(l.net_profit_brl) || 0;
            });

            const margin = spent > 0 ? (profit / spent) * 100 : 0;

            return {
                id: tenant.id,
                name: tenant.name,
                plan: tenant.plan || 'essencial',
                status: tenant.subscription_status || 'trial',
                balance,
                cost,
                spent,
                profit,
                margin
            };
        });
    }, [tenants, wallets, usageLogs]);

    const statusConfig: Record<string, { label: string; icon: any; color: string }> = {
        active: { label: t('billing.status.active'), icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
        trial: { label: t('billing.status.trial'), icon: Clock, color: 'text-sky-400 bg-sky-500/10 border-sky-500/20' },
        suspended: { label: t('billing.status.suspended'), icon: AlertTriangle, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
        canceled: { label: t('billing.status.canceled'), icon: XCircle, color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
    };

    if (loading) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center gap-3">
                <Loader2 className="animate-spin text-emerald-400" size={32} />
                <p className="text-slate-400 text-sm font-bold">{t('billing.loadingTitle')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto">

            {/* Header */}
            <div className="flex justify-between items-end">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 mb-1">{t('billing.sectionLabel')}</p>
                    <h1 className="text-3xl font-black text-white tracking-tight">{t('billing.headerTitle')}</h1>
                    <p className="text-slate-500 font-medium text-sm mt-1">{t('billing.headerSubtitle')}</p>
                </div>
                <div className="bg-[#1E293B] border border-slate-700/50 rounded-xl px-4 py-2 flex items-center gap-2 text-slate-300 text-xs font-bold font-mono">
                    <Activity size={14} className="text-emerald-400" /> {t('billing.fixedExchange')}
                </div>
            </div>

            {/* Telnyx Master Account Status Banner */}
            <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl relative overflow-hidden">
                {masterBalance && masterBalance.balance < 20 && (
                    <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500 animate-pulse" />
                )}
                
                <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                        masterBalance && masterBalance.balance < 20
                            ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                            : 'bg-[#1E293B] border-slate-700/50 text-emerald-400'
                    }`}>
                        {masterBalance && masterBalance.balance < 20 ? (
                            <AlertTriangle size={24} className="animate-bounce" />
                        ) : (
                            <Activity size={24} />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h4 className="font-bold text-white text-base">Conta Central Telnyx (Provedor)</h4>
                            {masterBalance && masterBalance.balance < 20 && (
                                <span className="text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/30 animate-pulse">
                                    Saldo Baixo
                                </span>
                            )}
                        </div>
                        <p className="text-slate-500 text-xs mt-1">
                            Saldo global utilizado para custear ligações, SMS e MMS de todas as clínicas da plataforma.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-6 self-end md:self-auto">
                    <div className="text-right">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Crédito Disponível</p>
                        <div className="flex items-baseline gap-2 justify-end mt-1">
                            <span className="text-2xl font-black text-white font-mono">
                                {masterBalance ? `$ ${masterBalance.balance.toFixed(2)}` : '$ --.--'}
                            </span>
                            <span className="text-xs text-slate-400">{masterBalance?.currency ?? 'USD'}</span>
                        </div>
                        {masterBalance && (
                            <p className="text-xs font-mono text-slate-400 mt-0.5">
                                ≈ R$ {(masterBalance.balance * 5.5).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                        )}
                    </div>

                    <button
                        onClick={fetchMasterBalance}
                        disabled={refreshingBalance}
                        className="px-4 py-2.5 bg-[#1E293B] border border-slate-700/50 hover:bg-slate-800 transition-all rounded-xl text-white text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                        {refreshingBalance ? (
                            <Loader2 className="animate-spin" size={14} />
                        ) : (
                            <Clock size={14} />
                        )}
                        Sincronizar Saldo
                    </button>
                </div>
            </div>

            {/* Revenue KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: t('billing.kpis.mrr'), value: `R$ ${stats.mrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                    { label: t('billing.kpis.recharged'), value: `R$ ${stats.totalRecharged.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: CreditCard, color: 'text-sky-400', bg: 'bg-sky-500/10' },
                    { label: t('billing.kpis.telnyxCost'), value: `R$ ${stats.totalTelnyxCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: ShieldAlert, color: 'text-rose-400', bg: 'bg-rose-500/10' },
                    { label: t('billing.kpis.netProfit'), value: `R$ ${stats.totalNetProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/20 border border-emerald-500/30' },
                ].map((kpi, idx) => (
                    <div key={idx} className={`bg-[#0F1629] border border-[#1E293B] rounded-2xl p-5 hover:border-emerald-500/20 transition-all ${idx === 3 ? 'shadow-lg shadow-emerald-950/20' : ''}`}>
                        <div className="flex items-center gap-3 mb-3">
                            <div className={`w-9 h-9 ${kpi.bg} rounded-lg flex items-center justify-center`}>
                                <kpi.icon size={16} className={kpi.color} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{kpi.label}</span>
                        </div>
                        <p className="text-2xl font-black text-white font-mono">{kpi.value}</p>
                    </div>
                ))}
            </div>

            {/* Tabela de Assinaturas de Software */}
            <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl overflow-hidden shadow-xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#1E293B]">
                    <div className="flex items-center gap-3">
                        <BarChart3 size={18} className="text-emerald-400" />
                        <h3 className="font-bold text-white text-sm">{t('billing.subscriptionsTable.title')}</h3>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-[#1E293B] text-[10px] font-black uppercase tracking-wider text-slate-500">
                                <th className="px-6 py-4">{t('billing.subscriptionsTable.columns.tenant')}</th>
                                <th className="px-6 py-4">{t('billing.subscriptionsTable.columns.plan')}</th>
                                <th className="px-6 py-4">{t('billing.subscriptionsTable.columns.status')}</th>
                                <th className="px-6 py-4">{t('billing.subscriptionsTable.columns.billing')}</th>
                                <th className="px-6 py-4 text-right">{t('billing.subscriptionsTable.columns.renewal')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1E293B]/50 text-sm font-medium text-slate-300">
                            {tenants.map((tenant) => {
                                const st = statusConfig[tenant.subscription_status || 'trial'] || statusConfig.trial;
                                return (
                                    <tr key={tenant.id} className="hover:bg-white/[0.01] transition-colors">
                                        <td className="px-6 py-4 font-bold text-white">{tenant.name}</td>
                                        <td className="px-6 py-4 capitalize">{tenant.plan || 'essencial'}</td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase px-2.5 py-0.5 rounded-md border ${st.color}`}>
                                                <st.icon size={10} /> {st.label}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 capitalize font-bold text-slate-400">{tenant.billing_cycle === 'annual' ? t('billing.subscriptionsTable.cycle.annual') : t('billing.subscriptionsTable.cycle.monthly')}</td>
                                        <td className="px-6 py-4 text-right font-mono text-xs text-slate-500">
                                            {tenant.subscription_status === 'trial'
                                                ? tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toLocaleDateString('pt-BR') : '—'
                                                : tenant.subscription_renews_at ? new Date(tenant.subscription_renews_at).toLocaleDateString('pt-BR') : '—'
                                            }
                                        </td>
                                    </tr>
                                );
                            })}
                            {tenants.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-10 text-center text-slate-500 font-bold">{t('billing.subscriptionsTable.empty')}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Tabela de Controle de Consumo e Lucratividade */}
            <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl overflow-hidden shadow-xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#1E293B]">
                    <div className="flex items-center gap-3">
                        <TrendingUp size={18} className="text-emerald-400" />
                        <h3 className="font-bold text-white text-sm">{t('billing.profitabilityTable.title')}</h3>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-[#1E293B] text-[10px] font-black uppercase tracking-wider text-slate-500">
                                <th className="px-6 py-4">{t('billing.profitabilityTable.columns.tenant')}</th>
                                <th className="px-6 py-4 text-right">{t('billing.profitabilityTable.columns.balance')}</th>
                                <th className="px-6 py-4 text-right">{t('billing.profitabilityTable.columns.totalSpent')}</th>
                                <th className="px-6 py-4 text-right">{t('billing.profitabilityTable.columns.telnyxCost')}</th>
                                <th className="px-6 py-4 text-right text-emerald-400">{t('billing.profitabilityTable.columns.netProfit')}</th>
                                <th className="px-6 py-4 text-right">{t('billing.profitabilityTable.columns.margin')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1E293B]/50 text-sm font-medium text-slate-300">
                            {tenantProfitability.map((item) => (
                                <tr key={item.id} className="hover:bg-white/[0.01] transition-colors">
                                    <td className="px-6 py-4 font-bold text-white">{item.name}</td>
                                    <td className={`px-6 py-4 text-right font-mono font-bold ${item.balance < 10 ? 'text-amber-400 animate-pulse' : 'text-slate-200'}`}>
                                        R$ {item.balance.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono">
                                        R$ {item.spent.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-500">
                                        R$ {item.cost.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono font-bold text-emerald-400">
                                        R$ {item.profit.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span className="font-mono text-xs font-bold text-emerald-500">
                                                {item.margin.toFixed(0)}%
                                            </span>
                                            <div className="w-16 bg-slate-800 h-2 rounded-full overflow-hidden hidden sm:block">
                                                <div 
                                                    className="bg-emerald-500 h-full rounded-full" 
                                                    style={{ width: `${Math.min(100, item.margin)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {tenantProfitability.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-10 text-center text-slate-500 font-bold">{t('billing.profitabilityTable.empty')}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
