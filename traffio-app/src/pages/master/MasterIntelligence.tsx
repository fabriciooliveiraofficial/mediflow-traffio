import { useState, useEffect } from 'react';
import {
    BrainCircuit,
    Key,
    Activity,
    TrendingUp,
    ShieldCheck,
    AlertCircle,
    Save,
    Cpu,
    BarChart3,
    Zap,
    Phone,
    MessageCircle,
    Globe,
    Info,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

interface MasterConfig {
    key: string;
    value: string;
    description: string;
}

interface TenantUsage {
    tenant_name: string;
    total_tokens: number;
    total_cost: number;
    profit_margin: number;
}

export const MasterIntelligence = () => {
    const { t } = useTranslation('master');
    const { showToast } = useToast();
    const [configs, setConfigs] = useState<MasterConfig[]>([]);
    const [usageData, setUsageData] = useState<TenantUsage[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [stats, setStats] = useState({
        totalTokens: 0,
        avgLatency: 'N/A', // Not tracking latency yet
        activeBots: 0,
        monthlyCost: 0
    });

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);

            // 1. Fetch Configs
            const { data: configData, error: configError } = await supabase
                .from('master_config')
                .select('*');
            if (configError) throw configError;

            // Chaves obrigatórias da stack Claude aparecem no painel mesmo antes
            // de existirem no banco (a linha é criada no primeiro save via upsert)
            const required: MasterConfig[] = [
                { key: 'ANTHROPIC_API_KEY', value: '', description: 'Claude API (agente conversacional + router)' },
                { key: 'AI_MODEL_AGENT', value: 'claude-sonnet-5', description: 'Modelo do agente conversacional' },
                { key: 'AI_MODEL_ROUTER', value: 'claude-haiku-4-5-20251001', description: 'Modelo de triagem/extração' },
            ];
            const merged = [...(configData || [])];
            for (const req of required) {
                if (!merged.some(c => c.key === req.key)) merged.push(req);
            }
            setConfigs(merged);

            // 2. Fetch Usage Logs (Last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const { data: logs, error: logsError } = await supabase
                .from('ai_usage_logs')
                .select(`
                    id,
                    tenant_id,
                    prompt_tokens,
                    completion_tokens,
                    estimated_cost_usd,
                    tenants (name)
                `)
                .gte('created_at', thirtyDaysAgo.toISOString());

            if (logsError) throw logsError;

            // 3. Process Stats
            let totalTokens = 0;
            let totalCost = 0;
            const uniqueTenants = new Set();
            const tenantMap: Record<string, TenantUsage> = {};

            logs?.forEach(log => {
                const tokens = (log.prompt_tokens || 0) + (log.completion_tokens || 0);
                const cost = log.estimated_cost_usd || 0;

                totalTokens += tokens;
                totalCost += cost;

                if (log.tenant_id) {
                    uniqueTenants.add(log.tenant_id);
                    // @ts-ignore - Supabase types join handling
                    const tName = log.tenants?.name || 'Unknown';

                    if (!tenantMap[log.tenant_id]) {
                        tenantMap[log.tenant_id] = {
                            tenant_name: tName,
                            total_tokens: 0,
                            total_cost: 0,
                            profit_margin: 0
                        };
                    }

                    tenantMap[log.tenant_id].total_tokens += tokens;
                    tenantMap[log.tenant_id].total_cost += cost;
                    // Mock Profit Logic: We charge R$0.0002 per token (approx) vs Cost
                    // In real world, fetch plan price
                    const revenue = tokens * 0.00004; // ~$40 per 1M tokens revenue example
                    tenantMap[log.tenant_id].profit_margin += (revenue - cost);
                }
            });

            setStats({
                totalTokens,
                avgLatency: '0ms', // Implementation pending
                activeBots: uniqueTenants.size,
                monthlyCost: totalCost
            });

            setUsageData(Object.values(tenantMap).sort((a, b) => b.total_tokens - a.total_tokens));

        } catch (error) {
            console.error('Error fetching master data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateConfig = async (key: string, value: string) => {
        setSaving(key);
        try {
            // upsert: cria a linha na primeira gravação (chaves novas da stack Claude)
            const description = configs.find(c => c.key === key)?.description || '';
            const { error } = await supabase
                .from('master_config')
                .upsert({ key, value, description, updated_at: new Date().toISOString() }, { onConflict: 'key' });

            if (error) throw error;

            setConfigs(prev => prev.map(c => c.key === key ? { ...c, value } : c));
            showToast('success', t('intelligence.toasts.saveSuccess'));
        } catch (error) {
            showToast('error', t('intelligence.toasts.saveError', { message: (error as any).message }));
        } finally {
            setSaving(null);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto">
            {/* Header */}
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <BrainCircuit className="text-white" size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">{t('intelligence.sectionLabel')}</p>
                        <h1 className="text-3xl font-black text-white tracking-tight">{t('intelligence.headerTitle')}</h1>
                    </div>
                </div>
                <p className="text-slate-500 font-medium text-sm">{t('intelligence.headerSubtitle')}</p>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: t('intelligence.stats.tokensProcessed'), value: stats.totalTokens.toLocaleString(), icon: Activity, color: 'text-indigo-400' },
                    { label: t('intelligence.stats.avgLatency'), value: stats.avgLatency, icon: Zap, color: 'text-amber-400' },
                    { label: t('intelligence.stats.activeBots'), value: stats.activeBots.toString(), icon: Cpu, color: 'text-emerald-400' },
                    { label: t('intelligence.stats.apiCost'), value: `$${stats.monthlyCost.toFixed(4)}`, icon: TrendingUp, color: 'text-sky-400' },
                ].map((stat, i) => (
                    <div key={i} className="bg-[#0F1629] border border-[#1E293B] p-5 rounded-2xl">
                        <div className="flex justify-between items-start mb-4">
                            <div className={`p-2 rounded-lg bg-[#1A2035] ${stat.color}`}>
                                <stat.icon size={20} />
                            </div>
                        </div>
                        <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">{stat.label}</p>
                        <h3 className="text-2xl font-black text-white mt-1">{stat.value}</h3>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* API Keys Configuration */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl overflow-hidden shadow-xl shadow-black/20">
                        <div className="p-6 border-b border-[#1E293B] flex items-center justify-between bg-[#131B31]">
                            <div className="flex items-center gap-3">
                                <Key className="text-indigo-400" size={20} />
                                <h3 className="font-bold text-white uppercase tracking-wider text-sm">{t('intelligence.credentialsSection.title')}</h3>
                            </div>
                            <ShieldCheck className="text-emerald-500" size={18} />
                        </div>

                        <div className="p-6 space-y-8">
                            {loading ? (
                                <div className="py-12 flex justify-center"><Zap className="animate-spin text-indigo-500" /></div>
                            ) : (
                                <>
                                    {/* AI Configuration — família Claude (ver docs/SPEC_AGENTE_IA_CLAUDE.md) */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 rounded-2xl bg-[#131B31] border border-[#1E293B]">
                                        <div className="space-y-2">
                                            <label className="text-xs font-black text-indigo-400 uppercase tracking-widest">{t('intelligence.credentialsSection.aiProviderLabel')}</label>
                                            <div className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white flex items-center gap-2">
                                                <ShieldCheck className="text-emerald-500" size={14} />
                                                Anthropic Claude
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-black text-indigo-400 uppercase tracking-widest">{t('intelligence.credentialsSection.agentModelLabel')}</label>
                                            <select
                                                value={configs.find(c => c.key === 'AI_MODEL_AGENT')?.value || 'claude-sonnet-5'}
                                                onChange={(e) => handleUpdateConfig('AI_MODEL_AGENT', e.target.value)}
                                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                                            >
                                                <option value="claude-sonnet-5">Claude Sonnet 5</option>
                                                <option value="claude-opus-4-8">Claude Opus 4.8</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-black text-indigo-400 uppercase tracking-widest">{t('intelligence.credentialsSection.routerModelLabel')}</label>
                                            <select
                                                value={configs.find(c => c.key === 'AI_MODEL_ROUTER')?.value || 'claude-haiku-4-5-20251001'}
                                                onChange={(e) => handleUpdateConfig('AI_MODEL_ROUTER', e.target.value)}
                                                className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                                            >
                                                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                                                <option value="claude-sonnet-5">Claude Sonnet 5</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* API Keys */}
                                    {configs.filter(c => c.key.includes('_API_KEY')).map((config) => (
                                        <div key={config.key} className="space-y-2">
                                            <div className="flex justify-between items-end">
                                                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">{config.key}</label>
                                                <span className="text-[10px] text-slate-600 font-medium">{config.description}</span>
                                            </div>
                                            <div className="relative flex items-center gap-2">
                                                <input
                                                    type="password"
                                                    value={config.value}
                                                    onChange={(e) => {
                                                        const newValue = e.target.value;
                                                        setConfigs(prev => prev.map(c => c.key === config.key ? { ...c, value: newValue } : c));
                                                    }}
                                                    placeholder={t('intelligence.credentialsSection.apiKeyPlaceholder')}
                                                    className="flex-1 bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-indigo-500 transition-all font-mono text-sm leading-none"
                                                />
                                                <button
                                                    onClick={() => handleUpdateConfig(config.key, config.value)}
                                                    disabled={saving === config.key}
                                                    className="p-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                                >
                                                    {saving === config.key ? <Zap className="animate-spin" size={16} /> : <Save size={16} />}
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    {/* ── Comunicações — Telnyx ──────────────────────────────────────────── */}
                                    {configs.some(c => c.key.startsWith('TELNYX_')) && (
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 pb-2 border-b border-[#1E293B]">
                                                <Phone className="text-blue-400" size={16} />
                                                <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest">{t('intelligence.credentialsSection.telnyxTitle')}</h4>
                                                <div className="ml-auto flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                                                    <Info size={10} /> {t('intelligence.credentialsSection.telnyxWarning')}
                                                </div>
                                            </div>
                                            {configs.filter(c => c.key.startsWith('TELNYX_')).map((config) => (
                                                <div key={config.key} className="space-y-2">
                                                    <div className="flex justify-between items-end">
                                                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest">{config.key}</label>
                                                        <span className="text-[10px] text-slate-600 font-medium">{config.description}</span>
                                                    </div>
                                                    <div className="relative flex items-center gap-2">
                                                        <input
                                                            type="password"
                                                            value={config.value}
                                                            onChange={(e) => {
                                                                const v = e.target.value;
                                                                setConfigs(prev => prev.map(c => c.key === config.key ? { ...c, value: v } : c));
                                                            }}
                                                            placeholder={t('intelligence.credentialsSection.genericKeyPlaceholder', { key: config.key })}
                                                            className="flex-1 bg-[#1A2035] border border-blue-500/20 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-blue-500 transition-all font-mono text-sm"
                                                        />
                                                        <button
                                                            onClick={() => handleUpdateConfig(config.key, config.value)}
                                                            disabled={saving === config.key}
                                                            className="p-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                                        >
                                                            {saving === config.key ? <Zap className="animate-spin" size={16} /> : <Save size={16} />}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* ── Meta (Instagram DM + Facebook Messenger) ───────────────────────── */}
                                    {configs.some(c => c.key.startsWith('META_')) && (
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 pb-2 border-b border-[#1E293B]">
                                                <Globe className="text-blue-500" size={16} />
                                                <h4 className="text-xs font-black text-blue-500 uppercase tracking-widest">{t('intelligence.credentialsSection.metaTitle')}</h4>
                                            </div>
                                            {configs.filter(c => c.key.startsWith('META_')).map((config) => (
                                                <div key={config.key} className="space-y-2">
                                                    <div className="flex justify-between items-end">
                                                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest">{config.key}</label>
                                                        <span className="text-[10px] text-slate-600 font-medium">{config.description}</span>
                                                    </div>
                                                    <div className="relative flex items-center gap-2">
                                                        <input
                                                            type="password"
                                                            value={config.value}
                                                            onChange={(e) => {
                                                                const v = e.target.value;
                                                                setConfigs(prev => prev.map(c => c.key === config.key ? { ...c, value: v } : c));
                                                            }}
                                                            placeholder={t('intelligence.credentialsSection.genericKeyPlaceholder', { key: config.key })}
                                                            className="flex-1 bg-[#1A2035] border border-blue-500/20 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-blue-500 transition-all font-mono text-sm"
                                                        />
                                                        <button
                                                            onClick={() => handleUpdateConfig(config.key, config.value)}
                                                            disabled={saving === config.key}
                                                            className="p-3.5 rounded-xl bg-blue-700 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                                        >
                                                            {saving === config.key ? <Zap className="animate-spin" size={16} /> : <Save size={16} />}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Global Switch */}
                                    {configs.filter(c => !c.key.includes('_API_KEY') && !c.key.startsWith('TELNYX_') && !c.key.startsWith('META_') && !['AI_MODEL_PROVIDER', 'AI_MODEL_NAME', 'AI_MODEL_AGENT', 'AI_MODEL_ROUTER'].includes(c.key)).map((config) => (
                                        <div key={config.key} className="flex items-center justify-between p-4 rounded-xl bg-[#1A2035]/50 border border-[#2D3B55]">
                                            <div>
                                                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{config.key}</p>
                                                <p className="text-[10px] text-slate-600">{config.description}</p>
                                            </div>
                                            <button
                                                onClick={() => handleUpdateConfig(config.key, config.value === 'true' ? 'false' : 'true')}
                                                className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${config.value === 'true' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'}`}
                                            >
                                                {config.value === 'true' ? t('intelligence.credentialsSection.toggleActive') : t('intelligence.credentialsSection.toggleInactive')}
                                            </button>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>

                    </div>

                    {/* Cost Analytics */}
                    <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <BarChart3 className="text-sky-400" size={20} />
                            <h3 className="font-bold text-white uppercase tracking-wider text-sm">{t('intelligence.costAnalytics.title')}</h3>
                        </div>
                        <div className="space-y-4">
                            {usageData.length === 0 ? (
                                <div className="text-center py-8 text-slate-600 text-xs">
                                    {t('intelligence.costAnalytics.empty')}
                                </div>
                            ) : usageData.map((row, i) => (
                                <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-[#131B31] border border-[#1E293B] group hover:border-indigo-500/30 transition-all">
                                    <div className="font-bold text-sm text-white">{row.tenant_name}</div>
                                    <div className="flex items-center gap-8 text-xs">
                                        <div className="flex flex-col items-end">
                                            <span className="text-slate-500 uppercase font-black text-[9px]">{t('intelligence.costAnalytics.usage')}</span>
                                            <span className="text-slate-300 font-mono">{row.total_tokens.toLocaleString()} tok</span>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-slate-500 uppercase font-black text-[9px]">{t('intelligence.costAnalytics.apiCost')}</span>
                                            <span className="text-slate-300 font-mono">${row.total_cost.toFixed(4)}</span>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-slate-500 uppercase font-black text-[9px]">{t('intelligence.costAnalytics.platformProfit')}</span>
                                            <span className="text-emerald-400 font-bold">
                                                {row.profit_margin >= 0 ? '+' : ''}${row.profit_margin.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Sidebar Info/Policy */}
                <div className="space-y-6">
                    <div className="bg-gradient-to-br from-indigo-600/20 to-sky-600/20 border border-indigo-500/20 rounded-2xl p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <ShieldCheck className="text-indigo-400" size={20} />
                            <h4 className="font-black text-white text-xs uppercase tracking-widest">{t('intelligence.sidebar.securityTitle')}</h4>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed font-medium">
                            {t('intelligence.sidebar.securityText')}
                            <br /><br />
                            {t('intelligence.sidebar.securityText2')}
                        </p>
                    </div>

                    <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <AlertCircle className="text-amber-400" size={20} />
                            <h4 className="font-black text-white text-xs uppercase tracking-widest">{t('intelligence.sidebar.rateLimitTitle')}</h4>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed font-medium">
                            {t('intelligence.sidebar.rateLimitText')}
                        </p>
                        <button className="w-full mt-4 py-2 bg-amber-500/10 text-amber-500 rounded-lg text-xs font-black uppercase hover:bg-amber-500/20 transition-all border-none cursor-pointer">
                            {t('intelligence.sidebar.viewDocs')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
