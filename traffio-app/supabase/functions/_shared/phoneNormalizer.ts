/**
 * Normalizador e Utilitário de Telefones Internacionais (Brasil +55, EUA +1, Nova Zelândia +64)
 */

export interface NormalizedPhone {
    e164: string;          // Ex: "+5541988888888", "+12025550123", "+64211234567"
    digitsOnly: string;    // Ex: "5541988888888", "12025550123", "64211234567"
    countryCode: string;   // Ex: "55", "1", "64"
    nationalNumber: string;// Ex: "41988888888", "2025550123", "211234567"
}

export function normalizePhoneNumber(raw: string | null | undefined, defaultCountryCode = "55"): NormalizedPhone | null {
    if (!raw) return null;

    const cleaned = raw.trim();
    const hasPlus = cleaned.startsWith("+");
    const digits = cleaned.replace(/\D/g, "");

    if (!digits || digits.length < 7) return null;

    let fullDigits = digits;

    if (!hasPlus) {
        if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
            fullDigits = digits;
        } else if (digits.startsWith("1") && digits.length === 11) {
            fullDigits = digits;
        } else if (digits.startsWith("64") && (digits.length >= 10 && digits.length <= 11)) {
            fullDigits = digits;
        } else {
            fullDigits = `${defaultCountryCode}${digits}`;
        }
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
export function getPhoneSearchVariations(rawOrNormalized: string | null | undefined): string[] {
    const normalized = normalizePhoneNumber(rawOrNormalized);
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
