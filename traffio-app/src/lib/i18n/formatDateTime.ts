/**
 * formatDateTime.ts — Single Intl.DateTimeFormat-based engine for date/time/slot
 * display, driven by tenant `locale`+`timezone`. Storage stays UTC/ISO; only the
 * display format changes here (BR: dd/MM/yyyy, 24h — US/NZ: MM/dd/yyyy, 12h — etc).
 *
 * `formatDate` is for pure calendar dates (YYYY-MM-DD, no time-of-day) — it never
 * applies a timezone conversion, since there's no instant to convert (matches the
 * no-shift guarantee `dateUtils.formatDisplayDate` already relied on).
 * `formatTime`/`formatDateTime` are for actual instants (ISO timestamps) and DO
 * apply `timezone` when given.
 * `formatSlot` formats a bare "HH:mm" agenda slot string (no date/timezone).
 */
export interface FormatOpts {
    locale?: string;
    timezone?: string;
    hour12?: boolean; // omit to let Intl pick the locale's default (12h for en-US/en-NZ, 24h for pt-BR/es-MX)
}

const FALLBACK_LOCALE = 'pt-BR';

function resolveLocale(opts: FormatOpts): string {
    return opts.locale || FALLBACK_LOCALE;
}

/** Parses "YYYY-MM-DD" (optionally with a "T..." time suffix, which is ignored) into local Y/M/D parts. */
function parseCalendarDate(value: Date | string): { year: number; month: number; day: number } | null {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
    }
    const datePart = value.split('T')[0];
    const parts = datePart.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [year, month, day] = parts;
    return { year, month, day };
}

function toInstant(value: Date | string): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Formats a calendar date (e.g. "2026-06-18" or a birth_date) — no timezone shift.
 * If the value represents an instant (Date object or datetime string with time),
 * it shifts the value to the specified timezone before formatting.
 */
export function formatDate(value: Date | string | null | undefined, opts: FormatOpts & Intl.DateTimeFormatOptions = {}): string {
    if (!value) return '';

    // Check if it's an instant (Date object or string containing T, space, or Z)
    const isInstant = value instanceof Date || (typeof value === 'string' && /[\sTZ]/.test(value));

    if (isInstant) {
        const instant = toInstant(value);
        if (instant) {
            try {
                const { locale, timezone, hour12, ...formatOpts } = opts;
                return new Intl.DateTimeFormat(resolveLocale(opts), {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    timeZone: timezone,
                    ...formatOpts,
                }).format(instant);
            } catch {
                return new Intl.DateTimeFormat(FALLBACK_LOCALE, {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                }).format(instant);
            }
        }
    }

    const parsed = parseCalendarDate(value);
    if (!parsed) return typeof value === 'string' ? value : '';

    // Local midnight — Intl formats day/month/year from these wall-clock fields directly.
    const localDate = new Date(parsed.year, parsed.month - 1, parsed.day);
    try {
        const { locale, timezone, hour12, ...formatOpts } = opts;
        return new Intl.DateTimeFormat(resolveLocale(opts), {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            ...formatOpts,
        }).format(localDate);
    } catch {
        return new Intl.DateTimeFormat(FALLBACK_LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(localDate);
    }
}

/** Formats an instant (ISO timestamp) as a time, applying `timezone` when given. */
export function formatTime(value: Date | string | null | undefined, opts: FormatOpts = {}): string {
    if (!value) return '';
    const instant = toInstant(value);
    if (!instant) return '';
    try {
        return new Intl.DateTimeFormat(resolveLocale(opts), {
            hour: 'numeric',
            minute: '2-digit',
            hour12: opts.hour12,
            timeZone: opts.timezone,
        }).format(instant);
    } catch {
        return new Intl.DateTimeFormat(FALLBACK_LOCALE, { hour: 'numeric', minute: '2-digit' }).format(instant);
    }
}

/** Formats an instant as date + time combined, applying `timezone` when given. */
export function formatDateTime(value: Date | string | null | undefined, opts: FormatOpts = {}): string {
    if (!value) return '';
    const instant = toInstant(value);
    if (!instant) return '';
    try {
        return new Intl.DateTimeFormat(resolveLocale(opts), {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: opts.hour12,
            timeZone: opts.timezone,
        }).format(instant);
    } catch {
        return new Intl.DateTimeFormat(FALLBACK_LOCALE, {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit',
        }).format(instant);
    }
}

/** Formats a bare agenda slot ("08:00" / "14:30") per locale — e.g. "8:00 AM" for en-US. No timezone applies. */
export function formatSlot(timeStr: string | null | undefined, opts: FormatOpts = {}): string {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return timeStr;
    const ref = new Date(2000, 0, 1, h, m);
    try {
        return new Intl.DateTimeFormat(resolveLocale(opts), {
            hour: 'numeric',
            minute: '2-digit',
            hour12: opts.hour12,
        }).format(ref);
    } catch {
        return timeStr;
    }
}

/** Formats a weekday name (long or short) for a calendar date — follows the UI language (Pilar 2). */
export function formatWeekday(value: Date | string | null | undefined, opts: FormatOpts & { length?: 'long' | 'short' } = {}): string {
    if (!value) return '';
    const parsed = parseCalendarDate(value);
    if (!parsed) return '';
    const localDate = new Date(parsed.year, parsed.month - 1, parsed.day);
    try {
        return new Intl.DateTimeFormat(resolveLocale(opts), { weekday: opts.length || 'long' }).format(localDate);
    } catch {
        return new Intl.DateTimeFormat(FALLBACK_LOCALE, { weekday: opts.length || 'long' }).format(localDate);
    }
}
