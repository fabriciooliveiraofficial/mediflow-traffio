import { useEffect, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { X, Loader2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { IconButton } from '../ui';

interface AutomationSettings {
    can_edit: boolean;
    new_lead_hours: number | null;
    showed_up_hours: number | null;
    proposal_hours: number | null;
    defaults: { new_lead_hours: number; showed_up_hours: number; proposal_hours: number };
    recovery_enabled: boolean;
    recall_enabled: boolean;
    recall_days: number;
}

type HoursKey = 'new_lead_hours' | 'showed_up_hours' | 'proposal_hours';

interface Props {
    tenantId: string;
    onClose: () => void;
    onSaved?: () => void;
}

/** Automações do Follow-up escritas como frases, com liga/desliga. */
export function FollowUpAutomationsPanel({ tenantId, onClose, onSaved }: Props) {
    const { t } = useTranslation('crm');
    const { showToast } = useToast();
    const [settings, setSettings] = useState<AutomationSettings | null>(null);
    const [saving, setSaving] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<Record<string, string>>({});

    useEffect(() => {
        (async () => {
            const { data, error } = await supabase.rpc('crm_get_followup_automations', { p_tenant_id: tenantId });
            if (error) { showToast('error', error.message); return; }
            setSettings(data as AutomationSettings);
        })();
    }, [tenantId, showToast]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const save = async (key: string, patch: Record<string, unknown>) => {
        setSaving(key);
        const { data, error } = await supabase.rpc('crm_update_followup_automations', { p_tenant_id: tenantId, p_settings: patch });
        setSaving(null);
        if (error) {
            showToast('error', error.code === '42501' ? t('automations.onlyOwner') : error.message);
            return;
        }
        setSettings(data as AutomationSettings);
        setDrafts(d => { const n = { ...d }; delete n[key]; return n; });
        showToast('success', t('automations.saved'));
        onSaved?.();
    };

    const toggleHours = (key: HoursKey) => {
        if (!settings) return;
        const on = settings[key] !== null;
        save(key, { [key]: on ? null : settings.defaults[key] });
    };

    const commitNumber = (key: string, min: number, max: number, current: number | null) => {
        const raw = drafts[key];
        if (raw === undefined) return;
        const n = Math.round(Number(raw));
        if (!Number.isFinite(n) || n < min || n > max) {
            showToast('error', t('automations.invalidNumber', { min, max }));
            setDrafts(d => { const x = { ...d }; delete x[key]; return x; });
            return;
        }
        if (n === current) { setDrafts(d => { const x = { ...d }; delete x[key]; return x; }); return; }
        save(key, { [key]: n });
    };

    const disabled = !settings?.can_edit;

    // Desligado: mostra o valor que voltará a valer, em cinza e sem edição
    const numberInput = (key: string, value: number, off: boolean, min: number, max: number, unitKey: string) => (
        <span className="inline-flex items-center gap-1.5 align-baseline">
            <label htmlFor={`auto-${key}`} className="sr-only">{t(`automations.units.${unitKey}`)}</label>
            <input
                id={`auto-${key}`}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                disabled={disabled || off}
                value={drafts[key] ?? value}
                onChange={(e) => setDrafts(d => ({ ...d, [key]: e.target.value }))}
                onBlur={() => commitNumber(key, min, max, value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-16 bg-ice-50 border border-ice-200 rounded-xl px-2 py-1 text-sm font-black text-graphite-900 text-center tabular-nums focus:ring-2 focus:ring-brand-primary outline-none disabled:opacity-50"
            />
            <span className="font-bold">{t(`automations.units.${unitKey}`)}</span>
        </span>
    );

    // Função (não componente): um componente declarado aqui dentro remontaria o
    // campo numérico a cada tecla e tiraria o foco.
    const row = (id: string, on: boolean, onToggle: () => void, hint: string, children: ReactNode, exists?: boolean) => (
        <li key={id} className="flex items-start gap-4 py-4 border-b border-ice-100 last:border-b-0">
            <div className="flex-1 min-w-0">
                <p className="text-sm text-graphite-700 leading-relaxed">
                    {children}
                    {exists && (
                        <span className="ml-2 align-middle text-[10px] font-black uppercase tracking-wide text-accent-success bg-accent-success/10 px-1.5 py-0.5 rounded-md">
                            {t('automations.alsoInNotifications')}
                        </span>
                    )}
                </p>
                <p className="text-xs text-graphite-400 mt-1">{hint}</p>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-labelledby={`auto-label-${id}`}
                disabled={disabled || saving !== null}
                onClick={onToggle}
                className={clsx(
                    'relative shrink-0 w-11 h-6 rounded-full transition-colors border-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 mt-0.5',
                    on ? 'bg-brand-primary' : 'bg-ice-200',
                )}
            >
                <span className={clsx('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
                {saving === id && <Loader2 className="absolute -left-6 top-1 w-4 h-4 animate-spin text-graphite-400" />}
            </button>
        </li>
    );

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex justify-end z-[60]" role="dialog" aria-modal="true" aria-labelledby="automations-title">
            <div className="absolute inset-0" onClick={onClose} />
            <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                <div className="p-6 border-b border-ice-100 flex items-start justify-between gap-4">
                    <div>
                        <h2 id="automations-title" className="text-lg font-black text-graphite-900">{t('automations.title')}</h2>
                        <p className="text-xs text-graphite-500 font-medium mt-1">{t('automations.subtitle')}</p>
                    </div>
                    <IconButton onClick={onClose} aria-label={t('automations.close')}><X className="w-5 h-5" /></IconButton>
                </div>

                <div className="flex-1 overflow-y-auto px-6 custom-scrollbar">
                    {!settings ? (
                        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-brand-primary" /></div>
                    ) : (
                        <>
                            {disabled && (
                                <p className="flex items-center gap-2 mt-5 p-3 rounded-2xl bg-ice-50 border border-ice-100 text-xs font-bold text-graphite-500">
                                    <Lock className="w-4 h-4 shrink-0" /> {t('automations.readOnly')}
                                </p>
                            )}

                            <h3 className="mt-6 text-[11px] font-black uppercase tracking-wider text-graphite-400">{t('automations.sections.team')}</h3>
                            <ul className="list-none p-0 m-0">
                                {row('new_lead_hours', settings.new_lead_hours !== null, () => toggleHours('new_lead_hours'), t('automations.hints.internal'), (<>
                                    <span id="auto-label-new_lead_hours">{t('automations.rules.newLead.before')}</span>{' '}
                                    {numberInput('new_lead_hours', settings.new_lead_hours ?? settings.defaults.new_lead_hours, settings.new_lead_hours === null, 1, 720, 'hours')}{' '}
                                    {t('automations.rules.newLead.after')}
                                </>))}
                                {row('showed_up_hours', settings.showed_up_hours !== null, () => toggleHours('showed_up_hours'), t('automations.hints.internal'), (<>
                                    <span id="auto-label-showed_up_hours">{t('automations.rules.cameNoProposal.before')}</span>{' '}
                                    {numberInput('showed_up_hours', settings.showed_up_hours ?? settings.defaults.showed_up_hours, settings.showed_up_hours === null, 1, 720, 'hours')}{' '}
                                    {t('automations.rules.cameNoProposal.after')}
                                </>))}
                                {row('proposal_hours', settings.proposal_hours !== null, () => toggleHours('proposal_hours'), t('automations.hints.internal'), (<>
                                    <span id="auto-label-proposal_hours">{t('automations.rules.proposal.before')}</span>{' '}
                                    {numberInput('proposal_hours', settings.proposal_hours ?? settings.defaults.proposal_hours, settings.proposal_hours === null, 1, 720, 'hours')}{' '}
                                    {t('automations.rules.proposal.after')}
                                </>))}
                            </ul>

                            <h3 className="mt-6 text-[11px] font-black uppercase tracking-wider text-graphite-400">{t('automations.sections.patient')}</h3>
                            <ul className="list-none p-0 m-0">
                                {row('recovery_enabled', settings.recovery_enabled, () => save('recovery_enabled', { recovery_enabled: !settings.recovery_enabled }), t('automations.hints.recovery'), (<>
                                    <span id="auto-label-recovery_enabled">{t('automations.rules.recovery')}</span>
                                </>), true)}
                                {row('recall_enabled', settings.recall_enabled, () => save('recall_enabled', { recall_enabled: !settings.recall_enabled }), t('automations.hints.recall'), (<>
                                    <span id="auto-label-recall_enabled">{t('automations.rules.recall.before')}</span>{' '}
                                    {numberInput('recall_days', settings.recall_days, !settings.recall_enabled, 30, 1095, 'days')}{' '}
                                    {t('automations.rules.recall.after')}
                                </>), true)}
                            </ul>
                        </>
                    )}
                </div>

                <p className="px-6 py-4 border-t border-ice-100 text-[11px] text-graphite-400 font-medium">{t('automations.footer')}</p>
            </div>
        </div>
    );
}
