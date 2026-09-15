import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CRM_STAGE_LABEL_KEYS, type CrmStageId } from '../../lib/crmStages';

/** Caminho principal do funil — Recuperação e Retorno são desvios e aparecem como selos. */
export const FUNNEL_PATH: CrmStageId[] = ['new_lead', 'in_contact', 'scheduled', 'showed_up', 'proposal', 'won'];
export const FUNNEL_SIDE: CrmStageId[] = ['recovery', 'recall_due'];

const CHEVRON_FIRST = '[clip-path:polygon(0_0,calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%,0_100%)]';
const CHEVRON = '[clip-path:polygon(0_0,calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%,0_100%,12px_50%)]';

interface FunnelStripProps {
    counts: Partial<Record<CrmStageId, number>>;
    selected: CrmStageId | null;
    onSelect: (stage: CrmStageId | null) => void;
}

/** Faixa clicável com o funil inteiro: onde começa, o meio e onde termina. */
export function FunnelStrip({ counts, selected, onSelect }: FunnelStripProps) {
    const { t } = useTranslation('crm');
    const toggle = (s: CrmStageId) => onSelect(selected === s ? null : s);

    return (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <div className="flex flex-1 min-w-0 overflow-x-auto custom-scrollbar pb-1" role="group" aria-label={t('today.funnel.label')}>
                {FUNNEL_PATH.map((stage, i) => {
                    const on = selected === stage;
                    const won = stage === 'won';
                    return (
                        <button
                            key={stage}
                            type="button"
                            onClick={() => toggle(stage)}
                            aria-pressed={on}
                            className={clsx(
                                'flex-1 min-w-[108px] -ml-1.5 first:ml-0 text-left py-2.5 transition-colors cursor-pointer border-none',
                                i === 0 ? `${CHEVRON_FIRST} pl-4 pr-6` : `${CHEVRON} pl-6 pr-6`,
                                on ? 'bg-brand-primary text-white'
                                    : won ? 'bg-accent-success/10 text-accent-success hover:bg-accent-success/20'
                                    : 'bg-ice-100 text-graphite-500 hover:bg-ice-200',
                            )}
                        >
                            <span className={clsx('block text-lg font-black leading-none tabular-nums', on ? 'text-white' : won ? 'text-accent-success' : 'text-graphite-900')}>
                                {counts[stage] ?? 0}
                            </span>
                            <span className="block text-[11px] font-bold mt-1 truncate">
                                {t(`stages.${CRM_STAGE_LABEL_KEYS[stage]}`)}
                                {won && <span className="font-medium opacity-70"> · {t('today.funnel.last30')}</span>}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="flex gap-2 shrink-0">
                {FUNNEL_SIDE.map(stage => {
                    const on = selected === stage;
                    const n = counts[stage] ?? 0;
                    return (
                        <button
                            key={stage}
                            type="button"
                            onClick={() => toggle(stage)}
                            aria-pressed={on}
                            className={clsx(
                                'flex items-center gap-2 px-3.5 py-2 rounded-2xl border text-xs font-bold transition-colors cursor-pointer',
                                on ? 'bg-brand-primary border-brand-primary text-white'
                                    : n > 0 ? 'bg-accent-warning/10 border-accent-warning/20 text-accent-warning hover:bg-accent-warning/20'
                                    : 'bg-white border-ice-200 text-graphite-400 hover:bg-ice-50',
                            )}
                        >
                            <span className="text-base font-black tabular-nums">{n}</span>
                            {t(`stages.${CRM_STAGE_LABEL_KEYS[stage]}`)}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** Versão da ficha: onde esta pessoa está no caminho. */
export function JourneyProgress({ stage }: { stage: CrmStageId }) {
    const { t } = useTranslation('crm');
    const pos = FUNNEL_PATH.indexOf(stage);
    const offPath = pos === -1;

    return (
        <div className="flex flex-col gap-2">
            <ol className="flex items-center gap-1" aria-label={t('today.funnel.label')}>
                {FUNNEL_PATH.map((s, i) => {
                    const done = !offPath && i < pos;
                    const current = !offPath && i === pos;
                    return (
                        <li key={s} className="flex-1 min-w-0 flex flex-col items-center gap-1">
                            <span
                                className={clsx(
                                    'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border-2',
                                    current ? 'bg-brand-primary border-brand-primary text-white'
                                        : done ? 'bg-accent-success border-accent-success text-white'
                                        : 'bg-white border-ice-200 text-graphite-300',
                                )}
                                aria-current={current ? 'step' : undefined}
                            >
                                {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                            </span>
                            <span className={clsx('text-[10px] font-bold truncate max-w-full', current ? 'text-graphite-900' : 'text-graphite-400')}>
                                {t(`stages.${CRM_STAGE_LABEL_KEYS[s]}`)}
                            </span>
                        </li>
                    );
                })}
            </ol>
            {offPath && (
                <p className="text-[11px] font-bold text-accent-warning">
                    {t('today.funnel.offPath', { stage: t(`stages.${CRM_STAGE_LABEL_KEYS[stage]}`) })}
                </p>
            )}
        </div>
    );
}
