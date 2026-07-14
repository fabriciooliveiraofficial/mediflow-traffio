import type { LucideIcon } from 'lucide-react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';

export interface QueueCardItem {
    id: string;
    title: string;
    subtitle?: string;
    /** Texto à direita (ex.: tempo de espera) com semáforo de urgência */
    meta?: string;
    metaTone?: 'neutral' | 'warn' | 'danger';
}

interface QueueCardProps {
    icon: LucideIcon;
    title: string;
    count: number;
    items: QueueCardItem[];
    /** Rodapé "Ver todos (N)" — roteia para a superfície operável completa */
    viewAllLabel: string;
    onViewAll: () => void;
    onItemClick?: (id: string) => void;
    /** Fila zerada: card compacto "em dia" (nunca some — o vazio é informação) */
    allClearLabel: string;
    /** Borda de atenção quando há itens (filas operacionais urgentes) */
    urgent?: boolean;
}

const META_TONE_CLASS: Record<NonNullable<QueueCardItem['metaTone']>, string> = {
    neutral: 'text-graphite-400',
    warn: 'text-accent-warning',
    danger: 'text-accent-error animate-pulse',
};

export function QueueCard({
    icon: Icon, title, count, items, viewAllLabel, onViewAll, onItemClick, allClearLabel, urgent,
}: QueueCardProps) {
    const isClear = count === 0;

    if (isClear) {
        return (
            <div className="bg-white border border-ice-100 rounded-3xl shadow-sm p-5 flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-ice-50 text-graphite-300 shrink-0">
                    <Icon size={20} className="stroke-[2.5px]" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-graphite-900 truncate">{title}</p>
                    <p className="text-xs font-medium text-graphite-400 flex items-center gap-1.5 mt-0.5">
                        <CheckCircle2 size={13} className="text-accent-success shrink-0" />
                        {allClearLabel}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={clsx(
            'bg-white border rounded-3xl shadow-sm overflow-hidden',
            urgent ? 'border-amber-200 border-l-4 border-l-amber-400' : 'border-ice-100',
        )}>
            <div className="p-5 pb-3 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-3 rounded-2xl bg-brand-primary/10 text-brand-primary shrink-0">
                        <Icon size={20} className="stroke-[2.5px]" />
                    </div>
                    <p className="text-sm font-black text-graphite-900">{title}</p>
                </div>
                <span className="text-3xl font-black text-graphite-900 tracking-tighter tabular-nums shrink-0">
                    {count}
                </span>
            </div>

            <div className="px-5 pb-2 space-y-1">
                {items.map(item => (
                    <button
                        key={item.id}
                        onClick={() => onItemClick?.(item.id)}
                        disabled={!onItemClick}
                        className={clsx(
                            'w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left transition-colors bg-transparent border-0',
                            onItemClick ? 'cursor-pointer hover:bg-ice-50' : 'cursor-default',
                        )}
                    >
                        <div className="min-w-0">
                            <p className="text-xs font-bold text-graphite-800 truncate">{item.title}</p>
                            {item.subtitle && (
                                <p className="text-[11px] font-medium text-graphite-400 truncate">{item.subtitle}</p>
                            )}
                        </div>
                        {item.meta && (
                            <span className={clsx(
                                'text-[11px] font-black shrink-0 tabular-nums',
                                META_TONE_CLASS[item.metaTone || 'neutral'],
                            )}>
                                {item.meta}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            <button
                onClick={onViewAll}
                className="w-full flex items-center justify-center gap-1.5 px-5 py-3 border-t border-ice-100 bg-transparent text-xs font-black text-brand-primary hover:bg-ice-50 transition-colors cursor-pointer"
            >
                {viewAllLabel}
                <ArrowRight size={14} />
            </button>
        </div>
    );
}
