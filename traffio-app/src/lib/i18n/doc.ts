/**
 * doc.ts — National identification document (CPF/SSN/IRD/RFC) formatting & validation.
 * BR delegates to the existing checksum-verified CPF validator
 * (src/lib/validators/brazilianDocs.ts). Other countries use registry mask +
 * a basic length/pattern check — there is no public checksum algorithm for
 * SSN/IRD, and RFC validation is intentionally lenient (format only).
 */
import { formatCPF, validateCPF } from '../validators/brazilianDocs';
import { getCountry, type CountryCode } from './countryFormats';
import { applyMask } from './maskUtils';

const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;

export function formatDoc(rawValue: string, country: CountryCode): string {
    if (!rawValue) return '';

    if (country === 'BR') return formatCPF(rawValue);

    const mask = getCountry(country).doc.mask;
    if (mask) return applyMask(rawValue, mask);

    // No mask defined (e.g. MX/RFC — alphanumeric, not a digit mask)
    return rawValue.toUpperCase().replace(/\s+/g, '');
}

export function validateDoc(rawValue: string, country: CountryCode): boolean {
    if (!rawValue) return !getCountry(country).doc.required;

    if (country === 'BR') return validateCPF(rawValue);

    if (country === 'MX') {
        return RFC_PATTERN.test(rawValue.trim());
    }

    const digits = rawValue.replace(/\D/g, '');
    if (country === 'US') return digits.length === 9; // SSN
    if (country === 'NZ') return digits.length === 8 || digits.length === 9; // IRD number

    return rawValue.trim().length > 0;
}

export function docLabel(country: CountryCode): string {
    return getCountry(country).doc.label;
}

export function docPlaceholder(country: CountryCode): string {
    return getCountry(country).doc.placeholder;
}

export function docType(country: CountryCode): string {
    return getCountry(country).doc.type;
}

export function isDocRequired(country: CountryCode): boolean {
    return getCountry(country).doc.required;
}
