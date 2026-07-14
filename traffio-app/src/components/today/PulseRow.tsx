import { useTranslation } from 'react-i18next';
import type { TodaySnapshot } from '../../services/todayService';

/**
 * Pulso do dia — linha discreta de contexto, sem cards nem gráficos.
 * É informação ambiente, não chamada para ação (ver SPEC §6).
 */
export function PulseRow({ pulse }: { pulse: TodaySnapshot['pulse'] }) {
    const { t } = useTranslation('today');

    const entries = [
        { value: pulse.appointmentsToday, label: t('pulse.appointments') },
        { value: pulse.showsToday, label: t('pulse.shows') },
        { value: pulse.newLeadsToday, label: t('pulse.newLeads') },
        { value: pulse.resolvedToday, label: t('pulse.resolved') },
    ];

    return (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-1">
            {entries.map(e => (
                <p key={e.label} className="text-xs font-medium text-graphite-500">
                    <span className="font-black text-graphite-700 tabular-nums">{e.value}</span> {e.label}
                </p>
            ))}
        </div>
    );
}
