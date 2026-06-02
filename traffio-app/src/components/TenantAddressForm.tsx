import { useState, useRef } from 'react';
import { SmartAddressInput } from '../components/SmartAddressInput';
import { addressService, type AddressSuggestion } from '../services/addressService';
import { MapPin, Phone } from 'lucide-react';
import type { Location } from '../services/locationService';

interface TenantAddressFormProps {
    initialData: Partial<Location> & { address_zip_code?: string };
    onSave: (updates: any) => void;
    className?: string;
}

export function TenantAddressForm({ initialData, onSave, className = '' }: TenantAddressFormProps) {
    const [cep, setCep] = useState(initialData.address_zip_code || '');
    const [address, setAddress] = useState(initialData.address || '');
    const [number, setNumber] = useState(initialData.address_number || '');
    const [complement, setComplement] = useState(initialData.address_complement || '');
    const [phone, setPhone] = useState(initialData.phone || '');
    const [neighborhood, setNeighborhood] = useState(initialData.address_neighborhood || '');

    // Track if we have pending changes to save
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Debounced save to prevent flickering/excessive writes
    const triggerSave = (updates: any) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        timeoutRef.current = setTimeout(() => {
            onSave(updates);
        }, 800);
    };

    const handleCepBlur = async () => {
        // Only lookup if it looks like a CEP and we don't have an address yet (or user wants to refresh)
        const cleanCep = cep.replace(/\D/g, '');
        if (cleanCep.length === 8) {
            triggerSave({ address_zip_code: cep });

            // Auto-fill address from CEP
            const result = await addressService.lookupCep(cleanCep);
            if (result) {
                setAddress(result.label);
                setNeighborhood(result.neighborhood || '');
                triggerSave({
                    address_zip_code: cep,
                    address: result.label,
                    address_neighborhood: result.neighborhood,
                    latitude: result.latitude,
                    longitude: result.longitude
                });
            }
        } else {
            triggerSave({ address_zip_code: cep });
        }
    };

    const handleAddressSelect = (s: AddressSuggestion) => {
        setAddress(s.label);
        setNeighborhood(s.neighborhood || '');
        if (s.number) setNumber(s.number);
        if (s.postcode) setCep(s.postcode);

        triggerSave({
            address: s.label,
            address_neighborhood: s.neighborhood || '',
            address_number: s.number || number,
            address_zip_code: s.postcode || cep,
            latitude: s.latitude,
            longitude: s.longitude
        });
    };

    return (
        <div className={`space-y-3 ${className}`}>
            <label className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1">
                <MapPin size={12} /> Endereço e Contato
            </label>

            {/* Line 1: CEP + Address */}
            <div className="flex flex-col md:flex-row gap-3">
                <div className="w-full md:w-32">
                    <input
                        placeholder="CEP"
                        value={cep}
                        onChange={(e) => setCep(e.target.value)}
                        onBlur={handleCepBlur}
                        className="w-full bg-white border border-ice-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                    />
                </div>
                <div className="flex-1">
                    <SmartAddressInput
                        value={address}
                        onChange={setAddress}
                        onSelect={handleAddressSelect}
                        onBlur={() => triggerSave({ address })}
                        placeholder="Endereço (Rua, Av...)"
                        showCepLookup={false} // We have a dedicated field now
                    />
                </div>
            </div>

            {/* Line 2: Number + Complement + Neighborhood + Phone */}
            <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
                <div className="col-span-1 md:col-span-2">
                    <input
                        placeholder="Nº"
                        value={number}
                        onChange={(e) => setNumber(e.target.value)}
                        onBlur={() => triggerSave({ address_number: number })}
                        className="w-full bg-white border border-ice-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                    />
                </div>
                <div className="col-span-1 md:col-span-3">
                    <input
                        placeholder="Complemento"
                        value={complement}
                        onChange={(e) => setComplement(e.target.value)}
                        onBlur={() => triggerSave({ address_complement: complement })}
                        className="w-full bg-white border border-ice-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                    />
                </div>
                <div className="col-span-2 md:col-span-3">
                    <input
                        placeholder="Bairro"
                        value={neighborhood}
                        onChange={(e) => setNeighborhood(e.target.value)}
                        onBlur={() => triggerSave({ address_neighborhood: neighborhood })}
                        className="w-full bg-white border border-ice-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                    />
                </div>
                <div className="col-span-2 md:col-span-4">
                    <div className="relative">
                        <Phone size={14} className="absolute left-3 top-3 text-graphite-400 pointer-events-none" />
                        <input
                            placeholder="Telefone"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            onBlur={() => triggerSave({ phone })}
                            className="w-full bg-white border border-ice-200 rounded-xl pl-9 pr-4 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
