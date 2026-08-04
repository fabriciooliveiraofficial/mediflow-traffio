import React, { useState } from 'react';
import { X, Search, User, FileText, Link, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { motion, AnimatePresence } from 'framer-motion';
import { formatPhone } from '../lib/formatPhone';

interface PatientLookupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (patient: any) => void;
}

export const PatientLookupModal: React.FC<PatientLookupModalProps> = ({ isOpen, onClose, onSelect }) => {
    const { t } = useTranslation('common');
    const { tenant } = useTenant();
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<any[]>([]);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!search.trim() || !tenant?.id) return;

        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('patients')
                .select('*')
                .eq('tenant_id', tenant.id)
                .or(`full_name.ilike.%${search}%,cpf.ilike.%${search}%,phone.ilike.%${search}%`)
                .limit(10);

            if (error) throw error;
            setResults(data || []);
        } catch (error) {
            console.error('Error searching patients:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]"
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none"
                    >
                        <div className="bg-white pointer-events-auto w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden border border-ice-100 flex flex-col max-h-[80vh]">
                            {/* Header */}
                            <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50">
                                <div>
                                    <h3 className="text-xl font-black text-graphite-900 tracking-tight">{t('patientLookup.title')}</h3>
                                    <p className="text-sm text-graphite-400 font-medium">{t('patientLookup.subtitle')}</p>
                                </div>
                                <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 hover:text-brand-primary transition-all cursor-pointer">
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Search Form */}
                            <div className="p-6 border-b border-ice-100 bg-white">
                                <form onSubmit={handleSearch} className="relative group">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400 group-focus-within:text-brand-primary transition-colors" size={18} />
                                    <input
                                        autoFocus
                                        type="text"
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        placeholder={t('patientLookup.searchPlaceholder')}
                                        className="w-full bg-ice-50 border border-ice-200 rounded-2xl py-3.5 pl-12 pr-4 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all"
                                    />
                                    {loading && (
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                            <div className="w-4 h-4 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
                                        </div>
                                    )}
                                </form>
                            </div>

                            {/* Results */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
                                {results.length === 0 && !loading && search && (
                                    <div className="text-center py-10">
                                        <div className="w-12 h-12 bg-ice-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                            <Search className="text-graphite-300" size={24} />
                                        </div>
                                        <p className="text-sm font-bold text-graphite-400">{t('patientLookup.noResults')}</p>
                                    </div>
                                )}

                                {results.map(patient => (
                                    <button
                                        key={patient.id}
                                        onClick={() => onSelect(patient)}
                                        className="w-full bg-white hover:bg-brand-primary/5 border border-ice-100 hover:border-brand-primary/20 p-4 rounded-2xl flex items-center justify-between group transition-all cursor-pointer"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center group-hover:bg-brand-primary group-hover:text-white transition-colors">
                                                <User size={18} />
                                            </div>
                                            <div className="text-left">
                                                <p className="text-sm font-black text-graphite-900">{patient.full_name}</p>
                                                <div className="flex items-center gap-3 mt-1">
                                                    <span className="text-[11px] text-graphite-400 flex items-center gap-1">
                                                        <FileText size={10} /> {patient.cpf || t('patientLookup.noCpf')}
                                                    </span>
                                                    <span className="text-[11px] text-graphite-400 flex items-center gap-1">
                                                        <Phone size={10} /> {formatPhone(patient.phone, tenant?.country as CountryCode) || t('patientLookup.noPhone')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                            <div className="btn-vincular bg-brand-primary text-white text-[10px] font-black px-3 py-1.5 rounded-lg flex items-center gap-1.5 uppercase tracking-widest">
                                                <Link size={12} /> {t('patientLookup.link')}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
