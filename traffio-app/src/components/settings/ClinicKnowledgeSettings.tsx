import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertCircle,
    BookOpenCheck,
    Check,
    Loader2,
    RefreshCw,
    Save,
} from 'lucide-react';
import {
    CLINIC_FACTS,
    calculateClinicFactsCompletion,
    getClinicFactValueLimit,
    normalizeClinicFactLanguage,
    type ClinicFactDefinition,
    type ClinicFactSection,
} from '../../config/clinicFactsSchema';
import { clinicInfoService, type ClinicInfo } from '../../services/clinicInfoService';
import { useToast } from '../../contexts/ToastContext';
import { Badge, Button } from '../ui';

interface ClinicKnowledgeSettingsProps {
    tenantId: string;
    canEdit: boolean;
    userRole: string;
}

const SECTION_ORDER: readonly ClinicFactSection[] = [
    'commercial',
    'logistics',
    'clinical',
    'policies',
];

const EDITOR_ROLES = new Set(['owner', 'admin']);

const fieldClassName = [
    'w-full rounded-xl border border-ice-200/60 bg-ice-50 px-4 py-3',
    'text-sm font-medium text-graphite-900 placeholder:text-graphite-300',
    'outline-none transition-all focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10',
    'disabled:cursor-not-allowed disabled:opacity-60',
].join(' ');

function persistedValue(entry?: ClinicInfo): string {
    return entry?.is_active === false ? '' : entry?.value ?? '';
}

export function ClinicKnowledgeSettings({
    tenantId,
    canEdit,
    userRole,
}: ClinicKnowledgeSettingsProps) {
    const { t, i18n } = useTranslation('settings');
    const { showToast } = useToast();
    const language = normalizeClinicFactLanguage(i18n.resolvedLanguage ?? i18n.language);
    const hasAccess = canEdit && EDITOR_ROLES.has(userRole);

    const [factsByKey, setFactsByKey] = useState<Record<string, ClinicInfo>>({});
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(hasAccess);
    const [loadError, setLoadError] = useState(false);
    const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
    const [saveErrorKeys, setSaveErrorKeys] = useState<Set<string>>(new Set());
    const loadRequestRef = useRef(0);
    const tenantIdRef = useRef(tenantId);
    tenantIdRef.current = tenantId;

    const loadFacts = useCallback(async () => {
        const requestId = ++loadRequestRef.current;
        if (!hasAccess) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setLoadError(false);

        try {
            const records = await clinicInfoService.getAll(tenantId);
            if (requestId !== loadRequestRef.current || tenantIdRef.current !== tenantId) return;
            const canonicalKeys = new Set(CLINIC_FACTS.map((fact) => fact.key));
            const nextFacts: Record<string, ClinicInfo> = {};

            records.forEach((record) => {
                if (canonicalKeys.has(record.key)) nextFacts[record.key] = record;
            });

            setFactsByKey(nextFacts);
            setDrafts(Object.fromEntries(
                CLINIC_FACTS.map((fact) => [fact.key, persistedValue(nextFacts[fact.key])]),
            ));
            setSaveErrorKeys(new Set());
        } catch (error) {
            if (requestId !== loadRequestRef.current || tenantIdRef.current !== tenantId) return;
            console.error('Error loading clinic knowledge:', error);
            setLoadError(true);
            showToast('error', t('knowledge.toasts.loadError'));
        } finally {
            if (requestId === loadRequestRef.current && tenantIdRef.current === tenantId) setLoading(false);
        }
    }, [hasAccess, showToast, t, tenantId]);

    useEffect(() => {
        void loadFacts();
        return () => {
            loadRequestRef.current += 1;
        };
    }, [loadFacts]);

    const completion = useMemo(
        () => calculateClinicFactsCompletion(Object.values(factsByKey)),
        [factsByKey],
    );

    const factsBySection = useMemo(() => Object.fromEntries(
        SECTION_ORDER.map((section) => [
            section,
            CLINIC_FACTS.filter((fact) => fact.section === section),
        ]),
    ) as Record<ClinicFactSection, readonly ClinicFactDefinition[]>, []);

    const setDraft = (key: string, value: string) => {
        setDrafts((current) => ({ ...current, [key]: value }));
        setSaveErrorKeys((current) => {
            if (!current.has(key)) return current;
            const next = new Set(current);
            next.delete(key);
            return next;
        });
    };

    const setSaving = (key: string, saving: boolean) => {
        setSavingKeys((current) => {
            const next = new Set(current);
            if (saving) next.add(key);
            else next.delete(key);
            return next;
        });
    };

    const handleSave = async (fact: ClinicFactDefinition) => {
        if (!hasAccess || savingKeys.has(fact.key)) return;

        const value = (drafts[fact.key] ?? '').trim();
        const currentRecord = factsByKey[fact.key];
        setSaving(fact.key, true);
        setSaveErrorKeys((current) => {
            const next = new Set(current);
            next.delete(fact.key);
            return next;
        });

        try {
            if (!value) {
                if (currentRecord?.id) await clinicInfoService.delete(currentRecord.id);
                if (tenantIdRef.current !== tenantId) return;

                setFactsByKey((current) => {
                    const next = { ...current };
                    delete next[fact.key];
                    return next;
                });
                setDraft(fact.key, '');
                showToast('success', t('knowledge.toasts.removed', { fact: fact.label[language] }));
                return;
            }

            const saved = await clinicInfoService.upsert({
                ...(currentRecord?.id ? { id: currentRecord.id } : {}),
                tenant_id: tenantId,
                key: fact.key,
                value,
                category: fact.category,
                ...(currentRecord?.location_id ? { location_id: currentRecord.location_id } : {}),
            });
            if (tenantIdRef.current !== tenantId) return;

            setFactsByKey((current) => ({ ...current, [fact.key]: saved }));
            setDraft(fact.key, saved.value);
            showToast('success', t('knowledge.toasts.saved', { fact: fact.label[language] }));
        } catch (error) {
            if (tenantIdRef.current !== tenantId) return;
            console.error(`Error saving clinic fact ${fact.key}:`, error);
            setSaveErrorKeys((current) => new Set(current).add(fact.key));
            showToast('error', t('knowledge.toasts.saveError', { fact: fact.label[language] }));
        } finally {
            if (tenantIdRef.current === tenantId) setSaving(fact.key, false);
        }
    };

    if (!hasAccess) {
        return (
            <div className="p-6 sm:p-8">
                <div className="flex flex-col items-center justify-center rounded-3xl border border-ice-100 bg-ice-50 px-6 py-16 text-center">
                    <AlertCircle className="mb-4 text-graphite-300" size={32} aria-hidden="true" />
                    <h3 className="text-lg font-black text-graphite-900">{t('knowledge.accessDenied.title')}</h3>
                    <p className="mt-2 max-w-lg text-sm text-graphite-500">{t('knowledge.accessDenied.description')}</p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex min-h-[400px] items-center justify-center p-8" role="status">
                <div className="flex flex-col items-center gap-3 text-center text-graphite-500">
                    <Loader2 className="animate-spin text-brand-primary" size={28} aria-hidden="true" />
                    <span className="text-sm font-bold">{t('knowledge.loading')}</span>
                </div>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="p-6 sm:p-8">
                <div className="flex flex-col items-center justify-center rounded-3xl border border-accent-error/20 bg-accent-error/5 px-6 py-16 text-center">
                    <AlertCircle className="mb-4 text-accent-error" size={32} aria-hidden="true" />
                    <h3 className="text-lg font-black text-graphite-900">{t('knowledge.loadError.title')}</h3>
                    <p className="mt-2 max-w-lg text-sm text-graphite-500">{t('knowledge.loadError.description')}</p>
                    <Button className="mt-5" variant="ghost" onClick={() => void loadFacts()}>
                        <RefreshCw size={16} aria-hidden="true" />
                        {t('knowledge.loadError.retry')}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 p-6 sm:p-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h3 className="text-xl font-black text-graphite-900">{t('knowledge.title')}</h3>
                    <p className="mt-1 max-w-3xl text-sm leading-relaxed text-graphite-500">{t('knowledge.subtitle')}</p>
                </div>
                <Badge accent="brand" className="self-start" variant="tag">
                    <BookOpenCheck size={14} aria-hidden="true" />
                    {t('knowledge.canonicalBadge')}
                </Badge>
            </div>

            <div className="rounded-3xl border border-ice-100 bg-ice-50 p-5 sm:p-6">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-sm font-black text-graphite-900">{t('knowledge.completion.title')}</p>
                        <p className="mt-1 text-xs text-graphite-500">{t('knowledge.completion.hint')}</p>
                    </div>
                    <p className="text-sm font-black text-brand-primary">
                        {t('knowledge.completion.count', {
                            completed: completion.completed,
                            total: completion.total,
                        })}
                    </p>
                </div>
                <div
                    className="h-3 overflow-hidden rounded-full bg-ice-200"
                    role="progressbar"
                    aria-label={t('knowledge.completion.ariaLabel')}
                    aria-valuemin={0}
                    aria-valuemax={completion.total}
                    aria-valuenow={completion.completed}
                >
                    <div
                        className="h-full rounded-full bg-brand-primary transition-[width] duration-500"
                        style={{ width: `${completion.percentage}%` }}
                    />
                </div>
            </div>

            {SECTION_ORDER.map((section) => {
                const sectionFacts = factsBySection[section];
                const completedInSection = sectionFacts.filter((fact) => {
                    const entry = factsByKey[fact.key];
                    return entry?.is_active !== false && Boolean(entry?.value.trim());
                }).length;

                return (
                    <section key={section} aria-labelledby={`knowledge-section-${section}`}>
                        <div className="mb-4 flex items-end justify-between gap-4">
                            <div>
                                <h4 id={`knowledge-section-${section}`} className="text-lg font-black text-graphite-900">
                                    {t(`knowledge.sections.${section}.title`)}
                                </h4>
                                <p className="mt-1 text-sm text-graphite-500">
                                    {t(`knowledge.sections.${section}.description`)}
                                </p>
                            </div>
                            <span className="shrink-0 text-xs font-black text-graphite-400">
                                {t('knowledge.completion.sectionCount', {
                                    completed: completedInSection,
                                    total: sectionFacts.length,
                                })}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            {sectionFacts.map((fact) => {
                                const savedValue = persistedValue(factsByKey[fact.key]);
                                const draftValue = drafts[fact.key] ?? '';
                                const isFilled = Boolean(savedValue.trim());
                                const isDirty = draftValue.trim() !== savedValue.trim();
                                const isSaving = savingKeys.has(fact.key);
                                const hasSaveError = saveErrorKeys.has(fact.key);
                                const inputId = `clinic-fact-${fact.key}`;
                                const maxLength = getClinicFactValueLimit(fact);

                                return (
                                    <article
                                        key={fact.key}
                                        className="flex flex-col rounded-2xl border border-ice-100 bg-white p-5 shadow-sm"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <label htmlFor={inputId} className="text-sm font-black leading-snug text-graphite-900">
                                                {fact.label[language]}
                                            </label>
                                            <Badge accent={isFilled ? 'success' : 'neutral'} size="sm">
                                                {isFilled ? t('knowledge.status.filled') : t('knowledge.status.empty')}
                                            </Badge>
                                        </div>

                                        <p className="mt-2 text-xs leading-relaxed text-graphite-500">
                                            {fact.helpText[language]}
                                        </p>
                                        <p className="mt-2 text-xs leading-relaxed text-graphite-400">
                                            <span className="font-bold">{t('knowledge.fields.example')}</span>{' '}
                                            {fact.example[language]}
                                        </p>

                                        <div className="mt-4">
                                            {fact.type === 'boolean' && (
                                                <div
                                                    id={inputId}
                                                    className="grid grid-cols-1 gap-2 rounded-2xl border border-ice-200/60 bg-ice-100 p-1.5 sm:grid-cols-3"
                                                    role="radiogroup"
                                                    aria-label={fact.label[language]}
                                                >
                                                    <button
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={draftValue === ''}
                                                        disabled={isSaving}
                                                        onClick={() => setDraft(fact.key, '')}
                                                        className={`rounded-xl border-none px-3 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${draftValue === ''
                                                            ? 'bg-white text-brand-primary shadow-sm'
                                                            : 'bg-transparent text-graphite-500 hover:text-graphite-800'
                                                        }`}
                                                    >
                                                        {t('knowledge.fields.notInformed')}
                                                    </button>
                                                    {fact.options?.map((option) => (
                                                        <button
                                                            key={option.value}
                                                            type="button"
                                                            role="radio"
                                                            aria-checked={draftValue === option.value}
                                                            disabled={isSaving}
                                                            onClick={() => setDraft(fact.key, option.value)}
                                                            className={`rounded-xl border-none px-3 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${draftValue === option.value
                                                                ? 'bg-brand-primary text-white shadow-sm'
                                                                : 'bg-transparent text-graphite-500 hover:text-graphite-800'
                                                            }`}
                                                        >
                                                            {option.label[language]}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {fact.type === 'enum' && (
                                                <select
                                                    id={inputId}
                                                    value={draftValue}
                                                    disabled={isSaving}
                                                    onChange={(event) => setDraft(fact.key, event.target.value)}
                                                    className={`${fieldClassName} cursor-pointer`}
                                                >
                                                    <option value="">{t('knowledge.fields.notInformed')}</option>
                                                    {fact.options?.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label[language]}
                                                        </option>
                                                    ))}
                                                </select>
                                            )}

                                            {fact.type === 'short_text' && (
                                                <input
                                                    id={inputId}
                                                    type="text"
                                                    value={draftValue}
                                                    disabled={isSaving}
                                                    maxLength={maxLength}
                                                    placeholder={fact.example[language]}
                                                    onChange={(event) => setDraft(fact.key, event.target.value)}
                                                    className={fieldClassName}
                                                />
                                            )}

                                            {fact.type === 'long_text' && (
                                                <textarea
                                                    id={inputId}
                                                    rows={4}
                                                    value={draftValue}
                                                    disabled={isSaving}
                                                    maxLength={maxLength}
                                                    placeholder={fact.example[language]}
                                                    onChange={(event) => setDraft(fact.key, event.target.value)}
                                                    className={`${fieldClassName} resize-y leading-relaxed`}
                                                />
                                            )}

                                            {(fact.type === 'short_text' || fact.type === 'long_text') && (
                                                <p className="mt-1.5 text-right text-[11px] font-medium text-graphite-400">
                                                    {t('knowledge.fields.characters', {
                                                        current: draftValue.length,
                                                        maximum: maxLength,
                                                    })}
                                                </p>
                                            )}
                                        </div>

                                        <div className="mt-auto flex min-h-12 items-end justify-between gap-3 pt-4">
                                            <div className="text-xs font-bold">
                                                {hasSaveError ? (
                                                    <span className="flex items-center gap-1.5 text-accent-error" role="alert">
                                                        <AlertCircle size={14} aria-hidden="true" />
                                                        {t('knowledge.fields.saveError')}
                                                    </span>
                                                ) : isDirty ? (
                                                    <span className="text-accent-warning">{t('knowledge.fields.unsaved')}</span>
                                                ) : isFilled ? (
                                                    <span className="flex items-center gap-1.5 text-accent-success">
                                                        <Check size={14} aria-hidden="true" />
                                                        {t('knowledge.fields.saved')}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <Button
                                                size="sm"
                                                onClick={() => void handleSave(fact)}
                                                disabled={!isDirty || isSaving}
                                            >
                                                {isSaving ? (
                                                    <Loader2 className="animate-spin" size={15} aria-hidden="true" />
                                                ) : (
                                                    <Save size={15} aria-hidden="true" />
                                                )}
                                                {isSaving ? t('knowledge.fields.saving') : t('knowledge.fields.save')}
                                            </Button>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
