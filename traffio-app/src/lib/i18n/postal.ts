/**
 * postal.ts — Postal code (CEP/ZIP/Postcode/Código Postal) formatting & validation.
 * Mask and label come from the country registry (countryFormats.ts) — adding a
 * new country there is enough to get formatting/validation here for free.
 */
import { getCountry, type CountryCode } from './countryFormats';
import { applyMask } from './maskUtils';

/** Formats a postal code per the country's mask (e.g. BR: "80010-000"). */
export function formatPostal(rawValue: string, country: CountryCode): string {
    if (!rawValue) return '';
    const mask = getCountry(country).postal.mask;
    return applyMask(rawValue, mask);
}

/**
 * Validates a postal code's digit length for the given country.
 * US is the only registry entry with a variable length (ZIP or ZIP+4).
 */
export function validatePostal(rawValue: string, country: CountryCode): boolean {
    const digits = (rawValue || '').replace(/\D/g, '');
    switch (country) {
        case 'BR':
            return digits.length === 8;
        case 'US':
            return digits.length === 5 || digits.length === 9;
        case 'NZ':
            return digits.length === 4;
        case 'MX':
            return digits.length === 5;
        default:
            return digits.length > 0;
    }
}

export function postalLabel(country: CountryCode): string {
    return getCountry(country).postal.label;
}

export function postalPlaceholder(country: CountryCode): string {
    return getCountry(country).postal.placeholder;
}

export function postalLookupProvider(country: CountryCode): 'brasilapi' | 'zippopotam' {
    return getCountry(country).postal.lookupProvider;
}
