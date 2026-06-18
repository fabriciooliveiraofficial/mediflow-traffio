import { formatDate } from './i18n/formatDateTime';

/**
 * Formats a date from the database (YYYY-MM-DD) to display format, without
 * timezone shifts. Defaults to `dd/MM/yyyy` (pt-BR) when `locale` is omitted,
 * matching the original BR-only behavior — pass `locale` for country-aware
 * display (e.g. `formatDisplayDate(dbDate, 'en-US')` → `MM/dd/yyyy`).
 */
export const formatDisplayDate = (dbDate: string | null | undefined, locale?: string): string => {
    return formatDate(dbDate, { locale });
};
