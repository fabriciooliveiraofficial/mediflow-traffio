import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, HelpCircle, Loader2, RefreshCw, X } from 'lucide-react';
import { CLINIC_FACTS, normalizeClinicFactLanguage } from '../../config/clinicFactsSchema';
import { clinicInfoService } from '../../services/clinicInfoService';
import { knowledgeGapsService, type KnowledgeGap } from '../../services/knowledgeGapsService';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../ui';

const TEXT_FACTS = CLINIC_FACTS.filter((fact) => fact.type === 'short_text' || fact.type === 'long_text');

export function KnowledgeGapsPanel({ tenantId }: { tenantId: string }) {
    const { t, i18n } = useTranslation('settings');
    const { showToast } = useToast();
    const language = normalizeClinicFactLanguage(i18n.resolvedLanguage ?? i18n.language);
    const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [answeringId, setAnsweringId] = useState<string | null>(null);
    const [factKey, setFactKey] = useState('');
    const [answer, setAnswer] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setLoadError(false);
        try { setGaps(await knowledgeGapsService.listOpen(tenantId)); }
        catch { setLoadError(true); }
        finally { setLoading(false); }
    }, [tenantId]);
    useEffect(() => { void load(); }, [load]);

    const startAnswer = (gap: KnowledgeGap) => {
        setAnsweringId(gap.id); setFactKey(''); setAnswer('');
    };
    const saveAnswer = async (gap: KnowledgeGap) => {
        const value = answer.trim();
        if (!value || busyId) return;
        const key = factKey || `faq_gap_${gap.id.replace(/-/g, '')}`;
        const canonical = TEXT_FACTS.find((fact) => fact.key === key);
        setBusyId(gap.id);
        try {
            await clinicInfoService.upsert({ tenant_id: tenantId, key, value, category: canonical?.category || 'faq' });
            await knowledgeGapsService.markAnswered(gap.id, key);
            setGaps((current) => current.filter((item) => item.id !== gap.id));
            setAnsweringId(null);
            showToast('success', t('knowledgeGaps.toasts.answered'));
        } catch {
            showToast('error', t('knowledgeGaps.toasts.saveError'));
        } finally { setBusyId(null); }
    };
    const dismiss = async (gap: KnowledgeGap) => {
        if (busyId) return;
        setBusyId(gap.id);
        try {
            await knowledgeGapsService.dismiss(gap.id);
            setGaps((current) => current.filter((item) => item.id !== gap.id));
            showToast('success', t('knowledgeGaps.toasts.dismissed'));
        } catch { showToast('error', t('knowledgeGaps.toasts.dismissError')); }
        finally { setBusyId(null); }
    };

    return (
        <section className="rounded-3xl border border-ice-100 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="knowledge-gaps-title">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 id="knowledge-gaps-title" className="flex items-center gap-2 text-xl font-black text-graphite-900">
                        <HelpCircle className="text-brand-primary" size={22} />
                        {t('knowledgeGaps.title', { count: gaps.length })}
                    </h3>
                    <p className="mt-1 text-sm text-graphite-500">{t('knowledgeGaps.subtitle')}</p>
                </div>
                {!loading && <Button size="sm" variant="ghost" onClick={() => void load()} aria-label={t('knowledgeGaps.retry')}><RefreshCw size={15} /></Button>}
            </div>

            {loading ? <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-primary" /></div>
                : loadError ? <div className="mt-6 flex items-center gap-3 rounded-2xl bg-accent-error/5 p-5 text-sm text-accent-error"><AlertCircle size={20} /><span>{t('knowledgeGaps.loadError')}</span><Button size="sm" variant="ghost" onClick={() => void load()}>{t('knowledgeGaps.retry')}</Button></div>
                : gaps.length === 0 ? <div className="mt-6 flex flex-col items-center rounded-2xl bg-ice-50 px-5 py-12 text-center"><CheckCircle2 className="text-accent-success" size={32} /><p className="mt-3 font-black text-graphite-900">{t('knowledgeGaps.empty.title')}</p><p className="mt-1 text-sm text-graphite-500">{t('knowledgeGaps.empty.description')}</p></div>
                : <div className="mt-6 space-y-4">{gaps.map((gap) => (
                    <article key={gap.id} className="rounded-2xl border border-ice-100 bg-ice-50 p-5">
                        <p className="font-bold text-graphite-900">{gap.patient_question}</p>
                        <p className="mt-2 text-xs font-medium text-graphite-400">{t('knowledgeGaps.meta', { count: gap.occurrences, date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(gap.last_detected_at)) })}</p>
                        {answeringId === gap.id ? <div className="mt-4 space-y-3 border-t border-ice-200 pt-4">
                            <label className="block text-xs font-black text-graphite-700">{t('knowledgeGaps.factLabel')}</label>
                            <select value={factKey} onChange={(event) => setFactKey(event.target.value)} className="w-full rounded-xl border border-ice-200 bg-white px-4 py-3 text-sm">
                                <option value="">{t('knowledgeGaps.newFaq')}</option>
                                {TEXT_FACTS.map((fact) => <option key={fact.key} value={fact.key}>{fact.label[language]}</option>)}
                            </select>
                            <textarea rows={3} maxLength={1200} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={t('knowledgeGaps.answerPlaceholder')} className="w-full resize-y rounded-xl border border-ice-200 bg-white px-4 py-3 text-sm outline-none focus:border-brand-primary" />
                            <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setAnsweringId(null)}>{t('knowledgeGaps.cancel')}</Button><Button size="sm" disabled={!answer.trim() || busyId === gap.id} onClick={() => void saveAnswer(gap)}>{busyId === gap.id && <Loader2 className="animate-spin" size={14} />}{t('knowledgeGaps.save')}</Button></div>
                        </div> : <div className="mt-4 flex justify-end gap-2"><Button size="sm" variant="dangerGhost" disabled={busyId === gap.id} onClick={() => void dismiss(gap)}><X size={14} />{t('knowledgeGaps.dismiss')}</Button><Button size="sm" onClick={() => startAnswer(gap)}>{t('knowledgeGaps.answer')}</Button></div>}
                    </article>
                ))}</div>}
        </section>
    );
}
