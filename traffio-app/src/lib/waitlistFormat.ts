// 2024-01-07 é um domingo — base para gerar rótulos de dia da semana localizados (0=dom ... 6=sáb)
export function weekdayLabel(day: number, locale: string): string {
    const d = new Date(Date.UTC(2024, 0, 7 + day, 12));
    return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(d).replace('.', '');
}

export function waitingSinceParts(createdAt: string): { unit: 'now' | 'hours' | 'days'; count: number } {
    const hours = Math.floor((Date.now() - new Date(createdAt).getTime()) / 3600000);
    if (hours < 1) return { unit: 'now', count: 0 };
    if (hours < 24) return { unit: 'hours', count: hours };
    return { unit: 'days', count: Math.floor(hours / 24) };
}
