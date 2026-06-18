/**
 * maskUtils.ts — Generic digit-mask applier shared by postal/doc formatters.
 * Mask syntax: '#' is a digit placeholder, any other character is literal.
 * Example: applyMask('80010000', '#####-###') -> '80010-000'
 */
export function applyMask(rawValue: string, mask: string): string {
    const digits = rawValue.replace(/\D/g, '');
    let result = '';
    let digitIndex = 0;

    for (const char of mask) {
        if (digitIndex >= digits.length) break;
        if (char === '#') {
            result += digits[digitIndex];
            digitIndex++;
        } else {
            result += char;
        }
    }
    return result;
}

/** Counts how many '#' placeholders a mask expects (i.e. the digit length). */
export function maskDigitLength(mask: string): number {
    return (mask.match(/#/g) || []).length;
}
