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
    const countryConf = getCountry(tenant?.country || DEFAULT_COUNTRY);
    const locale = tenant?.locale || countryConf.locale;
    const timezone = tenant?.timezone;
    const hour12 = tenant?.time_format === '12h' ? true
                 : tenant?.time_format === '24h' ? false
                 : countryConf.hour12;

    return {
        locale,
        timezone,
        hour12,
        formatDate: (value: Date | string | null | undefined, opts?: Partial<FormatOpts>) =>
            formatDate(value, { locale, ...opts }),
        formatTime: (value: Date | string | null | undefined, opts?: Partial<FormatOpts>) =>
            formatTime(value, { locale, timezone, hour12, ...opts }),
        formatDateTime: (value: Date | string | null | undefined, opts?: Partial<FormatOpts>) =>
            formatDateTime(value, { locale, timezone, hour12, ...opts }),
        formatSlot: (timeStr: string | null | undefined, opts?: Partial<FormatOpts>) =>
            formatSlot(timeStr, { locale, hour12, ...opts }),
        formatWeekday: (value: Date | string | null | undefined, opts?: Partial<FormatOpts> & { length?: 'long' | 'short' }) =>
            formatWeekday(value, { locale, ...opts }),
    };
}
