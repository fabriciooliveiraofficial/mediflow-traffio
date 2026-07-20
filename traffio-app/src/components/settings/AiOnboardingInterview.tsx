import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Check, Loader2, SkipForward } from 'lucide-react';
import {
    getClinicFactValueLimit,
    normalizeClinicFactLanguage,
    type ClinicFactDefinition,
} from '../../config/clinicFactsSchema';
import { clinicFactSuggestionsService, type ClinicFactSuggestion } from '../../services/clinicFactSuggestionsService';
import { Button } from '../ui';

interface AiOnboardingInterviewProps {
    tenantId: string;
    facts: readonly ClinicFactDefinition[];
    onCancel: () => void;
    onComplete: (suggestions: ClinicFactSuggestion[]) => void;
}

export function AiOnboardingInterview({ tenantId, facts, onCancel, onComplete }: AiOnboardingInterviewProps) {
    const { t, i18n } = useTranslation('settings');
    const language = normalizeClinicFactLanguage(i18n.resolvedLanguage ?? i18n.language);
    const [index, setIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    const current = facts[index];
    const answer = current ? answers[current.key] ?? '' : '';
    const answeredCount = useMemo(() => Object.values(answers).filter((value) => value.trim()).length, [answers]);

    const setAnswer = (value: string) => {
        if (!current) return;
        setAnswers((state) => ({ ...state, [current.key]: value }));
        setError(false);
    };

    const finish = async () => {
        const completed = Object.entries(answers)
            .map(([key, value]) => ({ key, value: value.trim() }))
            .filter((item) => item.value);
        if (!completed.length) return;
        setSaving(true);
        setError(false);
        try {
            onComplete(await clinicFactSuggestionsService.createInterviewSuggestions(tenantId, completed));
        } catch (cause) {
            console.error('Error creating interview suggestions:', cause);
            setError(true);
        } finally {
            setSaving(false);
        }
    };

    if (!facts.length) {
        return (
            <div className="py-12 text-center">
                <Check className="mx-auto text-accent-success" size={36} />
                <h3 className="mt-4 text-lg font-black text-graphite-900">{t('aiOnboarding.interview.completeTitle')}</h3>
                <p className="mt-2 text-sm text-graphite-500">{t('aiOnboarding.interview.noEmptyFacts')}</p>
                <Button className="mt-6" onClick={onCancel}>{t('aiOnboarding.close')}</Button>
            </div>
        );
    }

    return (
        <div>
            <div className="mb-6">
                <div className="flex items-center justify-between text-xs font-bold text-graphite-400">
                    <span>{t('aiOnboarding.interview.progress', { current: index + 1, total: facts.length })}</span>
                    <span>{t('aiOnboarding.interview.answered', { count: answeredCount })}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-ice-100">
                    <div className="h-full rounded-full bg-brand-primary transition-all" style={{ width: `${((index + 1) / facts.length) * 100}%` }} />
                </div>
            </div>

            <div className="rounded-2xl border border-ice-100 bg-ice-50 p-6">
                <h3 className="text-lg font-black text-graphite-900">{current.label[language]}</h3>
                <p className="mt-2 text-sm text-graphite-500">{current.helpText[language]}</p>
                <p className="mt-2 text-xs text-graphite-400">
                    <span className="font-bold">{t('knowledge.fields.example')}</span> {current.example[language]}
                </p>

                <div className="mt-5">
                    {(current.type === 'enum' || current.type === 'boolean') ? (
                        <select
                            value={answer}
                            onChange={(event) => setAnswer(event.target.value)}
                            className="w-full rounded-xl border border-ice-200 bg-white px-4 py-3 text-sm font-medium outline-none focus:border-brand-primary"
                        >
                            <option value="">{t('knowledge.fields.notInformed')}</option>
                            {current.options?.map((option) => <option key={option.value} value={option.value}>{option.label[language]}</option>)}
                        </select>
                    ) : current.type === 'long_text' ? (
                        <textarea
                            autoFocus rows={5} value={answer} maxLength={getClinicFactValueLimit(current)}
                            onChange={(event) => setAnswer(event.target.value)}
                            placeholder={current.example[language]}
                            className="w-full resize-y rounded-xl border border-ice-200 bg-white px-4 py-3 text-sm outline-none focus:border-brand-primary"
                        />
                    ) : (
                        <input
                            autoFocus value={answer} maxLength={getClinicFactValueLimit(current)}
                            onChange={(event) => setAnswer(event.target.value)}
                            placeholder={current.example[language]}
                            className="w-full rounded-xl border border-ice-200 bg-white px-4 py-3 text-sm outline-none focus:border-brand-primary"
                        />
                    )}
                </div>
            </div>

            {error && <p className="mt-4 text-sm font-bold text-accent-error" role="alert">{t('aiOnboarding.interview.saveError')}</p>}

            <div className="mt-6 flex flex-wrap justify-between gap-3">
                <Button variant="ghost" onClick={index === 0 ? onCancel : () => setIndex((value) => value - 1)} disabled={saving}>
                    <ArrowLeft size={16} />{index === 0 ? t('aiOnboarding.back') : t('aiOnboarding.interview.previous')}
                </Button>
                <div className="flex gap-2">
                    {index < facts.length - 1 && (
                        <Button variant="ghost" onClick={() => setIndex((value) => value + 1)} disabled={saving}>
                            <SkipForward size={16} />{t('aiOnboarding.interview.skip')}
                        </Button>
                    )}
                    {index === facts.length - 1 ? (
                        <Button onClick={() => void finish()} disabled={!answeredCount || saving}>
                            {saving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                            {t('aiOnboarding.interview.createSuggestions', { count: answeredCount })}
                        </Button>
                    ) : (
                        <Button onClick={() => setIndex((value) => value + 1)} disabled={!answer.trim() || saving}>
                            {t('aiOnboarding.interview.next')}<ArrowRight size={16} />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
