import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SmartAddressInput } from '../components/SmartAddressInput';
import { IntlPostalInput } from './intl/IntlPostalInput';
import { IntlPhoneInput } from './intl/IntlPhoneInput';
import type { AddressSuggestion } from '../services/addressService';
import { MapPin } from 'lucide-react';
import { DEFAULT_COUNTRY, type CountryCode, detectCountryFromSuggestion, getCountry } from '../lib/i18n/countryFormats';
import type { ClinicLocation } from '../services/locationService';

interface TenantAddressFormProps {
    initialData: Partial<ClinicLocation>;
    onSave: (updates: any) => void;
    /** Default country for postal/phone/address fields — each field keeps its own override. */
    country?: CountryCode;
    className?: string;
}

export function TenantAddressForm({ initialData, onSave, country = DEFAULT_COUNTRY, className = '' }: TenantAddressFormProps) {
    const { t } = useTranslation('common');
    const [cep, setCep] = useState(initialData.address_zip_code || '');
    const [address, setAddress] = useState(initialData.address || '');
    const [number, setNumber] = useState(initialData.address_number || '');
    const [complement, setComplement] = useState(initialData.address_complement || '');
    const [phone, setPhone] = useState(initialData.phone || '');
    const [neighborhood, setNeighborhood] = useState(initialData.address_neighborhood || '');

    // Track if we have pending changes to save
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Debounced save to prevent flickering/excessive writes
    const triggerSave = (updates: any) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        timeoutRef.current = setTimeout(() => {
            onSave(updates);
        }, 800);
    };

    const handlePostalChange = (value: string) => {
        setCep(value);
        triggerSave({ address_zip_code: value });
    };

    const handlePostalLookup = (result: AddressSuggestion) => {
        setAddress(result.label);
        setNeighborhood(result.neighborhood || '');
        const detectedCountry = detectCountryFromSuggestion(result);
        const updates: any = {
            address_zip_code: cep,
            address: result.label,
            address_neighborhood: result.neighborhood
        };
        if (detectedCountry) {
            updates.country = detectedCountry;
            updates.locale = getCountry(detectedCountry).locale;
            updates.currency = getCountry(detectedCountry).currency;
        }
        triggerSave(updates);
    };

    const handleAddressSelect = (s: AddressSuggestion) => {
        setAddress(s.label);
        setNeighborhood(s.neighborhood || '');
        if (s.number) setNumber(s.number);
        if (s.postcode) setCep(s.postcode);

        const detectedCountry = detectCountryFromSuggestion(s);
        const updates: any = {
            address: s.label,
            address_neighborhood: s.neighborhood || '',
            address_number: s.number || number,
            address_zip_code: s.postcode || cep,
            latitude: s.latitude,
            longitude: s.longitude
        };
        if (detectedCountry) {
            updates.country = detectedCountry;
            updates.locale = getCountry(detectedCountry).locale;
            updates.currency = getCountry(detectedCountry).currency;
        }
        triggerSave(updates);
    };

    const handleAddressBlur = () => {
        const detectedCountry = detectCountryFromSuggestion(address);
        const updates: any = { address };
        if (detectedCountry) {
            updates.country = detectedCountry;
            updates.locale = getCountry(detectedCountry).locale;
            updates.currency = getCountry(detectedCountry).currency;
        }
        triggerSave(updates);
    };

    const handlePhoneChange = (value: string) => {
        setPhone(value);
        triggerSave({ phone: value });
    };

    return (
        <div className={`space-y-3 ${className}`}>
            <label className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1">
                <MapPin size={12} /> {t('tenantAddressForm.title')}
            </label>

            {/* Line 1: Postal + Address */}
            <div className="flex flex-col md:flex-row gap-3">
                <div className="w-full md:w-44">
                    <IntlPostalInput
                        value={cep}
                        onChange={handlePostalChange}
                        country={country}
                        onLookup={handlePostalLookup}
                        label=""
                    />
                </div>
                <div className="flex-1">
                    <SmartAddressInput
                        value={address}
                        onChange={setAddress}
                        onSelect={handleAddressSelect}
                        onBlur={handleAddressBlur}
                        country={country}
                        placeholder={t('tenantAddressForm.streetPlaceholder')}
                        showCepLookup={false} // We have a dedicated field now
                    />
                </div>
            </div>

            {/* Line 2: Number + Complement + Neighborhood + Phone */}
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
                <div className="col-span-1 md:col-span-2">
                    <input
                        placeholder={t('tenantAddressForm.numberPlaceholder')}
                        value={number}
                        onChange={(e) => setNumber(e.target.value)}
                        onBlur={() => triggerSave({ address_number: number })}
                        className="w-full bg-white border border-ice-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                    />
                </div>
                <div className="col-span-1 md:col-span-3">
                    <input
                        placeholder={t('tenantAddressForm.complementPlaceholder')}
                        value={complement}
                        onChange={(e) => setComplement(e.target.value)}
                        onBlur={() => triggerSave({ address_complement: complement })}
                        className="w-full bg-white border border-ice-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                    />
                </div>
                <div className="col-span-2 md:col-span-3">
                    <input
                        placeholder={t('tenantAddressForm.neighborhoodPlaceholder')}
                        value={neighborhood}
                        onChange={(e) => setNeighborhood(e.target.value)}
                        onBlur={() => triggerSave({ address_neighborhood: neighborhood })}
                        className="w-full bg-white border border-ice-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                    />
                </div>
                <div className="col-span-2 md:col-span-4">
                    <IntlPhoneInput
                        value={phone}
                        onChange={handlePhoneChange}
                        country={country}
                        label=""
                    />
                </div>
            </div>
        </div>
    );
}
