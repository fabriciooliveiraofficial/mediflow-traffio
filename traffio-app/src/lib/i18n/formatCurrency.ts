/**
 * formatCurrency.ts — pure Intl.NumberFormat-based currency display helper.
 *
 * This is purely a DISPLAY formatter. It never converts values — the caller
 * (see src/hooks/useTenantCurrency.ts) is responsible for any BRL -> target
 * currency multiplication. BRL remains the source of truth everywhere else
 * (billing, Stripe, ad spend storage) — this file only renders a number.
 */
export interface CurrencyFormatOpts {
    locale?: string;
    currency?: string;
}

const FALLBACK_LOCALE = 'pt-BR';
const FALLBACK_CURRENCY = 'BRL';

export function formatCurrency(value: number, opts: CurrencyFormatOpts = {}): string {
    const locale = opts.locale || FALLBACK_LOCALE;
    const currency = opts.currency || FALLBACK_CURRENCY;
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    } catch {
        return new Intl.NumberFormat(FALLBACK_LOCALE, {
            style: 'currency',
            currency: FALLBACK_CURRENCY,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }
}
