import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';
import { getTenantNow } from '../../lib/timezoneUtils';

/**
 * Relógio fixo do header — mostra a hora atual do tenant (fuso + formato 12h/24h
 * definidos em Configurações), não a hora local do navegador de quem está logado.
 *
 * `getTenantNow` já devolve um Date "deslocado" para o fuso do tenant (seus
 * getters locais == relógio do tenant). Por isso formatamos aqui com
 * `Intl.DateTimeFormat` SEM passar `timeZone` — aplicar o fuso de novo somaria
 * um segundo deslocamento (ver useLocaleFormat: essa função é só para instantes
 * "crus", não para o resultado já ajustado do getTenantNow).
 */
export function TenantClock() {
    const { timezone, locale, hour12 } = useLocaleFormat();
    const [now, setNow] = useState(() => getTenantNow(timezone));
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!timezone) return;
        setNow(getTenantNow(timezone));

        const msToNextMinute = 60000 - (Date.now() % 60000);
        const alignTimeout = setTimeout(() => {
            setNow(getTenantNow(timezone));
            intervalRef.current = setInterval(() => setNow(getTenantNow(timezone)), 60000);
        }, msToNextMinute);

        return () => {
            clearTimeout(alignTimeout);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [timezone]);

    if (!timezone) return null;

    const timeStr = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12 }).format(now);
    const dateStr = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(now);
    const weekdayStr = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(now);

    return (
        <div
            className="hidden md:flex items-center gap-2.5 bg-white border border-ice-100 px-4 py-2.5 rounded-2xl shadow-sm shrink-0"
            title={timezone}
        >
            <Clock size={16} className="text-brand-primary shrink-0" />
            <div className="flex items-baseline gap-1.5 leading-none">
                <span className="text-sm font-black text-graphite-900 tabular-nums">{timeStr}</span>
                <span className="hidden lg:inline text-xs font-medium text-graphite-400 capitalize">
                    {weekdayStr}, {dateStr}
                </span>
            </div>
        </div>
    );
}
