import { useEffect, useState } from 'react';
import { CountryFieldSelector } from './CountryFieldSelector';
import { getCountry, type CountryCode } from '../../lib/i18n/countryFormats';
import { formatAsYouType, formatNational, isValidPhone, phoneCountry, toE164 } from '../../lib/i18n/phone';

interface IntlPhoneInputProps {
    /** Stored value — E.164 (`+5541997759569`) when valid, or a legacy raw/national value. */
    value: string;
    /** Emits E.164 when the number is valid; otherwise emits the raw typed text. */
    onChange: (value: string) => void;
    /** Default country for this field (e.g. the clinic's country) — overridable via the flag selector. */
    country: CountryCode;
    onCountryChange?: (country: CountryCode) => void;
    onBlur?: () => void;
    label?: string;
    placeholder?: string;
    className?: string;
}

/** Resolves a possibly-legacy stored value (raw digits, no `+`) to E.164 using `fallbackCountry`. */
function resolveInitialE164(value: string, fallbackCountry: CountryCode): string {
    if (!value) return '';
    if (value.startsWith('+')) return value;
    return toE164(value, fallbackCountry) || value;
}

/**
 * Country-aware phone input: flag + dial code + national-format mask.
 * Always emits E.164 for storage; the country can be overridden per field
 * independently of the clinic's default (e.g. a US clinic with a +55 contact).
 */
export function IntlPhoneInput({
    value,
    onChange,
    country,
    onCountryChange,
    onBlur,
    label,
    placeholder,
    className = '',
}: IntlPhoneInputProps) {
    const [selectedCountry, setSelectedCountry] = useState<CountryCode>(
        () => phoneCountry(resolveInitialE164(value, country)) || country
    );
    const [rawInput, setRawInput] = useState(() => {
        const e164 = resolveInitialE164(value, country);
        return e164.startsWith('+') ? formatNational(e164) || e164 : e164;
    });

    useEffect(() => {
        const e164 = resolveInitialE164(value, country);
        setSelectedCountry(phoneCountry(e164) || country);
        setRawInput(e164.startsWith('+') ? formatNational(e164) || e164 : e164);
        // Only re-sync when the external value changes (e.g. switching records) —
        // `country` is just the initial default and must not override a manual field override.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleCountrySelect = (c: CountryCode) => {
        setSelectedCountry(c);
        onCountryChange?.(c);
        const e164 = toE164(rawInput, c);
        onChange(e164 || rawInput);
    };

    const handleInputChange = (text: string) => {
        const formatted = formatAsYouType(text, selectedCountry);
        setRawInput(formatted);
        const e164 = toE164(formatted, selectedCountry);
        onChange(e164 || formatted);
    };

    const isValid = rawInput.length === 0 || isValidPhone(rawInput, selectedCountry);
    const countryDef = getCountry(selectedCountry);

    return (
        <div className={className}>
            {label && <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{label}</label>}
            <div
                className={`flex items-center bg-white border rounded-xl transition-all ${
                    isValid
                        ? 'border-ice-200 focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/10'
                        : 'border-red-300 focus-within:ring-2 focus-within:ring-red-100'
                }`}
            >
                <CountryFieldSelector value={selectedCountry} onChange={handleCountrySelect} />
                <span className="text-sm font-bold text-graphite-400 pl-1.5 pr-2 border-r border-ice-200 mr-2">
                    {countryDef.dialCode}
                </span>
                <input
                    type="tel"
                    value={rawInput}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onBlur={onBlur}
                    placeholder={placeholder || countryDef.phone.placeholder}
                    className="flex-1 min-w-0 bg-transparent border-none py-2.5 pr-3 text-sm font-medium focus:outline-none"
                />
            </div>
            {!isValid && <p className="text-[11px] text-red-500 mt-1">Número inválido para {countryDef.name}</p>}
        </div>
    );
}
