/**
 * useTenantMoney — moeda OPERACIONAL do tenant (caixa, cobranças, propostas,
 * recibos, checkout Stripe Connect).
 *
 * Valores deste domínio são armazenados e cobrados NA moeda do tenant e nunca
 * convertidos. Não confundir com useTenantCurrency, que pertence ao domínio da
 * PLATAFORMA (assinatura Traffio, ad spend): lá o valor canônico é BRL e a
 * conversão é display-only. Os dois domínios nunca se misturam.
 *
 * Moeda efetiva: tenants.currency (escolhida em Configurações) com fallback
 * para a moeda do país (countryFormats) — mesmo comportamento do trigger
 * billing_records_set_currency no banco.
 */
import { useTenant } from '../contexts/TenantContext';
import { getCurrencyForCountry, getLocaleForCountry } from '../lib/i18n/countryFormats';
import { formatCurrency } from '../lib/i18n/formatCurrency';

export function useTenantMoney() {
    const { tenant } = useTenant();

    const currency = tenant?.currency || getCurrencyForCountry(tenant?.country);
    const locale = getLocaleForCountry(tenant?.country);

    /** Formata um valor em unidades inteiras da moeda (ex.: 150.5 → "NZ$ 150,50"). */
    const format = (value: number) => formatCurrency(value, { currency, locale });

    /** Formata um valor em centavos — unidade de armazenamento de billing_records. */
    const formatCents = (cents: number) => format((cents || 0) / 100);

    /**
     * Formata um registro na moeda em que ele foi criado (snapshot), que pode
     * diferir da moeda atual do tenant se ela foi trocada depois.
     */
    const formatCentsIn = (cents: number, recordCurrency?: string | null) =>
        formatCurrency((cents || 0) / 100, { currency: recordCurrency || currency, locale });

    return { currency, locale, format, formatCents, formatCentsIn };
}
