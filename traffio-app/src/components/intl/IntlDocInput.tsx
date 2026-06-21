import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CountryFieldSelector } from './CountryFieldSelector';
import { type CountryCode } from '../../lib/i18n/countryFormats';
import { docLabel, docPlaceholder, formatDoc, validateDoc } from '../../lib/i18n/doc';

interface IntlDocInputProps {
    value: string;
    onChange: (value: string) => void;
    /** Default country for this field — overridable via the flag selector. */
    country: CountryCode;
    onCountryChange?: (country: CountryCode) => void;
    onBlur?: () => void;
    /** Pass an explicit string to override the registry label, or `''` to hide it. */
    label?: string;
    className?: string;
}

/**
 * Country-aware national document input (CPF/SSN/IRD/RFC): dynamic
 * label/mask/placeholder/validation from the registry.
 */
export function IntlDocInput({
    value,
    onChange,
    country,
    onCountryChange,
    onBlur,
    label,
    className = '',
}: IntlDocInputProps) {
    const { t } = useTranslation('common');
    const [selectedCountry, setSelectedCountry] = useState<CountryCode>(country);
    const [touched, setTouched] = useState(false);

    const handleCountrySelect = (c: CountryCode) => {
        setSelectedCountry(c);
        onCountryChange?.(c);
    };

    const isValid = !touched || validateDoc(value, selectedCountry);

    return (
        <div className={className}>
            {label !== '' && (
                <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">
                    {label ?? docLabel(selectedCountry)}
                </label>
            )}
            <div
                className={`flex items-center bg-white border rounded-xl transition-all ${
                    isValid
                        ? 'border-ice-200 focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/10'
                        : 'border-red-300 focus-within:ring-2 focus-within:ring-red-100'
                }`}
            >
                <CountryFieldSelector value={selectedCountry} onChange={handleCountrySelect} />
                <input
                    value={value}
                    onChange={(e) => onChange(formatDoc(e.target.value, selectedCountry))}
                    onBlur={() => {
                        setTouched(true);
                        onBlur?.();
                    }}
                    placeholder={docPlaceholder(selectedCountry)}
                    className="flex-1 min-w-0 bg-transparent border-none py-2.5 pr-3 text-sm font-medium focus:outline-none"
                />
            </div>
            {!isValid && <p className="text-[11px] text-red-500 mt-1">{docLabel(selectedCountry)}{t('intlDocInput.invalidSuffix')}</p>}
        </div>
    );
}
