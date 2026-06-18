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

export function formatPhone(raw: string | null | undefined): string {
    if (!raw) return '—';

    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7) return raw;

    try {
        const parsed = parsePhoneNumberFromString(raw.startsWith('+') ? raw : `+${digits}`);
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
export function phoneFlag(raw: string | null | undefined): string {
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    const region = regionFromE164(raw.startsWith('+') ? raw : `+${digits}`);
    return regionFlag(region);
}
