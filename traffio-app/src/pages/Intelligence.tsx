import { useTranslation } from 'react-i18next';
import { Zap, Save, Loader2 } from 'lucide-react';
import { useBotConfig } from '../hooks/useBotConfig';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useTenant } from '../contexts/TenantContext';
import { usePermissions } from '../hooks/usePermissions';
import { TimeInput } from '../components/shared/TimeInput';
import { ClinicKnowledgeSettings } from '../components/settings/ClinicKnowledgeSettings';
import { KnowledgeGapsPanel } from '../components/settings/KnowledgeGapsPanel';
import { getUTCOffsetString } from '../lib/timezoneUtils';

// Re-exportado para compatibilidade — BotConfigWizard.tsx importa este type
// a partir deste módulo. Fonte real: src/types/botConfig.ts
export type { BotConfig, ChannelAutomation, CustomReminder, AutomationCategoryStats, MotorHealthStats } from '../types/botConfig';

export const Intelligence = () => {
    const { t } = useTranslation('tenantAdmin');
    const { config, setConfig, loading, saving, saveConfig } = useBotConfig();
    const { timezone } = useLocaleFormat();
    const { tenant: currentTenant, userRole } = useTenant();
    const { can } = usePermissions();
    // Base de conhecimento pertence à Inteligência (cérebro do agente), não a Configurações.
    const canEditKnowledge = can('action:edit_config') && (userRole === 'owner' || userRole === 'admin');

    if (loading) return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-brand-primary" size={32} /></div>;

    return (
        <div className="w-full space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white">
                    <Zap size={32} />
                </div>
                <div>
                    <h1 className="text-3xl font-black text-graphite-900 tracking-tight">{t('intelligence.header.title')}</h1>
                    <p className="text-graphite-400 font-medium tracking-tight">{t('intelligence.header.subtitle')}</p>
                </div>
            </div>

            {/* Dial de autonomia da IA — F1: humano ou copiloto (docs/SPEC_AGENTE_IA_CLAUDE.md) */}
            <div className="bg-white border border-ice-100 rounded-3xl shadow-sm p-6 flex flex-wrap items-center gap-6">
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-black text-graphite-900">{t('intelligence.aiDial.title')}</h3>
                    <p className="text-xs font-medium text-graphite-400 mt-1">
                        {config.active_agent === 'copilot'
                            ? t('intelligence.aiDial.copilotHint')
                            : config.active_agent === 'ai_always'
                                ? t('intelligence.aiDial.aiAlwaysHint')
                                : t('intelligence.aiDial.humanHint')}
                    </p>
                </div>
                <div className="flex bg-ice-100 p-1 rounded-xl border border-ice-200/60 shrink-0">
                    {([
                        { key: 'human', label: t('intelligence.aiDial.human') },
                        { key: 'copilot', label: t('intelligence.aiDial.copilot') },
                        { key: 'ai_always', label: t('intelligence.aiDial.aiAlways') },
                    ] as { key: 'human' | 'copilot' | 'ai_always'; label: string }[]).map(mode => (
                        <button
                            key={mode.key}
                            onClick={() => setConfig(prev => ({ ...prev, active_agent: mode.key }))}
                            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all border-0 cursor-pointer ${
                                config.active_agent === mode.key
                                    ? 'bg-white text-brand-primary shadow-sm'
                                    : 'bg-transparent text-graphite-500 hover:text-graphite-800'
                            }`}
                        >
                            {mode.label}
                        </button>
                    ))}
                </div>

                {/* Horário da equipe — cancelamentos no expediente vão direto ao humano;
                    fora dele a IA acolhe e promete retorno (SPEC F3) */}
                {config.active_agent === 'ai_always' && (() => {
                    const bh = config.business_hours || { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] };
                    const patch = (p: Partial<typeof bh>) => setConfig(prev => ({ ...prev, business_hours: { ...bh, ...p } }));
                    return (
                        <div className="w-full flex flex-wrap items-center gap-x-5 gap-y-3 pt-4 mt-1 border-t border-ice-100">
                            <div className="w-full sm:w-auto">
                                <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">
                                    {t('intelligence.aiDial.hoursTitle')}
                                </p>
                                <p className="text-[10px] font-medium text-graphite-300 mt-0.5">
                                    {t('intelligence.aiDial.hoursTimezoneHint', {
                                        timezone,
                                        offset: `UTC${getUTCOffsetString(timezone || 'America/Sao_Paulo')}`,
                                    })}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <TimeInput
                                    value={bh.start}
                                    onChange={e => patch({ start: e.target.value })}
                                    className="px-3 py-1.5 rounded-xl bg-ice-50 border border-ice-100 text-xs font-bold text-graphite-800 focus:outline-none focus:border-brand-primary"
                                />
                                <span className="text-graphite-300 font-bold">—</span>
                                <TimeInput
                                    value={bh.end}
                                    onChange={e => patch({ end: e.target.value })}
                                    className="px-3 py-1.5 rounded-xl bg-ice-50 border border-ice-100 text-xs font-bold text-graphite-800 focus:outline-none focus:border-brand-primary"
                                />
                            </div>
                            <div className="flex items-center gap-1">
                                {[0, 1, 2, 3, 4, 5, 6].map(d => (
                                    <button
                                        key={d}
                                        onClick={() => patch({ days: bh.days.includes(d) ? bh.days.filter(x => x !== d) : [...bh.days, d].sort() })}
                                        title={t(`intelligence.aiDial.dayNames.${d}`)}
                                        className={`w-7 h-7 rounded-lg text-[10px] font-black transition-all border-0 cursor-pointer ${
                                            bh.days.includes(d)
                                                ? 'bg-brand-primary text-white shadow-sm'
                                                : 'bg-ice-100 text-graphite-400 hover:text-graphite-700'
                                        }`}
                                    >
                                        {t(`intelligence.aiDial.dayLetters.${d}`)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* ── Salvar (dial + horário da equipe) ── */}
            <div className="flex justify-end pt-2">
                <button
                    onClick={() => saveConfig()}
                    disabled={saving}
                    className="flex items-center justify-center gap-2 bg-brand-primary text-white px-10 py-4 rounded-2xl font-black shadow-xl shadow-brand-primary/20 hover:scale-105 active:scale-95 transition-all border-none cursor-pointer disabled:opacity-50"
                >
                    {saving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                    {t('intelligence.saveButton')}
                </button>
            </div>

            {/* ── Base de conhecimento do agente (auto-salva por fato) ── */}
            {canEditKnowledge && currentTenant && (
                <div className="pt-8 mt-2 border-t border-ice-100">
                    <ClinicKnowledgeSettings
                        tenantId={currentTenant.id}
                        canEdit={canEditKnowledge}
                        userRole={userRole || 'staff'}
                    />
                    <div className="mt-8">
                        <KnowledgeGapsPanel tenantId={currentTenant.id} />
                    </div>
                </div>
            )}
        </div>
    );
};
