import React from 'react';
import { 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ResponsiveContainer, 
    LineChart, 
    Line, 
    Cell,
    Legend
} from 'recharts';
import { 
    Zap, 
    TrendingUp, 
    Star, 
    Calendar,
    ArrowUpRight,
    ArrowDownRight
} from 'lucide-react';
import { useAutomacaoMetrics } from '../../hooks/useAutomacaoMetrics';
import { clsx } from 'clsx';

interface DesempenhoAutomacoesProps {
    tenantId: string;
    dateRange: { from: Date; to: Date };
}

export const DesempenhoAutomacoes: React.FC<DesempenhoAutomacoesProps> = ({ tenantId, dateRange }) => {
    const { metrics, isLoading } = useAutomacaoMetrics({ tenantId, dateRange });

    if (isLoading || !metrics) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="w-10 h-10 border-4 border-ice-100 border-t-brand-primary rounded-full animate-spin" />
            </div>
        );
    }

    const KpiCard = ({ title, value, unit, icon: Icon, color, trend }: any) => (
        <div className="bg-white rounded-[32px] p-8 border border-ice-100 shadow-sm relative overflow-hidden group hover:scale-[1.02] transition-all">
            <div className={clsx("absolute top-0 right-0 w-32 h-32 -mr-16 -mt-16 rounded-full opacity-10 blur-2xl group-hover:scale-150 transition-all", color)} />
            
            <div className="flex justify-between items-start relative z-10">
                <div className={clsx("w-14 h-14 rounded-[22px] flex items-center justify-center mb-6", color.replace('bg-', 'bg-opacity-10 text-'))}>
                    <Icon size={28} />
                </div>
                {trend && (
                    <span className={clsx(
                        "flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                        trend > 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                    )}>
                        {trend > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        {Math.abs(trend)}% vs 30d
                    </span>
                )}
            </div>

            <p className="text-[10px] font-black uppercase text-graphite-300 tracking-[0.2em] mb-2">{title}</p>
            <div className="flex items-baseline gap-2 pb-2 border-b border-ice-50">
                <h3 className="text-4xl font-black text-graphite-900 tracking-tighter">{value}</h3>
                <span className="text-xl font-black text-graphite-400">{unit}</span>
            </div>
        </div>
    );

    return (
        <div className="space-y-8 pb-12">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 px-1">
                <KpiCard title="Follow-ups Enviados" value={metrics.followUpsSent} unit="msg" icon={Zap} color="bg-brand-primary" trend={metrics.trends?.followUps} />
                <KpiCard title="Taxa de Conversão" value={metrics.conversionRate} unit="%" icon={TrendingUp} color="bg-emerald-500" trend={metrics.trends?.conversion} />
                <KpiCard title="No-Shows Prevenidos" value={metrics.noShowsPrevented} unit="pacientes" icon={Calendar} color="bg-amber-500" trend={metrics.trends?.noShows} />
                <KpiCard title="NPS Médio" value={metrics.npsAverage} unit="/ 10" icon={Star} color="bg-blue-500" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Funnel Chart */}
                <div className="lg:col-span-2 bg-white rounded-[40px] p-10 border border-ice-100 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-10">
                        <div>
                            <h4 className="text-lg font-black text-graphite-900 tracking-tighter leading-tight">Funil de Conversão</h4>
                            <p className="text-xs font-bold text-graphite-400">Eficiência de fechamento por etapa do lead</p>
                        </div>
                        <div className="px-4 py-2 bg-ice-50 rounded-xl text-[10px] font-black uppercase text-graphite-400 tracking-widest leading-none">Últimos 30 Dias</div>
                    </div>
                    
                    <div className="flex-1 min-h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                layout="vertical"
                                data={metrics.funnelData}
                                margin={{ left: 60, right: 60, top: 0, bottom: 0 }}
                                barSize={44}
                            >
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                                <XAxis type="number" hide />
                                <YAxis 
                                    dataKey="stage" 
                                    type="category" 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{ fill: '#475569', fontSize: 11, fontWeight: 'bold' }} 
                                    width={120}
                                />
                                <Tooltip 
                                    cursor={{ fill: '#F1F5F9' }}
                                    contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', fontWeight: 'bold' }}
                                />
                                <Bar dataKey="count" radius={[0, 12, 12, 0]}>
                                    {metrics.funnelData.map((_entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={index === 0 ? '#3B82F6' : index === 1 ? '#FB923C' : index === 2 ? '#FACC15' : '#10B981'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* NPS Distribution */}
                <div className="bg-white rounded-[40px] p-10 border border-ice-100 shadow-sm flex flex-col">
                    <div className="mb-10">
                        <h4 className="text-lg font-black text-graphite-900 tracking-tighter leading-tight">Distribuição NPS</h4>
                        <p className="text-xs font-bold text-graphite-400">Distribuição de satisfação dos pacientes</p>
                    </div>

                    <div className="flex-1 min-h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={metrics.npsDistribution} margin={{ top: 20 }}>
                                <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 'black' }} />
                                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                                    {metrics.npsDistribution.map((_entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={index === 0 ? '#EF4444' : index === 1 ? '#F59E0B' : '#10B981'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="mt-8 space-y-3 pt-6 border-t border-ice-50">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase text-graphite-300 tracking-widest">Promotores (9-10)</span>
                            <span className="text-sm font-black text-emerald-600">{metrics.promotersPct}%</span>
                        </div>
                        <div className="w-full h-2 bg-ice-50 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${metrics.promotersPct}%` }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Time Series Chart */}
            <div className="bg-white rounded-[40px] p-10 border border-ice-100 shadow-sm">
                <div className="flex items-center justify-between mb-12">
                    <div>
                        <h4 className="text-lg font-black text-graphite-900 tracking-tighter leading-tight">Volume de Interações Autônomas</h4>
                        <p className="text-xs font-bold text-graphite-400">Quantidade diária de mensagens enviadas por tipo</p>
                    </div>
                </div>

                <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={metrics.timeSeriesData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                            <XAxis 
                                dataKey="date" 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 'black' }} 
                            />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 'black' }} />
                            <Tooltip 
                                contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.15)', padding: '16px' }} 
                                itemStyle={{ fontWeight: 'black', fontSize: '11px' }}
                            />
                            <Legend iconType="circle" wrapperStyle={{ paddingTop: '32px', fontSize: '10px', fontWeight: 'black', textTransform: 'uppercase', letterSpacing: '0.1em' }} />
                            <Line type="monotone" dataKey="follow_up" name="Follow-up" stroke="#3B82F6" strokeWidth={4} dot={{ r: 4, fill: '#3B82F6', strokeWidth: 0 }} activeDot={{ r: 8, strokeWidth: 0 }} />
                            <Line type="monotone" dataKey="reminder" name="Lembretes" stroke="#F59E0B" strokeWidth={4} dot={{ r: 4, fill: '#F59E0B', strokeWidth: 0 }} />
                            <Line type="monotone" dataKey="post_consultation" name="Pós-Consulta" stroke="#8B5CF6" strokeWidth={4} dot={{ r: 4, fill: '#8B5CF6', strokeWidth: 0 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Top Templates Table */}
            <div className="bg-white rounded-[40px] p-10 border border-ice-100 shadow-sm overflow-hidden">
                <div className="mb-10">
                    <h4 className="text-lg font-black text-graphite-900 tracking-tighter leading-tight">Eficácia por Template</h4>
                    <p className="text-xs font-bold text-graphite-400">Qual mensagem está gerando mais agendamentos?</p>
                </div>

                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-ice-50">
                            <th className="pb-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none">Template</th>
                            <th className="pb-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none">Enviados</th>
                            <th className="pb-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none">Falhas</th>
                            <th className="pb-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none">Pendentes</th>
                            <th className="pb-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none text-right">Taxa Entrega</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ice-50">
                        {metrics.topTemplates.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="py-12 text-center text-xs font-bold text-graphite-300">
                                    Nenhuma automação enviada no período selecionado.
                                </td>
                            </tr>
                        ) : metrics.topTemplates.map((template: any) => (
                            <tr key={template.key} className="hover:bg-ice-25/50 transition-all">
                                <td className="py-5">
                                    <span className="text-sm font-black text-graphite-900 leading-none">{template.key}</span>
                                </td>
                                <td className="py-5">
                                    <span className="text-xs font-bold text-graphite-400">{template.sent}</span>
                                </td>
                                <td className="py-5">
                                    <span className="text-xs font-bold text-rose-400">{template.failed || '—'}</span>
                                </td>
                                <td className="py-5">
                                    <span className="text-xs font-bold text-graphite-400">{template.pending || '—'}</span>
                                </td>
                                <td className="py-5 text-right">
                                    {template.rate !== null ? (
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-primary/10 text-brand-primary font-black text-xs">
                                            {template.rate}% <TrendingUp size={14} />
                                        </div>
                                    ) : (
                                        <span className="text-xs font-bold text-graphite-300">—</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
