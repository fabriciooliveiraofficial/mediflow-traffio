/**
 * phone.ts — Phone helpers built on libphonenumber-js.
 *
 * Storage rule: phone numbers are ALWAYS persisted in E.164 (+5541997759569).
 * The country is embedded in the number itself — no separate "phone country"
 * column is needed. These helpers convert between raw input, E.164 and the
 * national display format for a given country.
 */
import {
    AsYouType,
    isValidPhoneNumber,
    parsePhoneNumberFromString,
} from 'libphonenumber-js';
import { COUNTRIES, type CountryCode, getCountry } from './countryFormats';

/**
 * Converts raw user input (national or international) to E.164 for storage.
 * Returns null if the number cannot be parsed/validated for the given country.
 */
export function toE164(rawInput: string, country: CountryCode): string | null {
    if (!rawInput) return null;
    try {
        const parsed = parsePhoneNumberFromString(rawInput, getCountry(country).phone.region as never);
        if (!parsed || !parsed.isValid()) return null;
        return parsed.number; // E.164
    } catch {
        return null;
    }
}

/** Formats an E.164 (or local) number for national display (e.g. "(41) 99775-9569"). */
export function formatNational(e164: string | null | undefined, fallbackCountry?: CountryCode): string {
    if (!e164) return '';
    try {
        const region = fallbackCountry ? getCountry(fallbackCountry).phone.region : undefined;
        const parsed = parsePhoneNumberFromString(e164, region as never);
        if (!parsed) return e164;
        return parsed.formatNational();
    } catch {
        return e164;
    }
}

/** Formats an E.164 (or local) number for international display (e.g. "+55 41 99775-9569"). */
export function formatInternational(e164: string | null | undefined, fallbackCountry?: CountryCode): string {
    if (!e164) return '';
    try {
        const region = fallbackCountry ? getCountry(fallbackCountry).phone.region : undefined;
        const parsed = parsePhoneNumberFromString(e164, region as never);
        if (!parsed) return e164;
        return parsed.formatInternational();
    } catch {
        return e164;
    }
}

/** Validates whether `rawInput` is a valid phone number for `country`. */
export function isValidPhone(rawInput: string, country: CountryCode): boolean {
    if (!rawInput) return false;
    try {
        return isValidPhoneNumber(rawInput, getCountry(country).phone.region as never);
    } catch {
        return false;
    }
}

/**
 * Resolves the ISO 3166-1 alpha-2 region embedded in an E.164 number, for ANY
 * country libphonenumber recognizes (not just BR/US/NZ/MX). Use this for
 * display purposes (e.g. flags) — use `phoneCountry` when you need a
 * registry-restricted CountryCode for field formatting.
 */
export function regionFromE164(e164: string | null | undefined): string | null {
    if (!e164) return null;
    try {
        const parsed = parsePhoneNumberFromString(e164);
        return parsed?.country ?? null;
    } catch {
        return null;
    }
}

/** Resolves the country embedded in an E.164 number, restricted to our 4-country registry. */
export function phoneCountry(e164: string | null | undefined): CountryCode | null {
    const region = regionFromE164(e164);
    return region && region in COUNTRIES ? (region as CountryCode) : null;
}

/**
 * Converts any ISO 3166-1 alpha-2 region code to its flag emoji via Unicode
 * regional indicator symbols. Works for every country, not just the registry.
 */
export function regionFlag(region: string | null | undefined): string {
    if (!region || region.length !== 2) return '🌍';
    const codePoints = region
        .toUpperCase()
        .split('')
        .map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65));
    return String.fromCodePoint(...codePoints);
}

/**
 * Live-formats input as the user types (for controlled inputs), masked to
 * the given country's national format. Does not validate — purely cosmetic.
 */
export function formatAsYouType(rawInput: string, country: CountryCode): string {
    try {
        const formatter = new AsYouType(getCountry(country).phone.region as never);
        return formatter.input(rawInput);
    } catch {
        return rawInput;
    }
}

/** Returns the flag emoji for a given country code. */
export function countryFlag(country: CountryCode | null | undefined): string {
    if (!country) return '🌍';
    return getCountry(country).flag;
}
