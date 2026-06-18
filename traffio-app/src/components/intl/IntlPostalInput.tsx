import { useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { CountryFieldSelector } from './CountryFieldSelector';
import { type CountryCode } from '../../lib/i18n/countryFormats';
import { formatPostal, postalLabel, postalPlaceholder, validatePostal } from '../../lib/i18n/postal';
import { addressService, type AddressSuggestion } from '../../services/addressService';

interface IntlPostalInputProps {
    value: string;
    onChange: (value: string) => void;
    /** Default country for this field — overridable via the flag selector. */
    country: CountryCode;
    onCountryChange?: (country: CountryCode) => void;
    /** Called with the looked-up address when the postal code resolves (blur-triggered). */
    onLookup?: (suggestion: AddressSuggestion) => void;
    onBlur?: () => void;
    /** Pass an explicit string to override the registry label, or `''` to hide it. */
    label?: string;
    className?: string;
}

/**
 * Country-aware postal/ZIP input: dynamic label/mask/placeholder from the
 * registry, with automatic address lookup on blur (BrasilAPI for BR,
 * Zippopotam.us for everyone else).
 */
export function IntlPostalInput({
    value,
    onChange,
    country,
    onCountryChange,
    onLookup,
    onBlur,
    label,
    className = '',
}: IntlPostalInputProps) {
    const [selectedCountry, setSelectedCountry] = useState<CountryCode>(country);
    const [isLooking, setIsLooking] = useState(false);

    const handleCountrySelect = (c: CountryCode) => {
        setSelectedCountry(c);
        onCountryChange?.(c);
    };

    const handleChange = (text: string) => {
        onChange(formatPostal(text, selectedCountry));
    };

    const handleBlur = async () => {
        onBlur?.();
        if (!validatePostal(value, selectedCountry)) return;
        setIsLooking(true);
        try {
            const result = await addressService.lookupPostal(value, selectedCountry);
            if (result) onLookup?.(result);
        } finally {
            setIsLooking(false);
        }
    };

    return (
        <div className={className}>
            {label !== '' && (
                <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">
                    {label ?? postalLabel(selectedCountry)}
                </label>
            )}
            <div className="flex items-center bg-white border border-ice-200 rounded-xl focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/10 transition-all">
                <CountryFieldSelector value={selectedCountry} onChange={handleCountrySelect} />
                <input
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    onBlur={handleBlur}
                    placeholder={postalPlaceholder(selectedCountry)}
                    className="flex-1 min-w-0 bg-transparent border-none py-2.5 pr-3 text-sm font-medium focus:outline-none"
                />
                {isLooking ? (
                    <Loader2 size={14} className="animate-spin text-brand-primary mr-3 shrink-0" />
                ) : (
                    <MapPin size={14} className="text-graphite-400 mr-3 shrink-0" />
                )}
            </div>
        </div>
    );
}
