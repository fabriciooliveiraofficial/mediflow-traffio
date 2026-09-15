import { useEffect, useRef } from 'react';
import { X, Check, Plus, ArrowRight, Sparkles, Users, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    PLANS, PLAN_ORDER, formatPrice, AI_PACKAGES, WHATSAPP_EXTRA_NUMBER_PRICE,
    type BillingCycle, type PlanId,
} from '../../config/planConfig';
import { planIncluded, planGains, planExclusiveTo } from '../../config/planComparison';
import { PlanComparisonTable } from './PlanComparisonTable';

interface Props {
    planId: PlanId;
    billingCycle: BillingCycle;
    onChangePlan: (id: PlanId) => void;
    onClose: () => void;
    onStart: (id: PlanId) => void;
}

/**
 * Detalhe de um plano: resumo, o que ganha em relação ao plano anterior, o que
 * fica de fora (ganho do próximo) e a tabela comparativa completa com a coluna
 * do plano escolhido em destaque. Aberto pelos cards de Soluções e de Planos.
 */
export function PlanDetailsModal({ planId, billingCycle, onChangePlan, onClose, onStart }: Props) {
    const { t } = useTranslation(['landing', 'billing']);
    const dialogRef = useRef<HTMLDivElement>(null);
    const plan = PLANS[planId];
    const Icon = plan.icon;
    const price = billingCycle === 'annual' ? plan.annualMonthlyPrice : plan.monthlyPrice;

    const index = PLAN_ORDER.indexOf(planId);
    const previous = index > 0 ? PLAN_ORDER[index - 1] : null;
    const next = index < PLAN_ORDER.length - 1 ? PLAN_ORDER[index + 1] : null;
    // Sem plano anterior (Essencial), não há "ganho" a calcular — mostra o que
    // o plano JÁ inclui. Sem isso, o plano de entrada só exibia a caixa de
    // "recursos exclusivos dos planos maiores" e parecia não ter nada incluso.
    const includedGroups = previous ? planGains(previous, planId) : planIncluded(planId);
    // 'pack' nunca entra aqui (ver planExclusiveTo): quem pode comprar um
    // pacote de IA não está "sem" o recurso, isso já é explicado no bloco de
    // IA acima — listar de novo como "de fora" soaria contraditório.
    const exclusiveGroups = next ? planExclusiveTo(planId, next) : [];
    const smallestPack = AI_PACKAGES[0];

    // Esc fecha; trava o scroll da página por trás; foco inicial no diálogo
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        dialogRef.current?.focus();
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = previousOverflow;
        };
    }, [onClose]);

    // Troca de plano dentro do pop-up volta ao topo
    useEffect(() => { dialogRef.current?.scrollTo({ top: 0 }); }, [planId]);

    const highlights = [
        {
            icon: Sparkles,
            label: t('guide.modal.highlightAi'),
            value: plan.aiConversationsIncluded > 0
                ? t('guide.modal.aiPerMonth', { count: plan.aiConversationsIncluded })
                : t('guide.modal.aiByPack', { price: formatPrice(smallestPack.priceBrl) }),
        },
        {
            icon: Users,
            label: t('guide.modal.highlightProfessionals'),
            value: plan.maxProfessionals === null ? t('compare.values.unlimited') : t('guide.modal.upTo', { count: plan.maxProfessionals }),
        },
        {
            icon: Building2,
            label: t('guide.modal.highlightLocations'),
            value: plan.maxLocations === null ? t('compare.values.unlimited') : t('guide.modal.upTo', { count: plan.maxLocations }),
        },
    ];

    return (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-graphite-900/60 backdrop-blur-sm px-0 sm:px-6 py-0 sm:py-8"
            onClick={onClose}>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="plan-details-title"
                tabIndex={-1}
                onClick={e => e.stopPropagation()}
                className="relative bg-white w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl outline-none"
            >
                {/* Topo fixo: troca de plano + fechar */}
                <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-ice-100 px-5 sm:px-8 py-4 flex items-center justify-between gap-4">
                    <div className="inline-flex items-center bg-ice-100 border border-ice-200/60 rounded-2xl p-1 gap-1 overflow-x-auto">
                        {PLAN_ORDER.map(id => (
                            <button key={id} onClick={() => onChangePlan(id)}
                                aria-pressed={id === planId}
                                className={`px-4 py-2 rounded-xl text-sm font-black whitespace-nowrap transition-all border-none cursor-pointer ${id === planId ? 'bg-white text-graphite-900 shadow-sm' : 'bg-transparent text-graphite-500 hover:text-graphite-800'}`}>
                                {t(`plans.${id}.name`, { ns: 'billing' })}
                            </button>
                        ))}
                    </div>
                    <button onClick={onClose} aria-label={t('guide.modal.close')}
                        className="w-10 h-10 shrink-0 rounded-xl bg-ice-100 hover:bg-ice-200 text-graphite-600 flex items-center justify-center border-none cursor-pointer">
                        <X size={18} />
                    </button>
                </div>

                <div className="px-5 sm:px-8 py-8 space-y-10">
                    {/* Resumo */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
                        <div className="lg:col-span-3 space-y-4">
                            <div className="flex items-center gap-3">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${plan.badgeClass}`}>
                                    <Icon size={24} />
                                </div>
                                <div>
                                    <p className="text-xs font-black text-amber-600 uppercase tracking-widest">{t('guide.modal.eyebrow')}</p>
                                    <h2 id="plan-details-title" className="text-3xl font-black text-graphite-900 leading-tight">
                                        {t(`plans.${planId}.name`, { ns: 'billing' })}
                                    </h2>
                                </div>
                            </div>
                            <p className="text-lg font-bold text-graphite-800">{t(`guide.profiles.${planId}.title`)}</p>
                            <p className="text-graphite-500 font-medium leading-relaxed">{t(`guide.profiles.${planId}.fit`)}</p>
                        </div>

                        <div className="lg:col-span-2 bg-ice-50 border border-ice-100 rounded-2xl p-6">
                            <div className="flex items-baseline gap-1">
                                <span className="text-4xl font-black text-graphite-900">{formatPrice(price)}</span>
                                <span className="text-graphite-400 text-sm font-medium">{t('pricing.perMonth')}</span>
                            </div>
                            <p className="text-xs font-bold text-graphite-500 mt-1 mb-5">
                                {billingCycle === 'annual'
                                    ? t('guide.modal.annualNote', { total: formatPrice(price * 12) })
                                    : t('guide.modal.monthlyNote')}
                            </p>
                            <button onClick={() => onStart(planId)}
                                className="w-full py-3.5 rounded-2xl font-black text-sm bg-gradient-to-r from-amber-500 to-yellow-400 text-white shadow-lg shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all border-none cursor-pointer flex items-center justify-center gap-2">
                                {planId === 'rede' ? t('pricing.talkToSales') : t('pricing.startTrial14')}
                                <ArrowRight size={16} />
                            </button>
                            <p className="text-center text-xs text-graphite-400 font-medium mt-3">{t('pricing.freeTrialCancelAnytime')}</p>
                        </div>
                    </div>

                    {/* Destaques */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {highlights.map(h => (
                            <div key={h.label} className="border border-ice-100 rounded-2xl p-5">
                                <div className="flex items-center gap-2 text-graphite-500 mb-2">
                                    <h.icon size={16} className="text-amber-500" />
                                    <span className="text-xs font-black uppercase tracking-wider">{h.label}</span>
                                </div>
                                <p className="text-lg font-black text-graphite-900 leading-snug">{h.value}</p>
                            </div>
                        ))}
                    </div>

                    {/* O que a IA faz — linguagem simples */}
                    <div className="bg-amber-50/60 border border-amber-100 rounded-2xl p-6">
                        <h3 className="text-base font-black text-graphite-900 mb-2 flex items-center gap-2">
                            <Sparkles size={16} className="text-amber-500" /> {t('guide.modal.aiExplainTitle')}
                        </h3>
                        <p className="text-sm text-graphite-600 font-medium leading-relaxed">
                            {plan.aiConversationsIncluded > 0
                                ? t('guide.modal.aiExplainIncluded', { count: plan.aiConversationsIncluded })
                                : t('guide.modal.aiExplainPack', { units: smallestPack.units, price: formatPrice(smallestPack.priceBrl) })}
                        </p>
                        <p className="text-xs text-graphite-500 font-medium leading-relaxed mt-3">{t('guide.modal.aiExplainSafety')}</p>
                    </div>

                    {/* Incluso x exclusivo de planos maiores */}
                    {(includedGroups.length > 0 || exclusiveGroups.length > 0) && (
                        <div className={`grid grid-cols-1 ${includedGroups.length > 0 && exclusiveGroups.length > 0 ? 'md:grid-cols-2' : ''} gap-6`}>
                            {includedGroups.length > 0 && (
                                <div className="border border-emerald-100 bg-emerald-50/40 rounded-2xl p-6">
                                    <h3 className="text-sm font-black text-graphite-900 mb-4">
                                        {previous
                                            ? t('guide.modal.gainsTitle', { plan: t(`plans.${previous}.name`, { ns: 'billing' }) })
                                            : t('guide.modal.includedTitle', { plan: t(`plans.${planId}.name`, { ns: 'billing' }) })}
                                    </h3>
                                    <div className="space-y-4">
                                        {includedGroups.map(g => (
                                            <div key={g.sectionKey}>
                                                <p className="text-[10px] font-black text-emerald-700/70 uppercase tracking-widest mb-1.5">
                                                    {t(`compare.sections.${g.sectionKey}`)}
                                                </p>
                                                <ul className="space-y-2">
                                                    {g.rows.map(r => (
                                                        <li key={r.key} className="flex items-start gap-2.5 text-sm text-graphite-700 font-medium">
                                                            <Check size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                                                            <span>
                                                                {t(`compare.rows.${r.key}.label`)}
                                                                {/* Valor descritivo (ex.: "Até 2", "5 GB") — sem ele, o limite some da lista */}
                                                                {typeof r.values[planId] === 'object' && (
                                                                    <span className="text-graphite-400"> · {t(`compare.values.${(r.values[planId] as { text: string }).text}`)}</span>
                                                                )}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {next && exclusiveGroups.length > 0 && (
                                <div className="border border-ice-100 bg-ice-50/60 rounded-2xl p-6">
                                    <h3 className="text-sm font-black text-graphite-900 mb-4">
                                        {t('guide.modal.missingTitle', { plan: t(`plans.${next}.name`, { ns: 'billing' }) })}
                                    </h3>
                                    <div className="space-y-4">
                                        {exclusiveGroups.map(g => (
                                            <div key={g.sectionKey}>
                                                <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1.5">
                                                    {t(`compare.sections.${g.sectionKey}`)}
                                                </p>
                                                <ul className="space-y-2">
                                                    {g.rows.map(r => (
                                                        <li key={r.key} className="flex items-start gap-2.5 text-sm text-graphite-600 font-medium">
                                                            <Plus size={15} className="text-graphite-400 shrink-0 mt-0.5" />
                                                            {t(`compare.rows.${r.key}.label`)}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => onChangePlan(next)}
                                        className="mt-5 text-sm font-black text-amber-700 hover:text-amber-800 bg-transparent border-none cursor-pointer p-0 flex items-center gap-1">
                                        {t('guide.modal.seePlan', { plan: t(`plans.${next}.name`, { ns: 'billing' }) })} <ArrowRight size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Tabela completa */}
                    <div>
                        <h3 className="text-xl font-black text-graphite-900 mb-1">{t('guide.modal.tableTitle')}</h3>
                        <p className="text-sm text-graphite-500 font-medium mb-5">{t('guide.modal.tableSubtitle')}</p>
                        <PlanComparisonTable highlight={planId} />
                        <p className="text-xs text-graphite-400 font-medium mt-4 leading-relaxed">
                            {t('guide.modal.footnote', { price: formatPrice(WHATSAPP_EXTRA_NUMBER_PRICE) })}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
