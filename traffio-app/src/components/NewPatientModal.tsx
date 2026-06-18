import React, { useState, useEffect } from 'react';
import { X, User, Mail, Save, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { useTenant } from '../contexts/TenantContext';
import { IntlPhoneInput } from './intl/IntlPhoneInput';
import { IntlDocInput } from './intl/IntlDocInput';
import { DEFAULT_COUNTRY, type CountryCode } from '../lib/i18n/countryFormats';
import { docType } from '../lib/i18n/doc';

interface NewPatientModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    patientId?: string;
    initialData?: any;
}

export const NewPatientModal: React.FC<NewPatientModalProps> = ({ isOpen, onClose, onSuccess, patientId, initialData }) => {
    const { tenant } = useTenant();
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        full_name: '',
        national_id: '',
        country: (tenant?.country || DEFAULT_COUNTRY) as CountryCode,
        birth_date: '',
        phone: '',
        email: '',
        type: 'particular', // 'particular' | 'insurance'
        insurance_provider: '',
        insurance_card: ''
    });

    const applyDateMask = (value: string) => {
        const digits = value.replace(/\D/g, '');
        if (digits.length <= 2) return digits;
        if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
        return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
    };

    const toDBDate = (displayDate: string) => {
        if (!displayDate) return null;
        const [day, month, year] = displayDate.split('/');
        if (!day || !month || !year || year.length < 4) return null;
        return `${year}-${month}-${day}`;
    };

    const toDisplayDate = (dbDate: string) => {
        if (!dbDate) return '';
        // Handle ISO string or YYYY-MM-DD
        const datePart = dbDate.split('T')[0];
        const [year, month, day] = datePart.split('-');
        if (!year || !month || !day) return '';
        return `${day}/${month}/${year}`;
    };

    useEffect(() => {
        if (isOpen && initialData) {
            setFormData({
                full_name: initialData.full_name || '',
                national_id: initialData.national_id || initialData.cpf || '',
                // Legacy patients have no `country` but already have a `cpf` -> BR.
                country: (initialData.country as CountryCode) || (initialData.cpf ? 'BR' : (tenant?.country || DEFAULT_COUNTRY)),
                birth_date: initialData.birth_date ? toDisplayDate(initialData.birth_date) : '',
                phone: initialData.phone || initialData.mobile || '',
                email: initialData.email || '',
                type: initialData.type || 'particular',
                insurance_provider: initialData.insurance_provider || '',
                insurance_card: initialData.insurance_card || ''
            });
        } else if (isOpen && !patientId) {
            setFormData({
                full_name: '',
                national_id: '',
                country: tenant?.country || DEFAULT_COUNTRY,
                birth_date: '',
                phone: '',
                email: '',
                type: 'particular',
                insurance_provider: '',
                insurance_card: ''
            });
        }
    }, [isOpen, initialData, patientId, tenant?.country]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            // Build payload dynamically to avoid errors with missing columns
            const payload: any = {
                full_name: formData.full_name,
                // `cpf` kept for BR retrocompat; `national_id`/`national_id_type`/`country` are the generic fields.
                cpf: formData.country === 'BR' ? formData.national_id : null,
                national_id: formData.national_id || null,
                national_id_type: formData.national_id ? docType(formData.country) : null,
                country: formData.country,
                birth_date: toDBDate(formData.birth_date),
                phone: formData.phone,
                email: formData.email
            };

            // Only include type if it's NOT the default 'particular' to avoid schema errors
            if (formData.type && formData.type !== 'particular') {
                payload.type = formData.type;
            }

            // Only include insurance fields if they are not empty
            if (formData.type === 'insurance') {
                if (formData.insurance_provider) payload.insurance_provider = formData.insurance_provider;
                if (formData.insurance_card) payload.insurance_card = formData.insurance_card;
            }

            if (patientId) {
                const { error } = await supabase
                    .from('patients')
                    .update(payload)
                    .eq('id', patientId);
                if (error) throw error;
                showToast('success', 'Paciente atualizado com sucesso!');
            } else {
                if (!tenant?.id) throw new Error('Tenant não identificado.');
                const { error } = await supabase
                    .from('patients')
                    .insert([{
                        ...payload,
                        tenant_id: tenant.id
                    }]);
                if (error) throw error;
                showToast('success', 'Paciente cadastrado com sucesso!');
            }

            onSuccess();
            onClose();

        } catch (error: any) {
            console.error('Error adding patient:', error);
            showToast('error', 'Erro ao cadastrar: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]"
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none"
                    >
                        <div className="bg-white pointer-events-auto w-full max-w-lg rounded-[32px] shadow-2xl shadow-brand-primary/20 overflow-hidden border border-white/20">
                            {/* Header */}
                            <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50">
                                <div>
                                    <h3 className="text-xl font-black text-graphite-900 tracking-tight">
                                        {patientId ? 'Editar Paciente' : 'Novo Paciente'}
                                    </h3>
                                    <p className="text-sm text-graphite-400 font-medium">
                                        {patientId ? 'Atualize as informações do paciente.' : 'Preencha os dados do cartão de visitas.'}
                                    </p>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="w-10 h-10 rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 hover:text-brand-primary hover:border-brand-primary/30 transition-all cursor-pointer"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Form */}
                            <form onSubmit={handleSubmit} className="p-8 space-y-6">
                                <div className="space-y-4">
                                    <div className="group">
                                        <label className="block text-xs font-black text-graphite-700 uppercase tracking-widest mb-2 ml-1">Nome Completo</label>
                                        <div className="relative">
                                            <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400 group-focus-within:text-brand-primary transition-colors" />
                                            <input
                                                required
                                                type="text"
                                                value={formData.full_name}
                                                onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                                                className="w-full bg-ice-50 border border-ice-200 rounded-2xl py-3.5 pl-12 pr-4 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all placeholder:text-graphite-300"
                                                placeholder="Ex: Ricardo Albeniz"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <IntlDocInput
                                            value={formData.national_id}
                                            onChange={v => setFormData({ ...formData, national_id: v })}
                                            country={formData.country}
                                            onCountryChange={c => setFormData({ ...formData, country: c })}
                                        />
                                        <IntlPhoneInput
                                            value={formData.phone}
                                            onChange={v => setFormData({ ...formData, phone: v })}
                                            country={formData.country}
                                            label="Celular"
                                        />
                                    </div>

                                    <div className="group">
                                        <label className="block text-xs font-black text-graphite-700 uppercase tracking-widest mb-2 ml-1">Data de Nascimento</label>
                                        <div className="relative">
                                            <Calendar size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400 group-focus-within:text-brand-primary transition-colors" />
                                            <input
                                                type="text"
                                                maxLength={10}
                                                value={formData.birth_date}
                                                onChange={e => setFormData({ ...formData, birth_date: applyDateMask(e.target.value) })}
                                                className="w-full bg-ice-50 border border-ice-200 rounded-2xl py-3.5 pl-12 pr-4 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all placeholder:text-graphite-300"
                                                placeholder="DD/MM/AAAA"
                                            />
                                        </div>
                                    </div>

                                    <div className="group">
                                        <label className="block text-xs font-black text-graphite-700 uppercase tracking-widest mb-2 ml-1">Email</label>
                                        <div className="relative">
                                            <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400 group-focus-within:text-brand-primary transition-colors" />
                                            <input
                                                type="email"
                                                value={formData.email}
                                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                                className="w-full bg-ice-50 border border-ice-200 rounded-2xl py-3.5 pl-12 pr-4 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all placeholder:text-graphite-300"
                                                placeholder="paciente@exemplo.com"
                                            />
                                        </div>
                                    </div>

                                    {/* Healthcare Info */}
                                    <div className="pt-4 border-t border-ice-100 mt-4 space-y-4">
                                        <label className="block text-xs font-black text-graphite-700 uppercase tracking-widest mb-2 ml-1">Tipo de Atendimento</label>
                                        <div className="flex bg-ice-50 p-1 rounded-2xl border border-ice-100">
                                            <button
                                                type="button"
                                                onClick={() => setFormData({ ...formData, type: 'particular' })}
                                                className={clsx(
                                                    "flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border-none cursor-pointer",
                                                    formData.type === 'particular'
                                                        ? "bg-white text-brand-primary shadow-sm"
                                                        : "text-graphite-400 hover:text-graphite-600"
                                                )}
                                            >
                                                Particular
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setFormData({ ...formData, type: 'insurance' })}
                                                className={clsx(
                                                    "flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border-none cursor-pointer",
                                                    formData.type === 'insurance'
                                                        ? "bg-white text-emerald-600 shadow-sm"
                                                        : "text-graphite-400 hover:text-graphite-600"
                                                )}
                                            >
                                                Convênio
                                            </button>
                                        </div>

                                        {formData.type === 'insurance' && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                className="grid grid-cols-2 gap-4 overflow-hidden"
                                            >
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wider ml-1">Operadora</label>
                                                    <input
                                                        type="text"
                                                        placeholder="Ex: Unimed"
                                                        value={formData.insurance_provider}
                                                        onChange={e => setFormData({ ...formData, insurance_provider: e.target.value })}
                                                        className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-2.5 text-xs font-bold text-graphite-900 focus:outline-none focus:border-emerald-500/50 transition-all"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wider ml-1">Nº Carteirinha</label>
                                                    <input
                                                        type="text"
                                                        placeholder="0000..."
                                                        value={formData.insurance_card}
                                                        onChange={e => setFormData({ ...formData, insurance_card: e.target.value })}
                                                        className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-2.5 text-xs font-bold text-graphite-900 focus:outline-none focus:border-emerald-500/50 transition-all"
                                                    />
                                                </div>
                                            </motion.div>
                                        )}
                                    </div>
                                </div>

                                <div className="pt-4 flex gap-3">
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        className="flex-1 py-4 rounded-2xl font-bold text-graphite-700 hover:bg-ice-50 border border-transparent hover:border-ice-200 transition-all cursor-pointer"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="flex-[2] bg-brand-primary text-white py-4 rounded-2xl font-bold shadow-xl shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed border-none cursor-pointer"
                                    >
                                        {loading ? (
                                            'Salvando...'
                                        ) : (
                                            <>
                                                <Save size={20} />
                                                <span>{patientId ? 'Salvar Alterações' : 'Cadastrar Paciente'}</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
