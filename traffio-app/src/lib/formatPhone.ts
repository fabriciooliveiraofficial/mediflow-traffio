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
    
    // First try it exactly as given if it has a +
    let region = raw.startsWith('+') ? regionFromE164(raw) : null;
    
    // If not found and we have a fallback, see if parsing it with the fallback works
    if (!region && fallbackCountry) {
        const parsed = parsePhoneNumberFromString(raw, getCountry(fallbackCountry).phone.region as never);
        if (parsed) region = parsed.country ?? null;
    }
    
    // Last resort, assume it contains the calling code
    if (!region) {
        region = regionFromE164(`+${digits}`);
    }
    
    return regionFlag(region);
}
