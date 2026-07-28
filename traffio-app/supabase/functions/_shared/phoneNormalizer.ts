/**
 * Normalizador e Utilitário de Telefones Internacionais
 * Utiliza google-libphonenumber para suporte global robusto
 */
import pkg from "npm:google-libphonenumber@3.2.38";
const { PhoneNumberUtil, PhoneNumberFormat } = pkg;
const phoneUtil = PhoneNumberUtil.getInstance();

export interface NormalizedPhone {
    e164: string;          // Ex: "+5541988888888", "+12025550123", "+64211234567"
    digitsOnly: string;    // Ex: "5541988888888", "12025550123", "64211234567"
    countryCode: string;   // Ex: "55", "1", "64"
    nationalNumber: string;// Ex: "41988888888", "2025550123", "211234567"
}

// Mapeamento de Código Numérico de País para Região ISO Alpha-2
const COUNTRY_CODE_TO_REGION: Record<string, string> = {
    "55": "BR",
    "1": "US",
    "64": "NZ",
    "52": "MX",
    "34": "ES",
    "351": "PT",
    "44": "GB",
    "61": "AU",
};

/**
 * Normaliza qualquer string de telefone recebida com base no código de país (ex: "55", "1", "64") ou ISO ("BR", "US").
 */
export function normalizePhoneNumber(raw: string | null | undefined, defaultCountryCode = "55"): NormalizedPhone | null {
    if (!raw) return null;

    const cleaned = raw.trim();
    if (!cleaned) return null;

    // Determina a região ISO (ex: "BR", "US") a partir do defaultCountryCode se ele for numérico
    let defaultRegion = "BR";
    if (COUNTRY_CODE_TO_REGION[defaultCountryCode]) {
        defaultRegion = COUNTRY_CODE_TO_REGION[defaultCountryCode];
    } else if (defaultCountryCode.length === 2) {
        defaultRegion = defaultCountryCode.toUpperCase();
    }

    try {
        // Tenta parsear utilizando a libphonenumber
        const parsed = phoneUtil.parseAndKeepRawInput(cleaned, defaultRegion);
        if (phoneUtil.isValidNumber(parsed)) {
            const e164 = phoneUtil.format(parsed, PhoneNumberFormat.E164); // Ex: "+5541988888888"
            const digitsOnly = e164.replace(/\D/g, "");
            const countryCode = String(parsed.getCountryCode() || defaultCountryCode);
            const nationalNumber = String(parsed.getNationalNumber() || "");

            return {
                e164,
                digitsOnly,
                countryCode,
                nationalNumber,
            };
        }
    } catch {
        // Fallback em caso de erro na biblioteca de parsing
    }

    // Fallback defensivo: regex tradicional para não quebrar chamadas legado
    const digits = cleaned.replace(/\D/g, "");
    if (!digits || digits.length < 7) return null;

    const hasPlus = cleaned.startsWith("+");
    let fullDigits = digits;
    if (!hasPlus && !digits.startsWith(defaultCountryCode)) {
        fullDigits = `${defaultCountryCode}${digits}`;
    }

    const e164 = `+${fullDigits}`;
    let countryCode = defaultCountryCode;
    let nationalNumber = fullDigits;

    if (fullDigits.startsWith("55")) {
        countryCode = "55";
        nationalNumber = fullDigits.substring(2);
    } else if (fullDigits.startsWith("1")) {
        countryCode = "1";
        nationalNumber = fullDigits.substring(1);
    } else if (fullDigits.startsWith("64")) {
        countryCode = "64";
        nationalNumber = fullDigits.substring(2);
    }

    return {
        e164,
        digitsOnly: fullDigits,
        countryCode,
        nationalNumber,
    };
}

/**
 * Retorna todas as variações prováveis do número para busca resiliente no banco de dados.
 */
export function getPhoneSearchVariations(rawOrNormalized: string | null | undefined, defaultCountryCode = "55"): string[] {
    const normalized = normalizePhoneNumber(rawOrNormalized, defaultCountryCode);
    if (!normalized) {
        if (!rawOrNormalized) return [];
        const clean = rawOrNormalized.replace(/\D/g, "");
        return clean ? [clean, `+${clean}`] : [];
    }

    const variations = new Set<string>();
    const { e164, digitsOnly, countryCode, nationalNumber } = normalized;

    variations.add(e164);
    variations.add(digitsOnly);

    // Variações específicas do Brasil (9º dígito móvel)
    if (countryCode === "55") {
        if (nationalNumber.length === 11 && nationalNumber[2] === "9") {
            const ddd = nationalNumber.substring(0, 2);
            const numWithout9 = nationalNumber.substring(3);
            const oldDigits = `55${ddd}${numWithout9}`;
            variations.add(oldDigits);
            variations.add(`+${oldDigits}`);
        } else if (nationalNumber.length === 10) {
            const ddd = nationalNumber.substring(0, 2);
            const numWith9 = `${ddd}9${nationalNumber.substring(2)}`;
            const newDigits = `55${numWith9}`;
            variations.add(newDigits);
            variations.add(`+${newDigits}`);
        }
    }

    return Array.from(variations);
}

