import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Terminal, RefreshCw, AlertCircle, Info, 
  Flame, Bug, Copy, Check, ChevronDown, ChevronUp, Search
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { clsx } from 'clsx';

interface LogEntry {
  id: string;
  tenant_id: string | null;
  level: "info" | "warn" | "error" | "fatal" | "debug";
  source: string;
  event_name: string;
  message: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

interface SystemLogsProps {
  tenantId?: string | null;
}

const LEVEL_COLORS: Record<string, { bg: string; text: string; icon: any }> = {
  info: { bg: 'bg-blue-50', text: 'text-blue-700 border-blue-100', icon: Info },
  warn: { bg: 'bg-amber-50', text: 'text-amber-700 border-amber-100', icon: AlertCircle },
  error: { bg: 'bg-red-50', text: 'text-red-700 border-red-100', icon: AlertCircle },
  fatal: { bg: 'bg-rose-100', text: 'text-rose-800 border-rose-200', icon: Flame },
  debug: { bg: 'bg-slate-100', text: 'text-slate-700 border-slate-200', icon: Bug }
};

export function SystemLogs({ tenantId }: SystemLogsProps) {
  const { t } = useTranslation('settings');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('platform_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      // Se for tenantId específico, buscar logs do tenant ou logs globais (sem tenant) para diagnósticos
      if (tenantId) {
        query = query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
      }

      if (filterLevel !== 'all') {
        query = query.eq('level', filterLevel);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [tenantId, filterLevel]);

  const handleCopy = (log: LogEntry) => {
    const textToCopy = JSON.stringify(log, null, 2);
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredLogs = logs.filter(log => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      log.source?.toLowerCase().includes(term) ||
      log.event_name?.toLowerCase().includes(term) ||
      log.message?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-graphite-900 flex items-center gap-2">
            <Terminal className="text-brand-primary" size={24} />
            <span>{t('logs.title', 'Logs do Sistema')}</span>
          </h3>
          <p className="text-sm text-graphite-400 mt-0.5">
            {t('logs.subtitle', 'Diagnóstico em tempo real de eventos, erros e integrações do sistema.')}
          </p>
        </div>

        <button
          onClick={fetchLogs}
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-ice-50 text-brand-primary px-4 py-2.5 rounded-xl font-bold hover:bg-ice-100 transition-colors border-none cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={16} className={clsx(loading && "animate-spin")} />
          <span>{t('logs.refresh', 'Atualizar')}</span>
        </button>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col md:flex-row gap-4">
        {/* Search */}
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-graphite-400" />
          <input
            type="text"
            placeholder={t('logs.searchPlaceholder', 'Buscar por fonte, evento ou mensagem...')}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 text-sm bg-ice-50 border border-ice-100 rounded-xl focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/5 transition-all text-graphite-800"
          />
        </div>

        {/* Level Filters */}
        <div className="flex gap-1.5 p-1 bg-ice-50 border border-ice-100 rounded-xl overflow-x-auto shrink-0">
          {['all', 'info', 'warn', 'error', 'fatal', 'debug'].map(lvl => (
            <button
              key={lvl}
              onClick={() => setFilterLevel(lvl)}
              className={clsx(
                "px-4 py-2 rounded-lg text-xs font-black transition-all border-none cursor-pointer uppercase",
                filterLevel === lvl 
                  ? "bg-white text-graphite-900 shadow-sm"
                  : "text-graphite-400 hover:text-graphite-700"
              )}
            >
              {lvl === 'all' ? t('logs.levels.all', 'Todos') : lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Logs View */}
      <div className="space-y-3">
        {loading && logs.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-3">
            <RefreshCw className="animate-spin text-brand-primary w-8 h-8" />
            <p className="text-sm font-bold text-graphite-400">{t('logs.loading', 'Carregando logs...')}</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-16 text-center border-2 border-dashed border-ice-100 rounded-2xl">
            <Terminal className="w-10 h-10 mx-auto text-ice-200 mb-2" />
            <p className="text-sm font-bold text-graphite-400">{t('logs.empty', 'Nenhum log encontrado')}</p>
          </div>
        ) : (
          <div className="border border-ice-100 rounded-2xl overflow-hidden divide-y divide-ice-100 bg-white">
            {filteredLogs.map(log => {
              const lvlMeta = LEVEL_COLORS[log.level] ?? LEVEL_COLORS.info;
              const Icon = lvlMeta.icon;
              const isExpanded = expandedLogId === log.id;

              return (
                <div key={log.id} className="transition-colors hover:bg-ice-50/30">
                  {/* Log Summary Header */}
                  <div 
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="flex items-start gap-4 p-4 cursor-pointer select-none"
                  >
                    {/* Badge */}
                    <div className={clsx("flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase shrink-0", lvlMeta.bg, lvlMeta.text)}>
                      <Icon size={12} />
                      <span>{log.level}</span>
                    </div>

                    {/* Source & Event */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-graphite-700 bg-ice-50 px-2 py-0.5 rounded border border-ice-100">
                          {log.source}
                        </span>
                        <span className="font-bold text-sm text-graphite-900 truncate">
                          {log.event_name}
                        </span>
                      </div>
                      {log.message && (
                        <p className="text-xs text-graphite-500 mt-1 line-clamp-1">
                          {log.message}
                        </p>
                      )}
                    </div>

                    {/* Timestamp & Expand icon */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-graphite-400 font-medium">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                      {isExpanded ? <ChevronUp size={16} className="text-graphite-400" /> : <ChevronDown size={16} className="text-graphite-400" />}
                    </div>
                  </div>

                  {/* Expanded View with Metadata */}
                  {isExpanded && (
                    <div className="bg-ice-50/50 p-4 border-t border-ice-100 space-y-4">
                      {/* Message Detail */}
                      {log.message && (
                        <div className="space-y-1">
                          <h4 className="text-xs font-black text-graphite-400 uppercase tracking-wider">{t('logs.messageHeader', 'Mensagem')}</h4>
                          <p className="text-sm font-semibold text-graphite-700 bg-white p-3 rounded-xl border border-ice-100">
                            {log.message}
                          </p>
                        </div>
                      )}

                      {/* Metadata Details */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-black text-graphite-400 uppercase tracking-wider">{t('logs.metadataHeader', 'Metadados & Payload')}</h4>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(log);
                            }}
                            className="flex items-center gap-1 text-xs text-brand-primary font-bold hover:underline bg-transparent border-none cursor-pointer"
                          >
                            {copiedId === log.id ? (
                              <><Check size={12} /> {t('logs.copied', 'Copiado!')}</>
                            ) : (
                              <><Copy size={12} /> {t('logs.copyJson', 'Copiar JSON')}</>
                            )}
                          </button>
                        </div>
                        <pre className="text-xs font-mono text-slate-700 bg-white p-4 rounded-xl border border-ice-100 overflow-x-auto max-h-[300px] leading-relaxed">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </div>

                      {/* Diagnostic Summary */}
                      <div className="flex items-center justify-between text-[11px] text-graphite-400 font-medium">
                        <span>{t('logs.id', 'ID do Log')}: {log.id}</span>
                        <span>{new Date(log.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
