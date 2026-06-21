import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation, Loader2, Search, X } from 'lucide-react';
import { addressService, type AddressSuggestion } from '../services/addressService';
import { DEFAULT_COUNTRY, type CountryCode } from '../lib/i18n/countryFormats';
import { postalLabel } from '../lib/i18n/postal';

interface SmartAddressInputProps {
    value: string;
    onChange: (address: string) => void;
    onSelect?: (suggestion: AddressSuggestion) => void;
    placeholder?: string;
    className?: string;
    showCepLookup?: boolean;
    showMyLocation?: boolean;
    onBlur?: () => void;
    /** Drives postal lookup provider (BrasilAPI/Zippopotam.us) and Photon's country bias. */
    country?: CountryCode;
}

export function SmartAddressInput({
    value,
    onChange,
    onSelect,
    onBlur,
    country = DEFAULT_COUNTRY,
    placeholder,
    className = '',
    showCepLookup = true,
    showMyLocation = true,
}: SmartAddressInputProps) {
    const { t } = useTranslation('common');
    const resolvedPlaceholder = placeholder ?? t('smartAddressInput.placeholder', { postalLabel: postalLabel(country) });
    const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isLocating, setIsLocating] = useState(false);
    const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);

    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Try to get user coords on mount (silent, for bias)
    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => setUserCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
                () => {/* silent fail */ },
                { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
            );
        }
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Debounced autocomplete
    const handleInputChange = useCallback((text: string) => {
        onChange(text);

        if (debounceRef.current) clearTimeout(debounceRef.current);

        const cleanText = text.trim();
        if (cleanText.length < 3) {
            setSuggestions([]);
            setIsOpen(false);
            return;
        }

        // Check if it looks like a postal code (digits/dashes, typical length 4-10)
        const isPostalLike = /^[\d\s-]{4,10}$/.test(cleanText) && /\d/.test(cleanText);

        setIsLoading(true);
        debounceRef.current = setTimeout(async () => {
            try {
                let results: AddressSuggestion[] = [];

                if (isPostalLike && showCepLookup) {
                    const postalResult = await addressService.lookupPostal(cleanText, country);
                    if (postalResult) results = [postalResult];
                }

                // Always also search Photon for richer results
                const photonResults = await addressService.autocomplete(cleanText, {
                    lat: userCoords?.lat,
                    lon: userCoords?.lon,
                    limit: isPostalLike ? 3 : 5,
                    country,
                });

                // Merge: CEP result first (if found), then Photon
                const seen = new Set<string>();
                const merged: AddressSuggestion[] = [];
                for (const r of [...results, ...photonResults]) {
                    const key = `${r.latitude.toFixed(4)}-${r.longitude.toFixed(4)}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        merged.push(r);
                    }
                }

                setSuggestions(merged.slice(0, 6));
                setIsOpen(merged.length > 0);
                setHighlightedIndex(-1);
            } catch {
                setSuggestions([]);
            } finally {
                setIsLoading(false);
            }
        }, 350);
    }, [onChange, userCoords, showCepLookup, country]);

    // Select suggestion
    const handleSelect = (suggestion: AddressSuggestion) => {
        onChange(suggestion.label);
        onSelect?.(suggestion);
        setIsOpen(false);
        setSuggestions([]);
        inputRef.current?.blur();
    };

    // "Use my location" button
    const handleUseMyLocation = async () => {
        setIsLocating(true);
        try {
            const address = await addressService.getCurrentAddress();
            if (address) {
                onChange(address.label);
                onSelect?.(address);
            }
        } catch {
            // silent
        } finally {
            setIsLocating(false);
        }
    };

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen || suggestions.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex((prev) => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
                    handleSelect(suggestions[highlightedIndex]);
                }
                break;
            case 'Escape':
                setIsOpen(false);
                break;
        }
    };

    const sourceLabel = (s: AddressSuggestion) => {
        if (s.source === 'brasilapi') return 'CEP';
        if (s.source === 'zippopotam') return 'ZIP';
        if (s.source === 'geolocation') return 'GPS';
        return 'OSM';
    };

    const sourceColor = (s: AddressSuggestion) => {
        if (s.source === 'brasilapi' || s.source === 'zippopotam') return 'bg-emerald-100 text-emerald-700';
        if (s.source === 'geolocation') return 'bg-sky-100 text-sky-700';
        return 'bg-graphite-100 text-graphite-600';
    };

    return (
        <div ref={wrapperRef} className={`relative ${className}`}>
            {/* Input wrapper */}
            <div className="relative flex items-center">
                <Search size={14} className="absolute left-3 text-graphite-400 pointer-events-none" />
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onFocus={() => suggestions.length > 0 && setIsOpen(true)}
                    onBlur={onBlur}
                    onKeyDown={handleKeyDown}
                    placeholder={resolvedPlaceholder}
                    autoComplete="off"
                    className="w-full bg-white border border-ice-200 rounded-xl pl-9 pr-20 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                />

                {/* Right-side action buttons */}
                <div className="absolute right-2 flex items-center gap-1">
                    {isLoading && (
                        <Loader2 size={14} className="animate-spin text-brand-primary" />
                    )}

                    {value && (
                        <button
                            type="button"
                            onClick={() => { onChange(''); setSuggestions([]); setIsOpen(false); }}
                            className="p-1 text-graphite-400 hover:text-graphite-600 transition-colors border-none bg-transparent cursor-pointer"
                            title={t('smartAddressInput.clear')}
                        >
                            <X size={14} />
                        </button>
                    )}

                    {showMyLocation && (
                        <button
                            type="button"
                            onClick={handleUseMyLocation}
                            disabled={isLocating}
                            className="p-1.5 text-brand-primary hover:bg-brand-primary/10 rounded-lg transition-colors border-none bg-transparent cursor-pointer disabled:opacity-50"
                            title={t('smartAddressInput.useMyLocation')}
                        >
                            {isLocating
                                ? <Loader2 size={14} className="animate-spin" />
                                : <Navigation size={14} />
                            }
                        </button>
                    )}
                </div>
            </div>

            {/* Dropdown suggestions */}
            {isOpen && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-ice-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                    {suggestions.map((s, i) => (
                        <button
                            key={`${s.latitude}-${s.longitude}-${i}`}
                            type="button"
                            onClick={() => handleSelect(s)}
                            onMouseEnter={() => setHighlightedIndex(i)}
                            className={`
                                w-full flex items-start gap-3 px-3 py-2.5 text-left border-none cursor-pointer transition-colors
                                ${i === highlightedIndex ? 'bg-brand-primary/5' : 'bg-transparent hover:bg-ice-50'}
                                ${i < suggestions.length - 1 ? 'border-b border-ice-100' : ''}
                            `}
                        >
                            <MapPin size={14} className="mt-0.5 text-graphite-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-graphite-900 truncate">
                                    {s.street || s.label.split('—')[0]?.trim() || s.label}
                                </p>
                                <p className="text-xs text-graphite-400 truncate">
                                    {[s.neighborhood, s.city, s.state].filter(Boolean).join(', ')}
                                </p>
                            </div>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${sourceColor(s)}`}>
                                {sourceLabel(s)}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
