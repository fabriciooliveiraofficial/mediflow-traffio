import { Check, X, ShoppingBag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PLANS, PLAN_ORDER, type PlanId } from '../../config/planConfig';
import { PLAN_COMPARISON, type CompareValue } from '../../config/planComparison';

interface Props {
    /** Coluna em destaque (plano escolhido no pop-up). Sem valor, destaca o Clínica. */
    highlight?: PlanId;
}

/**
 * Tabela comparativa com uma frase de benefício por recurso — o objetivo é
 * que uma pessoa sem conhecimento técnico entenda o que está contratando.
 * Dados em src/config/planComparison.ts.
 */
export function PlanComparisonTable({ highlight = 'clinica' }: Props) {
    const { t } = useTranslation(['landing', 'billing']);

    return (
        <div className="overflow-x-auto rounded-3xl border border-ice-100 shadow-sm bg-white">
            <table className="w-full min-w-[680px] text-sm border-collapse">
                <thead>
                    <tr className="border-b border-ice-100">
                        <th scope="col" className="sticky left-0 z-10 bg-ice-50 text-left px-6 py-5 font-black text-graphite-900 w-[46%]">
                            {t('compare.resourceHeader')}
                        </th>
                        {PLAN_ORDER.map(id => {
                            const Icon = PLANS[id].icon;
                            const active = id === highlight;
                            return (
                                <th key={id} scope="col"
                                    className={`px-4 py-5 text-center font-black ${active ? 'bg-amber-50 text-amber-700' : 'bg-ice-50 text-graphite-700'}`}>
                                    <div className="flex flex-col items-center gap-1">
                                        <Icon size={18} />
                                        {t(`plans.${id}.name`, { ns: 'billing' })}
                                    </div>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {PLAN_COMPARISON.map(section => (
                        <SectionRows key={section.key} sectionKey={section.key} rows={section.rows} highlight={highlight} />
                    ))}
                </tbody>
            </table>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 border-t border-ice-100 bg-ice-50/60 text-xs font-medium text-graphite-500">
                <span className="flex items-center gap-1.5"><Check size={14} className="text-emerald-500" /> {t('compare.legend.included')}</span>
                <span className="flex items-center gap-1.5"><X size={14} className="text-graphite-300" /> {t('compare.legend.notIncluded')}</span>
                <span className="flex items-center gap-1.5"><ShoppingBag size={13} className="text-amber-600" /> {t('compare.legend.pack')}</span>
            </div>
        </div>
    );
}

function SectionRows({ sectionKey, rows, highlight }: { sectionKey: string; rows: typeof PLAN_COMPARISON[number]['rows']; highlight: PlanId }) {
    const { t } = useTranslation('landing');
    return (
        <>
            <tr className="bg-ice-50/80 border-t border-ice-100">
                <th scope="colgroup" colSpan={4} className="sticky left-0 text-left px-6 py-3 font-black text-xs text-graphite-500 uppercase tracking-widest">
                    {t(`compare.sections.${sectionKey}`)}
                </th>
            </tr>
            {rows.map(row => (
                <tr key={row.key} className="border-t border-ice-100 align-top">
                    <th scope="row" className="sticky left-0 z-10 bg-white text-left px-6 py-4 font-normal">
                        <span className="block font-bold text-graphite-800">{t(`compare.rows.${row.key}.label`)}</span>
                        <span className="block text-xs text-graphite-500 font-medium leading-relaxed mt-1">{t(`compare.rows.${row.key}.desc`)}</span>
                    </th>
                    {PLAN_ORDER.map(id => (
                        <td key={id} className={`px-4 py-4 text-center align-middle ${id === highlight ? 'bg-amber-50/50' : ''}`}>
                            <CompareCell value={row.values[id]} />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

export function CompareCell({ value }: { value: CompareValue }) {
    const { t } = useTranslation('landing');
    if (value === true) {
        return <Check size={18} className="text-emerald-500 mx-auto" aria-label={t('compare.legend.included')} />;
    }
    if (value === false) {
        return <X size={16} className="text-graphite-300 mx-auto" aria-label={t('compare.legend.notIncluded')} />;
    }
    if (value === 'pack') {
        return (
            <span className="inline-flex items-center gap-1 text-[11px] font-black text-amber-700 bg-amber-50 px-2 py-1 rounded-full whitespace-nowrap">
                <ShoppingBag size={11} /> {t('compare.values.withPack')}
            </span>
        );
    }
    return <span className="font-black text-graphite-800 text-xs leading-snug">{t(`compare.values.${value.text}`)}</span>;
}
