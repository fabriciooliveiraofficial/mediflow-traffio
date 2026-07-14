/**
 * currencies.ts — catálogo ISO 4217 para o seletor de moeda do tenant.
 *
 * A lista vem de Intl.supportedValuesOf('currency') (≈300 moedas, sem
 * manutenção manual) com nomes localizados via Intl.DisplayNames. As moedas
 * dos países suportados em countryFormats aparecem primeiro no seletor.
 */
import { COUNTRIES } from './countryFormats';

export interface CurrencyOption {
    code: string; // ISO 4217, ex.: 'NZD'
    name: string; // nome localizado, ex.: 'Dólar neozelandês'
}

/** Moedas em destaque: as dos países suportados + moedas globais comuns. */
export const FEATURED_CURRENCIES: string[] = [
    ...new Set([
        ...Object.values(COUNTRIES).map(c => c.currency),
        'USD', 'EUR', 'GBP', 'AUD', 'CAD',
    ]),
];

const FALLBACK_CODES = ['BRL', 'USD', 'NZD', 'MXN', 'EUR', 'GBP', 'AUD', 'CAD'];

export function listCurrencies(displayLocale: string): CurrencyOption[] {
    let codes: string[];
    try {
        codes = (Intl as any).supportedValuesOf('currency');
    } catch {
        codes = FALLBACK_CODES;
    }

    let displayNames: Intl.DisplayNames | null = null;
    try {
        displayNames = new Intl.DisplayNames([displayLocale], { type: 'currency' });
    } catch {
        displayNames = null;
    }

    const toOption = (code: string): CurrencyOption => {
        const name = displayNames?.of(code);
        // DisplayNames devolve o próprio código quando não conhece a moeda
        return { code, name: name && name !== code ? name : code };
    };

    const featured = FEATURED_CURRENCIES.filter(c => codes.includes(c)).map(toOption);
    const rest = codes
        .filter(c => !FEATURED_CURRENCIES.includes(c))
        .map(toOption)
        .sort((a, b) => a.name.localeCompare(b.name, displayLocale));

    return [...featured, ...rest];
}
