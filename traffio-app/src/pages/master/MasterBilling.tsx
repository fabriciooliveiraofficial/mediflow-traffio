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
    BarChart3
} from 'lucide-react';

interface Subscription {
    id: string;
    tenant: string;
    plan: string;
    status: 'active' | 'trial' | 'suspended' | 'canceled';
    mrr: number;
    startDate: string;
    nextBilling: string;
}

const MOCK_SUBS: Subscription[] = [
    { id: '1', tenant: 'Clínica Downtown', plan: 'Professional', status: 'active', mrr: 197, startDate: '2025-06-15', nextBilling: '2026-03-15' },
    { id: '2', tenant: 'Hosp. Santa Vida', plan: 'Enterprise', status: 'active', mrr: 397, startDate: '2025-09-01', nextBilling: '2026-03-01' },
    { id: '3', tenant: 'Consultório Jardins', plan: 'Starter', status: 'trial', mrr: 0, startDate: '2026-02-10', nextBilling: '2026-03-10' },
];

export const MasterBilling = () => {
    const totalMRR = MOCK_SUBS.reduce((sum, s) => sum + s.mrr, 0);
    const activeCount = MOCK_SUBS.filter(s => s.status === 'active').length;
    const trialCount = MOCK_SUBS.filter(s => s.status === 'trial').length;
    const arr = totalMRR * 12;

    const statusConfig: Record<string, { label: string; icon: any; color: string }> = {
        active: { label: 'Ativo', icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
        trial: { label: 'Trial', icon: Clock, color: 'text-sky-400 bg-sky-500/10 border-sky-500/20' },
        suspended: { label: 'Suspenso', icon: AlertTriangle, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
        canceled: { label: 'Cancelado', icon: XCircle, color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto">

            {/* Header */}
            <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 mb-1">Revenue Engine</p>
                <h1 className="text-3xl font-black text-white tracking-tight">Financeiro</h1>
                <p className="text-slate-500 font-medium text-sm mt-1">Gestão de assinaturas e receita recorrente.</p>
            </div>

            {/* Revenue KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'MRR', value: `R$ ${totalMRR.toLocaleString('pt-BR')}`, icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                    { label: 'ARR', value: `R$ ${arr.toLocaleString('pt-BR')}`, icon: TrendingUp, color: 'text-sky-400', bg: 'bg-sky-500/10' },
                    { label: 'Clientes Ativos', value: String(activeCount), icon: Users, color: 'text-violet-400', bg: 'bg-violet-500/10' },
                    { label: 'Em Trial', value: String(trialCount), icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                ].map((kpi, idx) => (
                    <div key={idx} className="bg-[#0F1629] border border-[#1E293B] rounded-2xl p-5 hover:border-emerald-500/20 transition-all">
                        <div className="flex items-center gap-3 mb-3">
                            <div className={`w-9 h-9 ${kpi.bg} rounded-lg flex items-center justify-center`}>
                                <kpi.icon size={16} className={kpi.color} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">{kpi.label}</span>
                        </div>
                        <p className="text-2xl font-black text-white">{kpi.value}</p>
                    </div>
                ))}
            </div>

            {/* Subscription Table */}
            <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#1E293B]">
                    <div className="flex items-center gap-3">
                        <BarChart3 size={18} className="text-emerald-400" />
                        <h3 className="font-bold text-white text-sm">Assinaturas</h3>
                    </div>
                    <button className="text-xs font-bold text-slate-500 hover:text-emerald-400 transition-colors bg-transparent border-none cursor-pointer flex items-center gap-1">
                        Exportar <ArrowUpRight size={12} />
                    </button>
                </div>

                {/* Table Header */}
                <div className="hidden md:grid grid-cols-6 gap-4 px-6 py-3 border-b border-[#1E293B]/50">
                    {['Tenant', 'Plano', 'Status', 'MRR', 'Início', 'Próximo Billing'].map(h => (
                        <span key={h} className="text-[10px] font-black uppercase tracking-wider text-slate-600">{h}</span>
                    ))}
                </div>

                {/* Rows */}
                {MOCK_SUBS.map((sub) => {
                    const st = statusConfig[sub.status];
                    return (
                        <div key={sub.id} className="grid grid-cols-1 md:grid-cols-6 gap-2 md:gap-4 px-6 py-4 border-b border-[#1E293B]/30 hover:bg-white/[0.02] transition-colors items-center">
                            <div className="flex items-center gap-2">
                                <CreditCard size={14} className="text-slate-600 hidden md:block" />
                                <span className="font-bold text-sm text-white">{sub.tenant}</span>
                            </div>
                            <span className="text-sm text-slate-400 font-medium">{sub.plan}</span>
                            <div>
                                <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-md border ${st.color}`}>
                                    <st.icon size={10} /> {st.label}
                                </span>
                            </div>
                            <span className="text-sm font-bold text-emerald-400">
                                {sub.mrr > 0 ? `R$ ${sub.mrr}` : '—'}
                            </span>
                            <span className="text-xs text-slate-500">{new Date(sub.startDate).toLocaleDateString('pt-BR')}</span>
                            <span className="text-xs text-slate-500">{new Date(sub.nextBilling).toLocaleDateString('pt-BR')}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
