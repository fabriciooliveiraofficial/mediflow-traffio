import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { COUNTRIES, listCountries, type CountryCode } from '../../lib/i18n/countryFormats';

interface CountryFieldSelectorProps {
    value: CountryCode;
    onChange: (country: CountryCode) => void;
    className?: string;
    title?: string;
}

/**
 * Flag dropdown used to override the country of a single field (phone, postal,
 * doc, address) independently of the clinic's default country.
 */
export function CountryFieldSelector({
    value,
    onChange,
    className = '',
    title = 'País deste campo',
}: CountryFieldSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const current = COUNTRIES[value];

    return (
        <div ref={wrapperRef} className={`relative shrink-0 ${className}`}>
            <button
                type="button"
                title={title}
                onClick={() => setIsOpen((v) => !v)}
                className="h-full flex items-center gap-1 pl-3 pr-1.5 border-none bg-transparent cursor-pointer text-graphite-600 hover:text-brand-primary transition-colors"
            >
                <span className="text-base leading-none">{current.flag}</span>
                <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute z-50 left-0 top-full mt-1 w-44 bg-white border border-ice-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                    {listCountries().map((c) => (
                        <button
                            key={c.code}
                            type="button"
                            onClick={() => {
                                onChange(c.code);
                                setIsOpen(false);
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-none cursor-pointer transition-colors ${
                                c.code === value
                                    ? 'bg-brand-primary/5 font-bold text-brand-primary'
                                    : 'bg-transparent hover:bg-ice-50 text-graphite-700'
                            }`}
                        >
                            <span className="text-base leading-none">{c.flag}</span>
                            <span className="truncate">{c.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
