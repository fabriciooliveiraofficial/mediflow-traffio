import { useState } from 'react';
import {
    ScrollText,
    Filter,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Shield,
    Database,
    Server,
    Wifi,
    Clock,
    Activity
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

type LogType = 'auth' | 'phi' | 'billing' | 'system' | 'error';

interface LogEntry {
    id: string;
    timestamp: string;
    type: LogType;
    message: string;
    user?: string;
    tenant?: string;
}

const MOCK_LOGS: LogEntry[] = [
    { id: '8', timestamp: '2026-02-16T14:45:00', type: 'system', message: 'Servidor de webhook Z-API iniciado na porta 3000', tenant: 'Global' },
    { id: '7', timestamp: '2026-02-16T14:32:00', type: 'auth', message: 'Login via Magic Link', user: 'Dr. Nômade', tenant: 'Clínica Downtown' },
    { id: '6', timestamp: '2026-02-16T14:20:00', type: 'phi', message: 'Visualização de prontuário (medical_records)', user: 'Dr. Nômade', tenant: 'Clínica Downtown' },
    { id: '5', timestamp: '2026-02-16T13:55:00', type: 'billing', message: 'Cobrança Asaas gerada: R$ 150,00 (Pix)', tenant: 'Hosp. Santa Vida' },
    { id: '4', timestamp: '2026-02-16T13:15:00', type: 'auth', message: 'Novo membro adicionado ao tenant', user: 'admin', tenant: 'Consultório Jardins' },
    { id: '3', timestamp: '2026-02-16T12:40:00', type: 'system', message: 'Instância Z-API reconectada automaticamente', tenant: 'Hosp. Santa Vida' },
    { id: '2', timestamp: '2026-02-16T11:00:00', type: 'error', message: 'Falha ao enviar mensagem WhatsApp (timeout)', tenant: 'Clínica Downtown' },
    { id: '1', timestamp: '2026-02-16T09:00:00', type: 'system', message: 'Backup diário automático concluído (3 tenants)', tenant: 'Global' },
];

interface HealthItem {
    name: string;
    status: 'healthy' | 'warning' | 'down';
    latency: string;
    icon: any;
}

export const MasterLogs = () => {
    const { t } = useTranslation('master');
    const [activeFilter, setActiveFilter] = useState<LogType | 'all'>('all');

    const typeConfig: Record<LogType, { label: string; color: string; icon: any }> = {
        auth: { label: t('logs.types.auth'), color: 'text-sky-400 bg-sky-500/10', icon: Shield },
        phi: { label: t('logs.types.phi'), color: 'text-amber-400 bg-amber-500/10', icon: AlertTriangle },
        billing: { label: t('logs.types.billing'), color: 'text-emerald-400 bg-emerald-500/10', icon: CheckCircle2 },
        system: { label: t('logs.types.system'), color: 'text-violet-400 bg-violet-500/10', icon: Server },
        error: { label: t('logs.types.error'), color: 'text-rose-400 bg-rose-500/10', icon: XCircle },
    };

    const HEALTH: HealthItem[] = [
        { name: 'Supabase (PostgreSQL)', status: 'healthy', latency: '12ms', icon: Database },
        { name: t('logs.health.webhookServer'), status: 'healthy', latency: '3ms', icon: Server },
        { name: 'Z-API Gateway', status: 'warning', latency: '210ms', icon: Wifi },
        { name: 'Edge Functions', status: 'healthy', latency: '45ms', icon: Activity },
    ];

    const filtered = activeFilter === 'all'
        ? MOCK_LOGS
        : MOCK_LOGS.filter(l => l.type === activeFilter);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto">

            {/* Header */}
            <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 mb-1">{t('logs.sectionLabel')}</p>
                <h1 className="text-3xl font-black text-white tracking-tight">{t('logs.headerTitle')}</h1>
                <p className="text-slate-500 font-medium text-sm mt-1">{t('logs.headerSubtitle')}</p>
            </div>

            {/* System Health */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {HEALTH.map((h, idx) => (
                    <div key={idx} className="bg-[#0F1629] border border-[#1E293B] rounded-xl p-4 hover:border-emerald-500/20 transition-all">
                        <div className="flex items-center gap-2 mb-2">
                            <h.icon size={14} className={h.status === 'healthy' ? 'text-emerald-400' : h.status === 'warning' ? 'text-amber-400' : 'text-rose-400'} />
                            <span className="text-xs font-bold text-white">{h.name}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${h.status === 'healthy' ? 'bg-emerald-500/10 text-emerald-400' : h.status === 'warning' ? 'bg-amber-500/10 text-amber-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                {h.status === 'healthy' ? t('logs.health.online') : h.status === 'warning' ? t('logs.health.slow') : t('logs.health.offline')}
                            </span>
                            <span className="text-[10px] font-mono text-slate-600">{h.latency}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
                <Filter size={14} className="text-slate-600" />
                {(['all', 'auth', 'phi', 'billing', 'system', 'error'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setActiveFilter(f)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border-none cursor-pointer ${activeFilter === f
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                            : 'bg-[#0F1629] text-slate-500 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        {f === 'all' ? t('logs.filterAll') : typeConfig[f].label}
                    </button>
                ))}
            </div>

            {/* Log Timeline */}
            <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl overflow-hidden">
                <div className="flex items-center gap-3 px-6 py-4 border-b border-[#1E293B]">
                    <ScrollText size={18} className="text-emerald-400" />
                    <h3 className="font-bold text-white text-sm">{t('logs.timeline.title')}</h3>
                    <span className="text-xs text-slate-600 ml-auto">{t('logs.timeline.eventsCount', { count: filtered.length })}</span>
                </div>
                <div className="divide-y divide-[#1E293B]/30">
                    {filtered.map(log => {
                        const cfg = typeConfig[log.type];
                        return (
                            <div key={log.id} className="flex items-start gap-4 px-6 py-4 hover:bg-white/[0.02] transition-colors">
                                <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
                                    <Clock size={10} className="text-slate-700" />
                                    <span className="text-[10px] font-mono text-slate-600 whitespace-nowrap">
                                        {new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${cfg.color}`}>
                                    <cfg.icon size={12} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-300">{log.message}</p>
                                    <div className="flex items-center gap-3 mt-1">
                                        {log.user && <span className="text-[10px] text-slate-600">👤 {log.user}</span>}
                                        {log.tenant && <span className="text-[10px] text-slate-600">🏥 {log.tenant}</span>}
                                    </div>
                                </div>
                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md shrink-0 ${cfg.color}`}>
                                    {cfg.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
