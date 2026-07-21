import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertCircle,
    Check,
    FileText,
    Link as LinkIcon,
    Loader2,
    MessageSquareText,
    Pencil,
    Sparkles,
    Trash2,
    Type,
    X,
} from 'lucide-react';
import {
    CLINIC_FACTS,
    getClinicFactValueLimit,
    normalizeClinicFactLanguage,
} from '../../config/clinicFactsSchema';
import { clinicInfoService } from '../../services/clinicInfoService';
import {
    clinicFactSuggestionsService,
    type ClinicFactSuggestion,
} from '../../services/clinicFactSuggestionsService';
import { Badge, Button } from '../ui';
import { AiOnboardingInterview } from './AiOnboardingInterview';
import { selectEmptyClinicFacts, toExtractionCatalog } from './aiOnboardingUtils';

type InputMethod = 'url' | 'pasted_text' | 'file';
type Stage = 'method' | 'input' | 'review' | 'interview';

interface AiOnboardingWizardProps {
    tenantId: string;
    onKnowledgeChanged: () => void;
}

const FILE_LIMIT_BYTES = 300 * 1024;

export function AiOnboardingWizard({ tenantId, onKnowledgeChanged }: AiOnboardingWizardProps) {
    const { t, i18n } = useTranslation('settings');
    const language = normalizeClinicFactLanguage(i18n.resolvedLanguage ?? i18n.language);
    const [open, setOpen] = useState(false);
    const [stage, setStage] = useState<Stage>('method');
    const [method, setMethod] = useState<InputMethod>('url');
    const [sourceValue, setSourceValue] = useState('');
    const [sourceReference, setSourceReference] = useState('');
    const [fileName, setFileName] = useState('');
    const [emptyFacts, setEmptyFacts] = useState<typeof CLINIC_FACTS>(CLINIC_FACTS);
    const [suggestions, setSuggestions] = useState<ClinicFactSuggestion[]>([]);
    const [drafts, setDrafts] = useState<Record<string, { value: string; title: string }>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const [itemErrors, setItemErrors] = useState<Set<string>>(new Set());

    const loadContext = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [facts, pending] = await Promise.all([
                clinicInfoService.getAll(tenantId),
                clinicFactSuggestionsService.listPending(tenantId),
            ]);
            setEmptyFacts(selectEmptyClinicFacts(CLINIC_FACTS, facts) as typeof CLINIC_FACTS);
            setSuggestions(pending);
            setDrafts(Object.fromEntries(pending.map((item) => [item.id, {
                value: item.suggested_value,
                title: item.title || '',
            }])));
        } catch (cause) {
            console.error('Error loading AI onboarding:', cause);
            setError(t('aiOnboarding.errors.load'));
        } finally {
            setLoading(false);
        }
    }, [t, tenantId]);

    useEffect(() => {
        if (open) void loadContext();
    }, [loadContext, open]);

    const close = () => {
        if (busyIds.size || loading) return;
        setOpen(false);
        setStage('method');
        setSourceValue('');
        setSourceReference('');
        setFileName('');
        setError('');
    };

    const chooseMethod = (selected: InputMethod) => {
        setMethod(selected);
        setSourceValue('');
        setSourceReference('');
        setFileName('');
        setError('');
        setStage('input');
    };

    const handleFile = async (file?: File) => {
        setError('');
        if (!file) return;
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (!['txt', 'md'].includes(extension || '') || file.size > FILE_LIMIT_BYTES) {
            setSourceValue('');
            setFileName('');
            setError(t('aiOnboarding.errors.file'));
            return;
        }
        try {
            setSourceValue(await file.text());
            setSourceReference(file.name);
            setFileName(file.name);
        } catch {
            setError(t('aiOnboarding.errors.fileRead'));
        }
    };

    const analyze = async () => {
        if (!sourceValue.trim() || loading) return;
        setLoading(true);
        setError('');
        try {
            const created = await clinicFactSuggestionsService.extract({
                tenantId,
                sourceType: method,
                sourceValue: sourceValue.trim(),
                ...(sourceReference ? { sourceReference } : {}),
                factsCatalog: toExtractionCatalog(emptyFacts),
            });
            setSuggestions((current) => [...current, ...created]);
            setDrafts((current) => ({
                ...current,
                ...Object.fromEntries(created.map((item) => [item.id, {
                    value: item.suggested_value,
                    title: item.title || '',
                }])),
            }));
            setStage('review');
        } catch (cause) {
            console.error('Error extracting clinic facts:', cause);
            setError(t('aiOnboarding.errors.analyze'));
        } finally {
            setLoading(false);
        }
    };

    const setBusy = (id: string, busy: boolean) => setBusyIds((current) => {
        const next = new Set(current);
        if (busy) next.add(id); else next.delete(id);
        return next;
    });

    const approve = async (item: ClinicFactSuggestion) => {
        const draft = drafts[item.id];
        if (!draft?.value.trim() || busyIds.has(item.id)) return false;
        setBusy(item.id, true);
        setItemErrors((current) => { const next = new Set(current); next.delete(item.id); return next; });
        try {
            await clinicFactSuggestionsService.approve(item.id, {
                destination: item.destination,
                factKey: item.fact_key,
                title: draft.title,
                value: draft.value,
            });
            setSuggestions((current) => current.filter((candidate) => candidate.id !== item.id));
            onKnowledgeChanged();
            return true;
        } catch (cause) {
            console.error('Error approving suggestion:', cause);
            setItemErrors((current) => new Set(current).add(item.id));
            return false;
        } finally {
            setBusy(item.id, false);
        }
    };

    const reject = async (item: ClinicFactSuggestion) => {
        if (busyIds.has(item.id)) return;
        setBusy(item.id, true);
        try {
            await clinicFactSuggestionsService.reject(item.id);
            setSuggestions((current) => current.filter((candidate) => candidate.id !== item.id));
        } catch (cause) {
            console.error('Error rejecting suggestion:', cause);
            setItemErrors((current) => new Set(current).add(item.id));
        } finally {
            setBusy(item.id, false);
        }
    };

    const approveHighClarity = async () => {
        const visibleHighClarity = suggestions.filter((item) => item.clarity === 'high');
        for (const item of visibleHighClarity) await approve(item);
    };

    const factByKey = useMemo(() => new Map(CLINIC_FACTS.map((fact) => [fact.key, fact])), []);
    const highClarityCount = suggestions.filter((item) => item.clarity === 'high').length;

    return (
        <>
            <section className="mb-8 rounded-3xl border border-brand-primary/15 bg-gradient-to-r from-brand-primary/5 to-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                        <div className="rounded-2xl bg-brand-primary p-3 text-white"><Sparkles size={22} /></div>
                        <div>
                            <h3 className="font-black text-graphite-900">{t('aiOnboarding.entry.title')}</h3>
                            <p className="mt-1 max-w-2xl text-sm text-graphite-500">{t('aiOnboarding.entry.description')}</p>
                        </div>
                    </div>
                    <Button onClick={() => setOpen(true)}><Sparkles size={16} />{t('aiOnboarding.entry.button')}</Button>
                </div>
            </section>

            {open && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-graphite-900/45 p-4 backdrop-blur-sm" role="presentation">
                    <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/30 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ai-onboarding-title">
                        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ice-100 bg-white/95 px-6 py-5 backdrop-blur-sm sm:px-8">
                            <div>
                                <h2 id="ai-onboarding-title" className="flex items-center gap-2 text-xl font-black text-graphite-900"><Sparkles className="text-brand-primary" size={22} />{t('aiOnboarding.title')}</h2>
                                <p className="mt-1 text-sm text-graphite-500">{t('aiOnboarding.subtitle')}</p>
                            </div>
                            <button type="button" onClick={close} disabled={loading || Boolean(busyIds.size)} className="rounded-xl border border-ice-200 bg-white p-2 text-graphite-500 hover:text-graphite-900 disabled:opacity-50" aria-label={t('aiOnboarding.close')}><X size={19} /></button>
                        </header>

                        <div className="p-6 sm:p-8">
                            {loading && stage === 'method' ? (
                                <div className="flex flex-col items-center py-16 text-sm font-bold text-graphite-500"><Loader2 className="mb-3 animate-spin text-brand-primary" size={28} />{t('aiOnboarding.loading')}</div>
                            ) : stage === 'method' ? (
                                <div>
                                    {error && <ErrorBox message={error} />}
                                    {suggestions.length > 0 && (
                                        <button type="button" onClick={() => setStage('review')} className="mb-6 flex w-full items-center justify-between rounded-2xl border border-accent-warning/30 bg-accent-warning/5 p-4 text-left">
                                            <span className="font-bold text-graphite-800">{t('aiOnboarding.pending', { count: suggestions.length })}</span>
                                            <span className="text-sm font-black text-brand-primary">{t('aiOnboarding.reviewNow')}</span>
                                        </button>
                                    )}
                                    <h3 className="text-sm font-black text-graphite-800">{t('aiOnboarding.method.title')}</h3>
                                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                        <MethodButton icon={<LinkIcon />} title={t('aiOnboarding.method.url.title')} description={t('aiOnboarding.method.url.description')} onClick={() => chooseMethod('url')} />
                                        <MethodButton icon={<Type />} title={t('aiOnboarding.method.text.title')} description={t('aiOnboarding.method.text.description')} onClick={() => chooseMethod('pasted_text')} />
                                        <MethodButton icon={<FileText />} title={t('aiOnboarding.method.file.title')} description={t('aiOnboarding.method.file.description')} onClick={() => chooseMethod('file')} />
                                        <MethodButton icon={<MessageSquareText />} title={t('aiOnboarding.method.interview.title')} description={t('aiOnboarding.method.interview.description')} onClick={() => setStage('interview')} />
                                    </div>
                                    {!emptyFacts.length && <p className="mt-6 rounded-2xl bg-accent-success/5 p-4 text-sm font-bold text-accent-success">{t('aiOnboarding.noEmptyFacts')}</p>}
                                </div>
                            ) : stage === 'input' ? (
                                <div>
                                    <button type="button" onClick={() => setStage('method')} className="mb-5 text-sm font-bold text-brand-primary">← {t('aiOnboarding.back')}</button>
                                    <h3 className="text-lg font-black text-graphite-900">{t(`aiOnboarding.input.${method}.title`)}</h3>
                                    <p className="mt-1 text-sm text-graphite-500">{t(`aiOnboarding.input.${method}.description`)}</p>
                                    <div className="mt-5">
                                        {method === 'url' ? (
                                            <input type="url" autoFocus value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder="https://clinic.example" className="w-full rounded-xl border border-ice-200 bg-ice-50 px-4 py-3 text-sm outline-none focus:border-brand-primary" />
                                        ) : method === 'pasted_text' ? (
                                            <textarea autoFocus rows={10} value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder={t('aiOnboarding.input.pasted_text.placeholder')} className="w-full resize-y rounded-xl border border-ice-200 bg-ice-50 px-4 py-3 text-sm outline-none focus:border-brand-primary" />
                                        ) : (
                                            <label className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-ice-200 bg-ice-50 px-6 py-12 text-center hover:border-brand-primary/40">
                                                <FileText className="text-brand-primary" size={32} />
                                                <span className="mt-3 font-black text-graphite-900">{fileName || t('aiOnboarding.input.file.select')}</span>
                                                <span className="mt-1 text-xs text-graphite-500">{t('aiOnboarding.input.file.hint')}</span>
                                                <input type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(event) => void handleFile(event.target.files?.[0])} />
                                            </label>
                                        )}
                                    </div>
                                    {error && <div className="mt-4"><ErrorBox message={error} /></div>}
                                    <div className="mt-6 flex justify-end"><Button onClick={() => void analyze()} disabled={!sourceValue.trim() || loading || !emptyFacts.length}>{loading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}{loading ? t('aiOnboarding.analyzing') : t('aiOnboarding.analyze')}</Button></div>
                                </div>
                            ) : stage === 'interview' ? (
                                <AiOnboardingInterview
                                    tenantId={tenantId}
                                    facts={emptyFacts}
                                    onCancel={() => setStage('method')}
                                    onComplete={(created) => {
                                        setSuggestions((current) => [...current, ...created]);
                                        setDrafts((current) => ({ ...current, ...Object.fromEntries(created.map((item) => [item.id, { value: item.suggested_value, title: item.title || '' }])) }));
                                        setStage('review');
                                    }}
                                />
                            ) : (
                                <div>
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <button type="button" onClick={() => setStage('method')} className="mb-2 text-sm font-bold text-brand-primary">← {t('aiOnboarding.addMore')}</button>
                                            <h3 className="text-lg font-black text-graphite-900">{t('aiOnboarding.review.title')}</h3>
                                            <p className="mt-1 text-sm text-graphite-500">{t('aiOnboarding.review.description')}</p>
                                        </div>
                                        {highClarityCount > 0 && <Button variant="secondary" onClick={() => void approveHighClarity()} disabled={Boolean(busyIds.size)}><Check size={16} />{t('aiOnboarding.review.approveHigh', { count: highClarityCount })}</Button>}
                                    </div>

                                    {!suggestions.length ? (
                                        <div className="mt-8 rounded-2xl bg-ice-50 px-6 py-14 text-center"><Check className="mx-auto text-accent-success" size={34} /><p className="mt-3 font-black text-graphite-900">{t('aiOnboarding.review.empty')}</p><Button className="mt-5" onClick={() => setStage('method')}>{t('aiOnboarding.addMore')}</Button></div>
                                    ) : (
                                        <div className="mt-6 space-y-4">{suggestions.map((item) => {
                                            const fact = item.fact_key ? factByKey.get(item.fact_key) : undefined;
                                            const draft = drafts[item.id] || { value: item.suggested_value, title: item.title || '' };
                                            const changed = draft.value.trim() !== item.suggested_value || draft.title.trim() !== (item.title || '');
                                            const busy = busyIds.has(item.id);
                                            return (
                                                <article key={item.id} className="rounded-2xl border border-ice-100 p-5 shadow-sm">
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div><p className="text-xs font-black uppercase tracking-wide text-graphite-400">{item.destination === 'clinic_info' ? t('aiOnboarding.review.canonicalFact') : t('aiOnboarding.review.freeKnowledge')}</p><h4 className="mt-1 font-black text-graphite-900">{fact?.label[language] || draft.title}</h4></div>
                                                        <div className="flex items-center gap-2">
                                                            {item.flagged_suspicious && <Badge accent="error" size="sm">{t('aiOnboarding.review.flaggedSuspicious')}</Badge>}
                                                            <Badge accent={item.clarity === 'high' ? 'success' : item.clarity === 'low' ? 'error' : 'warning'} size="sm">{t(`aiOnboarding.clarity.${item.clarity}`)}</Badge>
                                                        </div>
                                                    </div>
                                                    {item.destination === 'knowledge_base' && <input value={draft.title} maxLength={200} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, title: event.target.value } }))} className="mt-4 w-full rounded-xl border border-ice-200 bg-ice-50 px-4 py-3 text-sm font-bold outline-none focus:border-brand-primary" aria-label={t('aiOnboarding.review.titleLabel')} />}
                                                    {fact && (fact.type === 'enum' || fact.type === 'boolean') ? (
                                                        <select value={draft.value} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, value: event.target.value } }))} className="mt-4 w-full rounded-xl border border-ice-200 bg-ice-50 px-4 py-3 text-sm outline-none focus:border-brand-primary">{fact.options?.map((option) => <option key={option.value} value={option.value}>{option.label[language]}</option>)}</select>
                                                    ) : (
                                                        <textarea rows={3} value={draft.value} maxLength={fact ? getClinicFactValueLimit(fact) : 2000} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, value: event.target.value } }))} className="mt-4 w-full resize-y rounded-xl border border-ice-200 bg-ice-50 px-4 py-3 text-sm outline-none focus:border-brand-primary" />
                                                    )}
                                                    {item.source_excerpt && <blockquote className="mt-3 border-l-2 border-brand-primary/30 pl-3 text-xs italic text-graphite-500">{item.source_excerpt}</blockquote>}
                                                    {item.source_reference && <p className="mt-2 truncate text-[11px] text-graphite-400">{t('aiOnboarding.review.source')}: {item.source_reference}</p>}
                                                    {itemErrors.has(item.id) && <p className="mt-3 text-xs font-bold text-accent-error" role="alert">{t('aiOnboarding.review.itemError')}</p>}
                                                    <div className="mt-4 flex flex-wrap justify-end gap-2"><Button size="sm" variant="dangerGhost" disabled={busy} onClick={() => void reject(item)}><Trash2 size={14} />{t('aiOnboarding.review.discard')}</Button><Button size="sm" disabled={busy || !draft.value.trim() || (item.destination === 'knowledge_base' && !draft.title.trim())} onClick={() => void approve(item)}>{busy ? <Loader2 className="animate-spin" size={14} /> : changed ? <Pencil size={14} /> : <Check size={14} />}{changed ? t('aiOnboarding.review.editApprove') : t('aiOnboarding.review.approve')}</Button></div>
                                                </article>
                                            );
                                        })}</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function MethodButton({ icon, title, description, onClick }: { icon: React.ReactNode; title: string; description: string; onClick: () => void }) {
    return <button type="button" onClick={onClick} className="flex items-start gap-4 rounded-2xl border border-ice-100 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-primary/30 hover:shadow-md"><span className="rounded-xl bg-brand-primary/10 p-2.5 text-brand-primary">{icon}</span><span><span className="block font-black text-graphite-900">{title}</span><span className="mt-1 block text-sm text-graphite-500">{description}</span></span></button>;
}

function ErrorBox({ message }: { message: string }) {
    return <div className="flex items-center gap-3 rounded-2xl bg-accent-error/5 p-4 text-sm font-bold text-accent-error" role="alert"><AlertCircle size={19} />{message}</div>;
}
