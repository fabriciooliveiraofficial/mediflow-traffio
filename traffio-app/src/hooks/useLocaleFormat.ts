/**
 * useLocaleFormat — reads `locale`/`timezone` from the active tenant and exposes
 * the `formatDateTime.ts` engine pre-bound to them. Falls back to the tenant's
 * `country` registry locale, then to `DEFAULT_COUNTRY`, when `tenant.locale` is
 * not set (legacy tenants predating the `locale` column).
 */
import { useTenant } from '../contexts/TenantContext';
import { getCountry, DEFAULT_COUNTRY } from '../lib/i18n/countryFormats';
import { formatDate, formatTime, formatDateTime, formatSlot, formatWeekday, type FormatOpts } from '../lib/i18n/formatDateTime';

export function useLocaleFormat() {
    const { tenant } = useTenant();
    const locale = tenant?.locale || getCountry(tenant?.country || DEFAULT_COUNTRY).locale;
    const timezone = tenant?.timezone;

    return {
        locale,
        timezone,
        formatDate: (value: Date | string | null | undefined, opts?: Partial<FormatOpts>) =>
            formatDate(value, { locale, ...opts }),
        formatTime: (value: Date | string | null | undefined, opts?: Partial<FormatOpts>) =>
            formatTime(value, { locale, timezone, ...opts }),
        formatDateTime: (value: Date | string | null | undefined, opts?: Partial<FormatOpts>) =>
            formatDateTime(value, { locale, timezone, ...opts }),
        formatSlot: (timeStr: string | null | undefined, opts?: Partial<FormatOpts>) =>
            formatSlot(timeStr, { locale, ...opts }),
        formatWeekday: (value: Date | string | null | undefined, opts?: Partial<FormatOpts> & { length?: 'long' | 'short' }) =>
            formatWeekday(value, { locale, ...opts }),
    };
}
