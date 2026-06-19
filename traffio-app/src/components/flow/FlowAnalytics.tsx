import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar
} from 'recharts';
import { BarChart3, TrendingUp, Users, AlertTriangle, Zap } from 'lucide-react';
import { clsx } from 'clsx';

export const FlowAnalytics = () => {
    const { t } = useTranslation('flowBuilder');
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchMetrics = async () => {
            const { data: logs } = await supabase
                .from('bot_execution_logs')
                .select('created_at, duration_ms, node_type, error')
                .order('created_at', { ascending: true });

            if (logs) {
                const timeline = logs.reduce((acc: any, log: any) => {
                    const date = new Date(log.created_at).toLocaleDateString();
                    acc[date] = (acc[date] || 0) + 1;
                    return acc;
                }, {});

                const timelineData = Object.entries(timeline).map(([name, value]) => ({ name, value }));
                setData(timelineData);
            }
            setLoading(false);
        };

        fetchMetrics();
    }, []);

    if (loading) {
        return (
            <div className="p-20 text-center animate-pulse">
                <BarChart3 size={48} className="mx-auto text-ice-300 mb-4" />
                <p className="text-slate-400 font-black uppercase tracking-widest text-xs">{t('flowBuilder.analytics.calculatingMetrics')}</p>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-8 bg-slate-50/30">
            <div className="mb-10">
                <h2 className="text-3xl font-black text-graphite-900 tracking-tight flex items-center gap-3">
                    <BarChart3 className="text-brand-primary" size={32} /> {t('flowBuilder.analytics.title')}
                </h2>
                <p className="text-slate-500 font-medium mt-2">{t('flowBuilder.analytics.subtitle')}</p>
            </div>

            <div className="grid grid-cols-4 gap-6 mb-10">
                {[
                    { label: t('flowBuilder.analytics.totalExecutions'), value: '1,280', icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
                    { label: t('flowBuilder.analytics.activeSessions'), value: '42', icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                    { label: t('flowBuilder.analytics.avgResponseTime'), value: '450ms', icon: Zap, color: 'text-amber-600', bg: 'bg-amber-50' },
                    { label: t('flowBuilder.analytics.errorRate'), value: '1.2%', icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-50' },
                ].map((stat, i) => (
                    <div key={i} className="bg-white p-6 rounded-[24px] border border-ice-100 shadow-sm hover:shadow-xl transition-all group">
                        <div className="flex items-center gap-4">
                            <div className={clsx("p-3 rounded-2xl group-hover:scale-110 transition-transform", stat.bg, stat.color)}>
                                <stat.icon size={24} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
                                <p className="text-2xl font-black text-graphite-900">{stat.value}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-[32px] border border-ice-100 shadow-sm h-[400px] flex flex-col">
                    <h3 className="font-black text-xs uppercase tracking-widest text-slate-400 mb-6">{t('flowBuilder.analytics.executionVolume')}</h3>
                    <div className="flex-1 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} />
                                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                                <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={4} dot={{ r: 6, fill: '#6366f1', strokeWidth: 3, stroke: '#fff' }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white p-8 rounded-[32px] border border-ice-100 shadow-sm h-[400px] flex flex-col">
                    <h3 className="font-black text-xs uppercase tracking-widest text-slate-400 mb-6">{t('flowBuilder.analytics.distributionByNode')}</h3>
                    <div className="flex-1 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[{ name: 'Msg', v: 400 }, { name: 'IA', v: 300 }, { name: 'Split', v: 200 }, { name: 'API', v: 278 }]}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' }} />
                                <Bar dataKey="v" fill="#6366f1" radius={[8, 8, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};
