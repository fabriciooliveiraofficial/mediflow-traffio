import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { Terminal, Clock, AlertCircle, CheckCircle2, Search, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';

export const FlowLogs = ({ flowId }: { flowId?: string }) => {
    const { t } = useTranslation('flowBuilder');
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchLogs = async () => {
            let query = supabase
                .from('bot_execution_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);

            if (flowId) {
                query = query.eq('flow_id', flowId);
            }

            const { data } = await query;
            setLogs(data || []);
            setLoading(false);
        };

        fetchLogs();
    }, [flowId]);

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center">
                <div className="text-slate-400 font-bold animate-pulse uppercase tracking-widest text-xs">{t('logs.loadingAudit')}</div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white">
            <div className="p-8 border-b border-ice-100 flex justify-between items-center bg-slate-50/50">
                <div>
                    <h2 className="text-2xl font-black text-graphite-900 tracking-tight flex items-center gap-3">
                        <Terminal className="text-brand-primary" /> {t('logs.title')}
                    </h2>
                    <p className="text-slate-500 text-sm mt-1 font-medium">{t('logs.subtitle')}</p>
                </div>

                <div className="flex gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            placeholder={t('logs.searchSessionId')}
                            className="pl-10 pr-4 py-2.5 bg-white border border-ice-200 rounded-xl text-xs font-bold outline-none focus:border-brand-primary transition-all w-64"
                        />
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="space-y-4">
                    {logs.map((log) => (
                        <div key={log.id} className="p-4 bg-white border border-ice-100 rounded-[20px] hover:border-brand-primary/30 transition-all group shadow-sm flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className={clsx(
                                    "p-3 rounded-xl shadow-sm",
                                    log.error ? "bg-rose-50 text-rose-500" : "bg-emerald-50 text-emerald-500"
                                )}>
                                    {log.error ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-black text-graphite-900 text-sm tracking-tight">{log.node_type.toUpperCase()}</span>
                                        <span className="text-[10px] font-bold text-slate-400 px-2 py-0.5 bg-slate-50 rounded italic">ID: {log.node_id}</span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1">
                                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                                            <Clock size={12} /> {new Date(log.created_at).toLocaleTimeString()}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider border-l border-ice-100 pl-3">
                                            <Terminal size={12} /> {log.duration_ms}ms
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-6">
                                <div className="text-right">
                                    <div className="text-[10px] font-black text-slate-400 uppercase mb-1">{t('logs.session')}</div>
                                    <div className="text-xs font-bold text-graphite-700 truncate w-32 tracking-tighter">{log.session_id}</div>
                                </div>
                                <button className="p-2.5 bg-ice-50 hover:bg-ice-100 rounded-xl text-brand-primary transition-all">
                                    <ArrowRight size={18} />
                                </button>
                            </div>
                        </div>
                    ))}

                    {logs.length === 0 && (
                        <div className="py-20 text-center">
                            <Terminal size={48} className="mx-auto text-ice-200 mb-4" />
                            <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">{t('logs.noLogsFound')}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
