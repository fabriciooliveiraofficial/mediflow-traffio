import React, { useEffect, useState } from 'react';
import { formatPhone, phoneFlag } from '../lib/formatPhone';
import { formatDoc, docLabel } from '../lib/i18n/doc';
import { DEFAULT_COUNTRY, type CountryCode } from '../lib/i18n/countryFormats';
import {
    Search,
    Filter,
    Plus,
    Phone,
    Mail,
    Calendar,
    ChevronRight,
    Edit2,
    Trash2
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { NewPatientModal } from '../components/NewPatientModal';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from 'react-i18next';

interface CrmLeadsProps {
    onSelectPatient?: (id: string) => void;
}

export const CrmLeads: React.FC<CrmLeadsProps> = ({ onSelectPatient }) => {
    const { t } = useTranslation('crm');
    const { showToast } = useToast();
    const [patients, setPatients] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPatient, setEditingPatient] = useState<any | null>(null);

    useEffect(() => {
        fetchPatients();
    }, []);

    const formatDate = (dateString: string | null) => {
        if (!dateString) return t('leads.noVisits');
        try {
            const date = new Date(dateString);
            return new Intl.DateTimeFormat('pt-BR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            }).format(date).replace('.', '').replace('de ', '');
        } catch (e) {
            return '---';
        }
    };

    const fetchPatients = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('patients')
                .select(`
                    *,
                    appointments (
                        start_time
                    )
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            
            // Post-process to get only the latest appointment per patient
            const patientsWithLastVisit = (data || []).map(p => {
                const pastAppointments = (p.appointments || [])
                    .filter((a: any) => new Date(a.start_time) <= new Date())
                    .sort((a: any, b: any) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
                
                return {
                    ...p,
                    last_visit: pastAppointments[0]?.start_time || null
                };
            });

            setPatients(patientsWithLastVisit);
        } catch (error) {
            console.error('Error fetching patients:', error);
        } finally {
            setLoading(false);
        }
    };
    
    const handleDelete = async (id: string) => {
        if (!confirm(t('leads.confirmDelete'))) return;
        
        try {
            const { error } = await supabase
                .from('patients')
                .delete()
                .eq('id', id);
            
            if (error) throw error;
            fetchPatients();
            showToast('success', t('leads.toasts.deleted'));
        } catch (error) {
            console.error('Error deleting patient:', error);
            showToast('error', t('leads.toasts.deleteError'));
        }
    };

    const filteredPatients = patients.filter(p =>
        p.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.cpf?.includes(searchTerm) ||
        p.phone?.includes(searchTerm) ||
        p.mobile?.includes(searchTerm) // Backward compatibility
    );

    return (
        <div className="space-y-8 pb-24 md:pb-12">
            {/* Header / Stats */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-black text-graphite-900 tracking-tighter">{t('leads.title')}</h2>
                    <p className="text-graphite-400 font-medium">{t('leads.subtitle')}</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="flex items-center gap-2 bg-brand-primary text-white px-5 py-3 rounded-2xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-105 transition-transform cursor-pointer border-none"
                >
                    <Plus size={20} />
                    <span>{t('leads.newPatient')}</span>
                </button>
            </div>

            {/* Filters & Search */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 bg-white border-none rounded-2xl flex items-center px-4 py-3 shadow-float transition-colors">
                    <Search size={20} className="text-graphite-400 mr-3" />
                    <input
                        type="text"
                        placeholder={t('leads.searchPlaceholder')}
                        className="bg-transparent border-none outline-none w-full text-graphite-900 placeholder:text-graphite-300 font-medium"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button className="flex items-center gap-2 bg-white border border-ice-200 text-graphite-700 px-5 py-3 rounded-2xl font-bold hover:bg-ice-50 transition-colors cursor-pointer">
                    <Filter size={20} className="text-graphite-400" />
                    <span>{t('leads.filters')}</span>
                </button>
            </div>

            {/* Patients List */}
            <div className="bg-white rounded-3xl border-none shadow-float overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-ice-100 bg-ice-50/50">
                                <th className="px-6 py-4 text-xs font-black text-graphite-400 uppercase tracking-widest bg-transparent">{t('leads.table.patient')}</th>
                                <th className="px-6 py-4 text-xs font-black text-graphite-400 uppercase tracking-widest bg-transparent hidden md:table-cell">{t('leads.table.contact')}</th>
                                <th className="px-6 py-4 text-xs font-black text-graphite-400 uppercase tracking-widest bg-transparent hidden lg:table-cell">{t('leads.table.lastVisit')}</th>
                                <th className="px-6 py-4 text-xs font-black text-graphite-400 uppercase tracking-widest bg-transparent">{t('leads.table.status')}</th>
                                <th className="px-6 py-4 text-xs font-black text-graphite-400 uppercase tracking-widest bg-transparent text-right">{t('leads.table.actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ice-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-graphite-400 font-medium">
                                        {t('leads.loading')}
                                    </td>
                                </tr>
                            ) : filteredPatients.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-graphite-400 font-medium bg-transparent">
                                        {t('leads.empty')}
                                    </td>
                                </tr>
                            ) : (
                                filteredPatients.map((patient) => (
                                    <tr key={patient.id} className="group hover:bg-ice-50/50 transition-colors bg-white">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center font-black text-sm">
                                                    {patient.full_name.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-graphite-900">{patient.full_name}</p>
                                                    <p className="text-xs text-graphite-400 font-medium">
                                                        {docLabel((patient.country as CountryCode) || (patient.cpf ? 'BR' : DEFAULT_COUNTRY))}: {
                                                            patient.national_id || patient.cpf
                                                                ? formatDoc(patient.national_id || patient.cpf, (patient.country as CountryCode) || (patient.cpf ? 'BR' : DEFAULT_COUNTRY))
                                                                : '---'
                                                        }
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 hidden md:table-cell">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2 text-xs font-medium text-graphite-700">
                                                    <Phone size={12} className="text-graphite-400" />
                                                    {phoneFlag(patient.phone || patient.mobile)} {formatPhone(patient.phone || patient.mobile)}
                                                </div>
                                                <div className="flex items-center gap-2 text-xs font-medium text-graphite-700">
                                                    <Mail size={12} className="text-graphite-400" />
                                                    {patient.email || '---'}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 hidden lg:table-cell">
                                            <div className="flex items-center gap-2 text-sm text-graphite-700 font-medium">
                                                <Calendar size={14} className="text-graphite-400" />
                                                <span>{formatDate(patient.last_visit)}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wide bg-emerald-100 text-emerald-700">
                                                {t('leads.activeBadge')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => {
                                                        setEditingPatient(patient);
                                                        setIsModalOpen(true);
                                                    }}
                                                    className="p-2 hover:bg-ice-100 rounded-lg text-graphite-400 hover:text-brand-primary transition-all border-none bg-transparent cursor-pointer"
                                                    title={t('leads.editTitle')}
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(patient.id)}
                                                    className="p-2 hover:bg-rose-50 rounded-lg text-graphite-400 hover:text-rose-500 transition-all border-none bg-transparent cursor-pointer"
                                                    title={t('leads.deleteTitle')}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                                <button
                                                    onClick={() => onSelectPatient?.(patient.id)}
                                                    className="p-2 hover:bg-ice-100 rounded-lg text-graphite-400 hover:text-brand-primary transition-all border-none bg-transparent cursor-pointer shadow-none hover:shadow-sm ml-2"
                                                    title={t('leads.detailsTitle')}
                                                >
                                                    <ChevronRight size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <NewPatientModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setEditingPatient(null);
                }}
                onSuccess={fetchPatients}
                patientId={editingPatient?.id}
                initialData={editingPatient}
            />
        </div>
    );
};
