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
    const [loading, setLoading] = useState(true);
    const [tenants, setTenants] = useState<any[]>([]);
    const [wallets, setWallets] = useState<any[]>([]);
    const [usageLogs, setUsageLogs] = useState<any[]>([]);
    const [transactions, setTransactions] = useState<any[]>([]);

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
        tenants.forEach(t => {
            if (t.subscription_status === 'active') {
                const basePrice = planPrices[t.plan] || 0;
                mrr += t.billing_cycle === 'annual' ? basePrice * 0.8 : basePrice;
            }
        });

        let totalRecharged = 0;
        transactions.forEach(t => {
            totalRecharged += Number(t.amount_brl) || 0;
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
        return tenants.map(t => {
            const wallet = wallets.find(w => w.tenant_id === t.id);
            const balance = wallet ? Number(wallet.balance_brl) : 0;
            
            const tenantLogs = usageLogs.filter(l => l.tenant_id === t.id);
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
                id: t.id,
                name: t.name,
                plan: t.plan || 'essencial',
                status: t.subscription_status || 'trial',
                balance,
                cost,
                spent,
                profit,
                margin
            };
        });
    }, [tenants, wallets, usageLogs]);

    const statusConfig: Record<string, { label: string; icon: any; color: string }> = {
        active: { label: 'Ativo', icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
        trial: { label: 'Trial', icon: Clock, color: 'text-sky-400 bg-sky-500/10 border-sky-500/20' },
        suspended: { label: 'Suspenso', icon: AlertTriangle, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
        canceled: { label: 'Cancelado', icon: XCircle, color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
    };

    if (loading) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center gap-3">
                <Loader2 className="animate-spin text-emerald-400" size={32} />
                <p className="text-slate-400 text-sm font-bold">Carregando painel financeiro...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto">

            {/* Header */}
            <div className="flex justify-between items-end">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 mb-1">Revenue Engine</p>
                    <h1 className="text-3xl font-black text-white tracking-tight">Financeiro & Consumo</h1>
                    <p className="text-slate-500 font-medium text-sm mt-1">Gestão de assinaturas, lucros de comunicações e saldos de carteiras.</p>
                </div>
                <div className="bg-[#1E293B] border border-slate-700/50 rounded-xl px-4 py-2 flex items-center gap-2 text-slate-300 text-xs font-bold font-mono">
                    <Activity size={14} className="text-emerald-400" /> Câmbio Fixo: R$ 5.50
                </div>
            </div>

            {/* Revenue KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'MRR (Software)', value: `R$ ${stats.mrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                    { label: 'Créditos Recarregados', value: `R$ ${stats.totalRecharged.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: CreditCard, color: 'text-sky-400', bg: 'bg-sky-500/10' },
                    { label: 'Custo Telnyx (Fornecedor)', value: `R$ ${stats.totalTelnyxCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: ShieldAlert, color: 'text-rose-400', bg: 'bg-rose-500/10' },
                    { label: 'Lucro Líquido (Telecom)', value: `R$ ${stats.totalNetProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/20 border border-emerald-500/30' },
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
                        <h3 className="font-bold text-white text-sm">Assinaturas de Software</h3>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-[#1E293B] text-[10px] font-black uppercase tracking-wider text-slate-500">
                                <th className="px-6 py-4">Tenant</th>
                                <th className="px-6 py-4">Plano</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Billing</th>
                                <th className="px-6 py-4 text-right">Renovação / Fim Trial</th>
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
                                        <td className="px-6 py-4 capitalize font-bold text-slate-400">{tenant.billing_cycle === 'annual' ? 'Anual' : 'Mensal'}</td>
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
                                    <td colSpan={5} className="px-6 py-10 text-center text-slate-500 font-bold">Nenhum tenant cadastrado.</td>
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
                        <h3 className="font-bold text-white text-sm">Controle de Carteiras & Lucratividade de Comunicações</h3>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-[#1E293B] text-[10px] font-black uppercase tracking-wider text-slate-500">
                                <th className="px-6 py-4">Tenant</th>
                                <th className="px-6 py-4 text-right">Saldo Atual</th>
                                <th className="px-6 py-4 text-right">Total Consumido</th>
                                <th className="px-6 py-4 text-right">Custo Telnyx</th>
                                <th className="px-6 py-4 text-right text-emerald-400">Lucro Líquido</th>
                                <th className="px-6 py-4 text-right">Margem de Lucro</th>
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
                                    <td colSpan={6} className="px-6 py-10 text-center text-slate-500 font-bold">Nenhum consumo registrado ainda.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
