/**
 * countryFormats.ts — Single source of truth for field-level internationalization.
 *
 * "Internationalizing" a field here means: mask/format, validation, label and
 * lookup provider adapt to a chosen country. This is NOT UI language/translation
 * (see src/lib/i18n para esse pilar) — it's data formatting.
 *
 * Extend by adding a new entry to COUNTRIES. Everything else (inputs, services,
 * display helpers) reads from this registry — never hardcode a country here twice.
 */

export type CountryCode = 'BR' | 'US' | 'NZ' | 'MX';

export interface AddressFieldDef {
    key: 'street' | 'number' | 'complement' | 'neighborhood' | 'city' | 'state' | 'postcode';
    label: string;
    required: boolean;
}

export interface CountryFormat {
    code: CountryCode;
    name: string;
    flag: string;
    dialCode: string; // e.g. '+55'

    phone: {
        // libphonenumber-js country alpha-2 code
        region: string; // 'BR' | 'US' | 'NZ' | 'MX'
        placeholder: string; // example national format for input placeholder
    };

    postal: {
        label: string; // 'CEP' | 'ZIP code' | 'Postcode' | 'Código Postal'
        placeholder: string;
        mask: string; // '#' = digit placeholder, used for display masking
        lookupProvider: 'brasilapi' | 'zippopotam';
    };

    doc: {
        type: string; // 'cpf' | 'ssn' | 'ird' | 'rfc'
        label: string; // 'CPF' | 'SSN' | 'IRD Number' | 'RFC'
        placeholder: string;
        mask?: string; // optional display mask
        required: boolean;
    };

    addressFields: AddressFieldDef[];

    // Display/UI locale defaults (numeric date/time formats; long month names
    // follow the chosen UI language — see Pilar 2, TASKLIST-I18N-LANGUAGE.md)
    locale: string; // BCP-47, used with Intl.DateTimeFormat
    dateFormat: string; // human-readable hint, e.g. 'dd/MM/yyyy'
    timeFormat: string; // human-readable hint, e.g. 'HH:mm' | 'h:mm a'
    hour12: boolean;

    // ISO 4217 currency code for this country. BRL is always the source of
    // truth for stored/charged amounts (billing, Stripe, ad spend) — this is
    // only used to pick a *display* currency for analytics/dashboard values
    // (see src/hooks/useTenantCurrency.ts). Never used for billing math.
    currency: string;
}

export const COUNTRIES: Record<CountryCode, CountryFormat> = {
    BR: {
        code: 'BR',
        name: 'Brasil',
        flag: '🇧🇷',
        dialCode: '+55',
        phone: { region: 'BR', placeholder: '(41) 99775-9569' },
        postal: { label: 'CEP', placeholder: '80010-000', mask: '#####-###', lookupProvider: 'brasilapi' },
        doc: { type: 'cpf', label: 'CPF', placeholder: '000.000.000-00', mask: '###.###.###-##', required: true },
        addressFields: [
            { key: 'postcode', label: 'CEP', required: true },
            { key: 'street', label: 'Endereço (Rua, Av...)', required: true },
            { key: 'number', label: 'Nº', required: false },
            { key: 'complement', label: 'Complemento', required: false },
            { key: 'neighborhood', label: 'Bairro', required: false },
            { key: 'city', label: 'Cidade', required: false },
            { key: 'state', label: 'Estado', required: false },
        ],
        locale: 'pt-BR',
        dateFormat: 'dd/MM/yyyy',
        timeFormat: 'HH:mm',
        hour12: false,
        currency: 'BRL',
    },
    US: {
        code: 'US',
        name: 'United States',
        flag: '🇺🇸',
        dialCode: '+1',
        phone: { region: 'US', placeholder: '(404) 925-7024' },
        postal: { label: 'ZIP code', placeholder: '10001', mask: '#####-####', lookupProvider: 'zippopotam' },
        doc: { type: 'ssn', label: 'SSN', placeholder: '000-00-0000', mask: '###-##-####', required: false },
        addressFields: [
            { key: 'street', label: 'Street address', required: true },
            { key: 'number', label: 'Apt / Suite #', required: false },
            { key: 'city', label: 'City', required: true },
            { key: 'state', label: 'State', required: true },
            { key: 'postcode', label: 'ZIP code', required: true },
        ],
        locale: 'en-US',
        dateFormat: 'MM/dd/yyyy',
        timeFormat: 'h:mm a',
        hour12: true,
        currency: 'USD',
    },
    NZ: {
        code: 'NZ',
        name: 'New Zealand',
        flag: '🇳🇿',
        dialCode: '+64',
        phone: { region: 'NZ', placeholder: '21 123 4567' },
        postal: { label: 'Postcode', placeholder: '6011', mask: '####', lookupProvider: 'zippopotam' },
        doc: { type: 'ird', label: 'IRD Number', placeholder: '123-456-789', mask: '###-###-###', required: false },
        addressFields: [
            { key: 'street', label: 'Street address', required: true },
            { key: 'number', label: 'Unit / Apartment', required: false },
            { key: 'city', label: 'Suburb / City', required: true },
            { key: 'state', label: 'Region', required: false },
            { key: 'postcode', label: 'Postcode', required: true },
        ],
        locale: 'en-NZ',
        dateFormat: 'dd/MM/yyyy',
        timeFormat: 'h:mm a',
        hour12: true,
        currency: 'NZD',
    },
    MX: {
        code: 'MX',
        name: 'México',
        flag: '🇲🇽',
        dialCode: '+52',
        phone: { region: 'MX', placeholder: '55 1234 5678' },
        postal: { label: 'Código Postal', placeholder: '01000', mask: '#####', lookupProvider: 'zippopotam' },
        doc: { type: 'rfc', label: 'RFC', placeholder: 'XAXX010101000', mask: undefined, required: false },
        addressFields: [
            { key: 'postcode', label: 'Código Postal', required: true },
            { key: 'street', label: 'Calle y número', required: true },
            { key: 'number', label: 'Núm. interior', required: false },
            { key: 'neighborhood', label: 'Colonia', required: false },
            { key: 'city', label: 'Municipio / Ciudad', required: false },
            { key: 'state', label: 'Estado', required: false },
        ],
        locale: 'es-MX',
        dateFormat: 'dd/MM/yyyy',
        timeFormat: 'HH:mm',
        hour12: false,
        currency: 'MXN',
    },
};

export const DEFAULT_COUNTRY: CountryCode = 'BR';

export function getCountry(code: string | null | undefined): CountryFormat {
    const normalized = (code || '').toUpperCase() as CountryCode;
    return COUNTRIES[normalized] || COUNTRIES[DEFAULT_COUNTRY];
}

export function listCountries(): CountryFormat[] {
    return Object.values(COUNTRIES);
}

export function getLocaleForCountry(code: string | null | undefined): string {
    return getCountry(code).locale;
}

/** ISO 4217 currency for display purposes only — see `CountryFormat.currency` doc. */
export function getCurrencyForCountry(code: string | null | undefined): string {
    return getCountry(code).currency;
}

/**
 * Resolves the true display country for a patient, working around the database's 
 * hardcoded 'BR' default for legacy or booking-widget created patients in foreign clinics.
 */
export function resolvePatientCountry(
    patientCountry: string | null | undefined, 
    tenantCountry: string | null | undefined, 
    patientCpf?: string | null,
    patientNationalId?: string | null
): CountryCode {
    const pc = (patientCountry || '') as CountryCode;
    const tc = (tenantCountry || '') as CountryCode;
    
    // If the patient's country is exactly the DB default 'BR',
    // but the clinic is NOT in Brazil, AND the patient hasn't filled a CPF,
    // it's highly likely they are a local patient who inherited the DB default.
    // We check !patientCpf because legacy BR patients HAVE a CPF. 
    // Generic documents go into national_id, so if they only have national_id 
    // and they are in NZ, we should format it as NZ (IRD).
    if (pc === 'BR' && tc && tc !== 'BR' && !patientCpf) {
        return tc;
    }
    
    // Otherwise, respect explicitly set patient country or fallback chain
    return pc || tc || (patientCpf ? 'BR' : DEFAULT_COUNTRY);
}

/** UI language each country maps to by default (Pilar 2 — see TASKLIST-I18N-LANGUAGE.md). */
export const COUNTRY_TO_LANGUAGE: Record<CountryCode, 'pt-BR' | 'en' | 'es'> = {
    BR: 'pt-BR',
    US: 'en',
    NZ: 'en',
    MX: 'es',
};

export function getLanguageForCountry(code: string | null | undefined): 'pt-BR' | 'en' | 'es' {
    const normalized = (code || '').toUpperCase() as CountryCode;
    return COUNTRY_TO_LANGUAGE[normalized] || 'pt-BR';
}

/** Detects a matching CountryCode from an address suggestion object or address string. */
export function detectCountryFromSuggestion(suggestion: { countryCode?: string; country?: string; label?: string } | string | null | undefined): CountryCode | null {
    if (!suggestion) return null;
    if (typeof suggestion === 'object') {
        if (suggestion.countryCode) {
            const cc = suggestion.countryCode.toUpperCase();
            if (cc in COUNTRIES) return cc as CountryCode;
        }
        if (suggestion.country) {
            const cStr = suggestion.country.toLowerCase();
            if (cStr.includes('brazil') || cStr.includes('brasil')) return 'BR';
            if (cStr.includes('united states') || cStr.includes('usa') || cStr.includes('u.s.')) return 'US';
            if (cStr.includes('new zealand') || cStr.includes('nova zelândia') || cStr.includes('nova zelandia')) return 'NZ';
            if (cStr.includes('mexico') || cStr.includes('méxico')) return 'MX';
        }
        if (suggestion.label) {
            return detectCountryFromSuggestion(suggestion.label);
        }
    } else if (typeof suggestion === 'string') {
        const str = suggestion.toLowerCase();
        if (str.includes('brazil') || str.includes('brasil')) return 'BR';
        if (str.includes('united states') || str.includes('usa') || str.includes('u.s.a')) return 'US';
        if (str.includes('new zealand') || str.includes('nova zelândia') || str.includes('nova zelandia')) return 'NZ';
        if (str.includes('mexico') || str.includes('méxico')) return 'MX';
    }
    return null;
}

