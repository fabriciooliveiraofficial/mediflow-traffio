/**
 * formatPhone.ts — Display-only phone formatter.
 *
 * Delegates to libphonenumber-js (src/lib/i18n/phone.ts) for country
 * detection, validation and national formatting — covers every country,
 * not just a hardcoded list.
 *
 * Storage format in DB is always raw digits / E.164 with country code.
 * This function is display-only — never use for sending to APIs.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { regionFlag, regionFromE164 } from './i18n/phone';
import { getCountry, type CountryCode } from './i18n/countryFormats';

export function formatPhone(raw: string | null | undefined, fallbackCountry?: CountryCode): string {
    if (!raw) return '—';

    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7) return raw;

    try {
        const region = fallbackCountry ? getCountry(fallbackCountry).phone.region : undefined;
        let parsed = raw.startsWith('+') ? parsePhoneNumberFromString(raw) : undefined;
        
        if (!parsed && region) {
            parsed = parsePhoneNumberFromString(raw, region as never);
        }
        
        if (!parsed) {
            parsed = parsePhoneNumberFromString(`+${digits}`);
        }

        if (parsed && parsed.isValid()) {
            return `+${parsed.countryCallingCode} ${parsed.formatNational()}`;
        }
    } catch {
        // fall through to raw fallback below
    }

    // Last resort: just prefix with + when it looks like a full international number
    return digits.length >= 10 ? `+${digits}` : raw;
}

/**
 * Returns just the country flag emoji for a phone number.
 * Useful to show alongside the formatted number.
 */
export function phoneFlag(raw: string | null | undefined, fallbackCountry?: CountryCode): string {
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');

    if (raw.startsWith('+')) return regionFlag(regionFromE164(raw));

    // Números salvos sem "+" quase sempre já trazem o código do país (ex.: 5541...).
    // O país da clínica só vale quando o número NÃO é válido como internacional —
    // antes ele vencia sempre e um número brasileiro aparecia com a bandeira da
    // Nova Zelândia numa clínica NZ.
    try {
        const intl = parsePhoneNumberFromString(`+${digits}`);
        if (intl?.isValid()) return regionFlag(intl.country ?? null);

        if (fallbackCountry) {
            const local = parsePhoneNumberFromString(raw, getCountry(fallbackCountry).phone.region as never);
            if (local?.isValid()) return regionFlag(local.country ?? null);
        }
    } catch {
        // cai no genérico abaixo
    }

    return regionFlag(null);
}
