import React, { useState, useEffect } from 'react';
import { 
    Search, 
    User, 
    Clock, 
    FileText, 
    Plus, 
    Stethoscope, 
    Pill, 
    History, 
    ChevronRight,
    Calendar,
    Clipboard,
    Printer,
    Download,
    UserCircle,
    ArrowLeft,
    Upload,
    File,
    Trash2,
    ExternalLink,
    Mail,
    Phone,
    MapPin,
    CreditCard,
    BookOpen,
    Shield,
    Eye,
    Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { clsx } from 'clsx';
import { formatDisplayDate } from '../lib/dateUtils';
import { formatDoc, docLabel } from '../lib/i18n/doc';
import { formatNational } from '../lib/i18n/phone';
import { DEFAULT_COUNTRY, type CountryCode } from '../lib/i18n/countryFormats';
import { formatInTimezone } from '../lib/timezoneUtils';

interface Patient {
    id: string;
    full_name: string;
    cpf: string;
    national_id?: string | null;
    national_id_type?: string | null;
    country?: string | null;
    phone: string;
    email?: string;
    birth_date?: string;
    gender?: string;
    address_json?: any;
    insurance_provider?: string;
    insurance_card_number?: string;
    type?: 'particular' | 'insurance' | string;
    insurance_card?: string;
    notes?: string;
}

interface MedicalRecord {
    id: string;
    event_type: 'consulta' | 'exame' | 'procedimento' | 'nota';
    title: string;
    description: string;
    created_at: string;
    dynamic_data: any;
}

interface PatientDocument {
    id: string;
    name: string;
    file_path: string;
    file_type: string;
    file_size: number;
    created_at: string;
}

export interface Prescription {
    id: string;
    patient_id: string;
    tenant_id: string;
    content_json: any;
    pdf_url?: string;
    created_at: string;
}

export const MedicalRecordsHub = () => {
    const { t, i18n } = useTranslation('medical');
    const { tenant } = useTenant();
    const { showToast } = useToast();
    
    const [patients, setPatients] = useState<Patient[]>([]);
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [records, setRecords] = useState<MedicalRecord[]>([]);
    const [documents, setDocuments] = useState<PatientDocument[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [view, setView] = useState<'timeline' | 'details' | 'prescriptions' | 'files' | 'form' | 'prescription'>('timeline');
    
    // Prescription History States
    const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
    const [selectedPrescriptionForView, setSelectedPrescriptionForView] = useState<Prescription | null>(null);
    const [loadingPrescriptions, setLoadingPrescriptions] = useState(false);
    
    // Form States
    const [newNote, setNewNote] = useState({ title: '', description: '', type: 'consulta' });
    const [prescriptionContent, setPrescriptionContent] = useState('');
    const [previewDoc, setPreviewDoc] = useState<PatientDocument | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);

    useEffect(() => {
        if (tenant?.id) fetchPatients();
    }, [tenant?.id]);

    useEffect(() => {
        if (selectedPatient) {
            fetchPatientHistory(selectedPatient.id);
            fetchPatientDocuments(selectedPatient.id);
            fetchPrescriptions(selectedPatient.id);
            // Iniciar editor em branco para novo paciente
            setPrescriptionContent('');
        }
    }, [selectedPatient]);

    const fetchPatients = async () => {
        try {
            const { data, error } = await supabase
                .from('patients')
                .select('*')
                .eq('tenant_id', tenant?.id)
                .order('full_name');
            if (error) throw error;
            setPatients(data || []);
        } catch (err) {
            console.error('Error fetching patients:', err);
        }
    };

    const fetchPatientHistory = async (patientId: string) => {
        try {
            const { data, error } = await supabase
                .from('medical_records')
                .select('*')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            setRecords(data || []);
        } catch (err) {
            console.error('Error fetching history:', err);
        }
    };

    const handleOpenIDocs = () => {
        if (!selectedPatient?.cpf) {
            showToast('warning', t('recordsHub.toasts.idocsCpfRequired'));
            return;
        }

        // Padrão de busca iDoc/RadioMemory (Geralmente via Portal S3 ou Deep Link customizado)
        const idocUrl = `https://s3.radiomemory.com.br/`;
        window.open(idocUrl, '_blank');
        showToast('info', t('recordsHub.toasts.idocsOpening'));
    };

    const fetchPatientDocuments = async (patientId: string) => {
        try {
            const { data, error } = await supabase
                .from('patient_documents')
                .select('*')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            setDocuments(data || []);
        } catch (err) {
            console.error('Error fetching documents:', err);
        }
    };

    const fetchPrescriptions = async (patientId: string) => {
        try {
            setLoadingPrescriptions(true);
            const { data, error } = await supabase
                .from('prescriptions')
                .select('*')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setPrescriptions(data || []);
        } catch (error) {
            console.error('Error fetching prescriptions:', error);
            showToast('error', t('recordsHub.toasts.prescriptionsLoadError'));
        } finally {
            setLoadingPrescriptions(false);
        }
    };

    const savePrescriptionToDatabase = async () => {
        if (!selectedPatient || !tenant) return null;

        try {
            const { data, error } = await supabase
                .from('prescriptions')
                .insert([{
                    tenant_id: tenant.id,
                    patient_id: selectedPatient.id,
                    content_json: { 
                        content: prescriptionContent,
                        patient_name: selectedPatient.full_name,
                        date: new Date().toISOString()
                    },
                }])
                .select()
                .single();

            if (error) throw error;
            
            setPrescriptions(prev => [data, ...prev]);
            return data;
        } catch (error) {
            console.error('Error saving prescription:', error);
            showToast('error', t('recordsHub.toasts.prescriptionSaveError'));
            return null;
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedPatient || !tenant) return;

        setIsUploading(true);
        try {
            // 1. Upload to Storage
            const filePath = `${tenant.id}/${selectedPatient.id}/${Date.now()}_${file.name}`;
            const { error: uploadError } = await supabase.storage
                .from('patient-documents')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // 2. Insert Metadata
            const { error: dbError } = await supabase
                .from('patient_documents')
                .insert([{
                    tenant_id: tenant.id,
                    patient_id: selectedPatient.id,
                    name: file.name,
                    file_path: filePath,
                    file_type: file.type,
                    file_size: file.size
                }]);

            if (dbError) throw dbError;

            showToast('success', t('recordsHub.toasts.documentUploaded'));
            fetchPatientDocuments(selectedPatient.id);
        } catch (err) {
            console.error('Upload error:', err);
            showToast('error', t('recordsHub.toasts.documentUploadError'));
        } finally {
            setIsUploading(false);
        }
    };

    const handleDeleteDocument = async (doc: PatientDocument) => {
        if (!confirm(t('recordsHub.toasts.documentDeleteConfirm'))) return;
        
        try {
            // Delete from Storage
            await supabase.storage.from('patient-documents').remove([doc.file_path]);
            
            // Delete from DB
            const { error } = await supabase
                .from('patient_documents')
                .delete()
                .eq('id', doc.id);
            
            if (error) throw error;

            showToast('success', t('recordsHub.toasts.documentDeleted'));
            setDocuments(prev => prev.filter(d => d.id !== doc.id));
        } catch (err) {
            showToast('error', t('recordsHub.toasts.documentDeleteError'));
        }
    };

    const handleDownloadDocument = async (doc: PatientDocument) => {
        try {
            const { data, error } = await supabase.storage
                .from('patient-documents')
                .download(doc.file_path);

            if (error) throw error;

            const url = window.URL.createObjectURL(data);
            const a = document.createElement('a');
            a.href = url;
            a.download = doc.name;
            a.click();
        } catch (err) {
            showToast('error', t('recordsHub.toasts.documentDownloadError'));
        }
    };

    const handleViewDocument = async (doc: PatientDocument) => {
        setPreviewDoc(doc);
        setIsPreviewLoading(true);
        try {
            const { data, error } = await supabase.storage
                .from('patient-documents')
                .createSignedUrl(doc.file_path, 3600); // 1 hour access

            if (error) throw error;
            setPreviewUrl(data.signedUrl);
        } catch (err) {
            console.error('Error viewing document:', err);
            showToast('error', t('recordsHub.toasts.previewError'));
            setPreviewDoc(null);
        } finally {
            setIsPreviewLoading(false);
        }
    };

    const handleSaveNote = async () => {
        if (!selectedPatient || !newNote.title) return;

        try {
            // Get current user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error(t('recordsHub.toasts.notAuthenticated'));

            // Resolve doctor_id (must be a record in the 'doctors' table)
            // If the user is an admin or staff (not a doctor), doctor_id stays null (which is allowed)
            let resolvedDoctorId = null;
            if (user.email) {
                const { data: doctorData } = await supabase
                    .from('doctors')
                    .select('id')
                    .eq('email', user.email)
                    .eq('tenant_id', tenant?.id)
                    .maybeSingle();
                
                if (doctorData) {
                    resolvedDoctorId = doctorData.id;
                }
            }
            
            const { error } = await supabase
                .from('medical_records')
                .insert([{
                    tenant_id: tenant?.id,
                    patient_id: selectedPatient.id,
                    doctor_id: resolvedDoctorId,
                    event_type: newNote.type,
                    title: newNote.title,
                    description: newNote.description
                }]);
            
            if (error) throw error;
            
            showToast('success', t('recordsHub.toasts.noteSaved'));
            setNewNote({ title: '', description: '', type: 'consulta' });
            fetchPatientHistory(selectedPatient.id);
            setView('timeline');
        } catch (err: any) {
            console.error('Error saving note:', err);
            showToast('error', t('recordsHub.toasts.noteSaveErrorPrefix') + (err.message || t('recordsHub.toasts.unknownError')));
        }
    };


                            const handlePrint = async () => {
        if (!prescriptionContent) {
            showToast('warning', t('recordsHub.toasts.printContentRequired'));
            return;
        }

        // Auto-save to database
        const saved = await savePrescriptionToDatabase();

        if (saved) {
            showToast('success', t('recordsHub.toasts.prescriptionSaved'));
            setTimeout(() => {
                window.print();
            }, 500);
        }
    };


    const filteredPatients = patients.filter((p: Patient) => 
        p.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.cpf?.includes(searchTerm)
    );

    return (
        <div className="flex h-[calc(100vh-140px)] gap-6 overflow-hidden">
            {/* Dedicated Print-only view for prescriptions */}
            <div className="hidden print:block fixed inset-0 bg-white z-[9999] p-12 printable-area">
                <div className="max-w-4xl mx-auto border-[0.5px] border-slate-200 p-12 flex flex-col h-full min-h-[1000px]">
                    <div className="border-b-[1px] border-slate-300 pb-6 mb-8 flex justify-between items-start">
                        <div>
                            <h1 className="text-2xl font-black text-brand-primary tracking-tighter">TRAFFIO MED</h1>
                            <p className="text-xs font-bold text-graphite-400 mt-1 uppercase tracking-widest">{t('recordsHub.print.tagline')}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm font-black text-graphite-900">CRM/CRO 123.456</p>
                            <p className="text-[10px] text-graphite-400 font-bold uppercase mt-1">Brasília - DF</p>
                        </div>
                    </div>

                    <div className="text-center py-6 mb-10">
                        <h2 className="text-xl font-black tracking-[0.3em] text-graphite-900 border-y border-ice-100 py-3 uppercase">{t('recordsHub.print.title')}</h2>
                    </div>

                    <div className="mb-12 space-y-4">
                        <div className="flex items-end gap-2">
                             <span className="text-xs font-black text-graphite-300 uppercase shrink-0">{t('recordsHub.print.patientLabel')}</span>
                             <div className="flex-1 border-b border-ice-200 pb-1 font-black text-lg text-graphite-900">{selectedPatient?.full_name}</div>
                        </div>
                        <div className="flex items-end gap-2">
                             <span className="text-xs font-black text-graphite-300 uppercase shrink-0">{t('recordsHub.print.dateLabel')}</span>
                             <div className="flex-1 border-b border-ice-200 pb-1 font-bold text-graphite-900">{formatInTimezone(new Date(), tenant?.timezone || 'America/Sao_Paulo', { dateStyle: 'short' }, 'pt-BR')}</div>
                        </div>
                    </div>

                    <div className="flex-1 text-lg text-graphite-800 font-medium leading-relaxed whitespace-pre-wrap px-4 italic">
                        {prescriptionContent || t('recordsHub.print.empty')}
                    </div>

                    <div className="mt-20 pt-10 border-t border-ice-100 text-center space-y-2">
                        <div className="w-48 h-[1px] bg-graphite-900 mx-auto" />
                        <p className="text-xs font-black text-graphite-900 uppercase">{t('recordsHub.print.signature')}</p>
                        <p className="text-[9px] font-bold text-graphite-400 tracking-wider">{t('recordsHub.print.footer')}</p>
                    </div>
                </div>
            </div>

            {/* Column 1: Patient List */}
            <div className="w-80 flex flex-col bg-white rounded-[32px] border border-ice-100 shadow-sm overflow-hidden shrink-0 no-print">
                <div className="p-6 border-b border-ice-50">
                    <h2 className="text-xl font-black tracking-tight mb-4 text-graphite-900">{t('recordsHub.patientList.title')}</h2>
                    <div className="relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-300 group-focus-within:text-brand-primary transition-colors" size={18} />
                        <input
                            type="text"
                            placeholder={t('recordsHub.patientList.searchPlaceholder')}
                            className="w-full pl-12 pr-4 py-3 bg-ice-50 border-none rounded-2xl text-sm font-bold placeholder:text-graphite-300 focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                    {filteredPatients.map((patient: Patient) => (
                        <button
                            key={patient.id}
                            onClick={() => setSelectedPatient(patient)}
                            className={clsx(
                                "w-full flex items-center gap-3 p-4 rounded-2xl transition-all border-none cursor-pointer",
                                selectedPatient?.id === patient.id 
                                    ? "bg-brand-primary text-white shadow-lg shadow-brand-primary/20" 
                                    : "hover:bg-ice-50 text-graphite-700 bg-transparent"
                            )}
                        >
                            <div className={clsx(
                                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                                selectedPatient?.id === patient.id ? "bg-white/20" : "bg-ice-100 text-brand-primary"
                            )}>
                                <User size={20} />
                            </div>
                            <div className="text-left overflow-hidden">
                                <p className="font-bold text-sm truncate">{patient.full_name}</p>
                                <p className={clsx(
                                    "text-[10px] font-medium uppercase tracking-wider",
                                    selectedPatient?.id === patient.id ? "text-white/70" : "text-graphite-400"
                                )}>
                                    {docLabel((patient.country as CountryCode) || (patient.cpf ? 'BR' : DEFAULT_COUNTRY))}: {
                                        patient.national_id || patient.cpf
                                            ? formatDoc(patient.national_id || patient.cpf, (patient.country as CountryCode) || (patient.cpf ? 'BR' : DEFAULT_COUNTRY))
                                            : '---'
                                    }
                                </p>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Column 2 & 3: Details Room */}
            <div className="flex-1 flex flex-col bg-white rounded-[32px] border border-ice-100 shadow-sm overflow-hidden relative no-print">
                {!selectedPatient ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                        <div className="w-24 h-24 bg-ice-50 rounded-[40px] flex items-center justify-center mb-6">
                            <Clipboard className="text-ice-300" size={48} />
                        </div>
                        <h3 className="text-2xl font-black tracking-tight text-graphite-900 mb-2">{t('recordsHub.emptyState.title')}</h3>
                        <p className="text-graphite-400 max-w-sm font-medium">{t('recordsHub.emptyState.subtitle')}</p>
                    </div>
                ) : (
                    <>
                        {/* Hub Header */}
                        <div className="px-8 py-6 border-b border-ice-50 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 bg-brand-primary/10 rounded-2xl flex items-center justify-center text-brand-primary">
                                    <UserCircle size={32} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black tracking-tight text-graphite-900">{selectedPatient.full_name}</h3>
                                    <div className="flex items-center gap-3 text-xs font-bold text-graphite-400 uppercase tracking-widest mt-1">
                                        <span className="flex items-center gap-1"><Calendar size={12} /> {formatDisplayDate(selectedPatient.birth_date) || 'N/A'}</span>
                                        <span className="w-1 h-1 bg-ice-200 rounded-full"></span>
                                        <span>{t('recordsHub.header.activePatient')}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap justify-end">
                                <button
                                    onClick={() => setView('form')}
                                    className="px-5 py-3 bg-brand-primary text-white rounded-2xl font-black text-sm flex items-center gap-2 hover:scale-105 active:scale-95 transition-all border-none cursor-pointer shadow-lg shadow-brand-primary/20 shrink-0"
                                >
                                    <Plus size={18} /> {t('recordsHub.header.newEvolution')}
                                </button>
                                <button
                                    onClick={() => setView('prescription')}
                                    className="px-5 py-3 bg-white border border-ice-200 text-graphite-700 rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-ice-50 transition-all cursor-pointer shrink-0"
                                >
                                    <Pill size={18} className="text-rose-500" /> {t('recordsHub.header.prescribe')}
                                </button>
                                <button
                                    onClick={handleOpenIDocs}
                                    className="px-5 py-3 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-indigo-100 hover:scale-105 transition-all cursor-pointer shadow-sm shrink-0"
                                    title={t('recordsHub.header.idocsTitle')}
                                >
                                    <ExternalLink size={18} /> iDocs
                                </button>
                            </div>
                        </div>

                        {/* Sub-Nav Tab Bar */}
                        <div className="px-8 flex border-b border-ice-50 h-14">
                            {[
                                { id: 'timeline', label: t('recordsHub.tabs.timeline'), icon: History },
                                { id: 'details', label: t('recordsHub.tabs.details'), icon: Stethoscope },
                                { id: 'prescriptions', label: t('recordsHub.tabs.prescriptions'), icon: FileText },
                                { id: 'files', label: t('recordsHub.tabs.files'), icon: Clipboard },
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setView(tab.id as any)}
                                    className={clsx(
                                        "px-6 h-full flex items-center gap-2 text-sm font-bold transition-all relative border-none bg-transparent cursor-pointer",
                                        view === tab.id ? "text-brand-primary" : "text-graphite-400 hover:text-graphite-600"
                                    )}
                                >
                                    <tab.icon size={18} />
                                    {tab.label}
                                    {view === tab.id && (
                                        <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-1 bg-brand-primary rounded-t-full shadow-[0_-2px_6px_rgba(37,99,235,0.4)]" />
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-ice-50/20">
                            <AnimatePresence mode="wait">
                                {view === 'timeline' && (
                                    <motion.div 
                                        key="view-timeline"
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="max-w-3xl mx-auto space-y-8 py-4 px-2"
                                    >
                                        {records.length === 0 ? (
                                            <div className="text-center py-20 bg-white rounded-[32px] border border-dashed border-ice-200">
                                                <History className="mx-auto text-ice-200 mb-4" size={48} />
                                                <p className="font-bold text-graphite-400">{t('recordsHub.timeline.empty')}</p>
                                            </div>
                                        ) : (
                                            <div className="relative pl-8 border-l-2 border-ice-100 space-y-12">
                                                {records.map((record: MedicalRecord) => (
                                                    <div key={record.id} className="relative">
                                                        <div className="absolute -left-[41px] top-0 w-6 h-6 bg-white border-2 border-brand-primary rounded-full z-10 flex items-center justify-center">
                                                            <div className="w-2 h-2 bg-brand-primary rounded-full animate-pulse" />
                                                        </div>
                                                        <div className="bg-white p-6 rounded-[32px] border border-ice-100 shadow-sm hover:shadow-md transition-all">
                                                            <div className="flex items-center justify-between mb-4">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="px-3 py-1 bg-brand-primary/10 text-brand-primary rounded-lg text-[10px] font-black uppercase tracking-widest">
                                                                        {record.event_type}
                                                                    </div>
                                                                    <span className="text-xs font-bold text-graphite-300 flex items-center gap-1">
                                                                        <Clock size={12} /> {new Date(record.created_at).toLocaleDateString('pt-BR')}
                                                                    </span>
                                                                </div>
                                                                <button className="text-graphite-300 hover:text-brand-primary transition-colors border-none bg-transparent cursor-pointer">
                                                                    <ChevronRight size={20} />
                                                                </button>
                                                            </div>
                                                            <h4 className="text-lg font-black tracking-tight text-graphite-900 mb-2">{record.title}</h4>
                                                            <p className="text-sm text-graphite-500 leading-relaxed font-medium">{record.description}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </motion.div>
                                )}

                                {view === 'details' && (
                                    <motion.div 
                                        key="view-details"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        className="max-w-5xl mx-auto space-y-6 pb-20"
                                    >
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            {/* Section 1: Identificação */}
                                            <div className="bg-white p-8 rounded-[32px] border border-ice-100 shadow-sm">
                                                <div className="flex items-center gap-3 mb-6">
                                                    <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                                                        <User size={20} />
                                                    </div>
                                                    <h4 className="text-sm font-black uppercase tracking-widest text-graphite-900">{t('recordsHub.details.identification')}</h4>
                                                </div>
                                                <div className="space-y-4">
                                                    <InfoField label={t('recordsHub.details.fullName')} value={selectedPatient.full_name} />
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <InfoField
                                                            label={docLabel((selectedPatient.country as CountryCode) || (selectedPatient.cpf ? 'BR' : DEFAULT_COUNTRY))}
                                                            value={
                                                                selectedPatient.national_id || selectedPatient.cpf
                                                                    ? formatDoc(selectedPatient.national_id || selectedPatient.cpf, (selectedPatient.country as CountryCode) || (selectedPatient.cpf ? 'BR' : DEFAULT_COUNTRY))
                                                                    : t('recordsHub.details.notInformed')
                                                            }
                                                        />
                                                        <InfoField label={t('recordsHub.details.birthDate')} value={formatDisplayDate(selectedPatient.birth_date) || t('recordsHub.details.notInformed')} />
                                                    </div>
                                                    <InfoField label={t('recordsHub.details.gender')} value={selectedPatient.gender || t('recordsHub.details.notInformed')} />
                                                </div>
                                            </div>

                                            {/* Section 2: Contatos */}
                                            <div className="bg-white p-8 rounded-[32px] border border-ice-100 shadow-sm">
                                                <div className="flex items-center gap-3 mb-6">
                                                    <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                                                        <Phone size={20} />
                                                    </div>
                                                    <h4 className="text-sm font-black uppercase tracking-widest text-graphite-900">{t('recordsHub.details.contacts')}</h4>
                                                </div>
                                                <div className="space-y-4">
                                                    <InfoField
                                                        label={t('recordsHub.details.email')}
                                                        value={selectedPatient.email} 
                                                        icon={<Mail size={14} className="text-graphite-300" />} 
                                                    />
                                                    <InfoField
                                                        label={t('recordsHub.details.phone')}
                                                        value={formatNational(selectedPatient.phone) || selectedPatient.phone}
                                                        icon={<Phone size={14} className="text-graphite-300" />}
                                                    />
                                                </div>
                                            </div>

                                            {/* Section 3: Residência */}
                                            <div className="bg-white p-8 rounded-[32px] border border-ice-100 shadow-sm">
                                                <div className="flex items-center gap-3 mb-6">
                                                    <div className="w-10 h-10 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center">
                                                        <MapPin size={20} />
                                                    </div>
                                                    <h4 className="text-sm font-black uppercase tracking-widest text-graphite-900">{t('recordsHub.details.location')}</h4>
                                                </div>
                                                <div className="space-y-4">
                                                    {selectedPatient.address_json ? (
                                                        <>
                                                            <InfoField
                                                                label={t('recordsHub.details.address')}
                                                                value={`${selectedPatient.address_json.street || ''}, ${selectedPatient.address_json.number || 'S/N'}`}
                                                            />
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <InfoField label={t('recordsHub.details.neighborhood')} value={selectedPatient.address_json.neighborhood || '---'} />
                                                                <InfoField label={t('recordsHub.details.zipCode')} value={selectedPatient.address_json.zip_code || '---'} />
                                                            </div>
                                                            <InfoField label={t('recordsHub.details.cityState')} value={`${selectedPatient.address_json.city || ''} - ${selectedPatient.address_json.state || ''}`} />
                                                        </>
                                                    ) : (
                                                        <div className="text-center py-6 bg-ice-50 rounded-2xl border border-dashed border-ice-200">
                                                            <p className="text-xs font-bold text-graphite-400 italic">{t('recordsHub.details.addressNotRegistered')}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Section 4: Informações de Convênio */}
                                            <div className="bg-white p-8 rounded-[32px] border border-ice-100 shadow-sm">
                                                <div className="flex items-center gap-3 mb-6">
                                                    <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center">
                                                        <Shield size={20} />
                                                    </div>
                                                    <h4 className="text-sm font-black uppercase tracking-widest text-graphite-900">{t('recordsHub.details.insurance')}</h4>
                                                </div>
                                                <div className="space-y-4">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <div className={clsx(
                                                            "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                                                            selectedPatient.type === 'insurance' ? "bg-purple-100 text-purple-700" : "bg-emerald-100 text-emerald-700"
                                                        )}>
                                                            {selectedPatient.type === 'insurance' ? t('recordsHub.details.insurancePlan') : t('recordsHub.details.private')}
                                                        </div>
                                                    </div>
                                                    {selectedPatient.type === 'insurance' ? (
                                                        <>
                                                            <InfoField label={t('recordsHub.details.insuranceProvider')} value={selectedPatient.insurance_provider || t('recordsHub.details.notInformed')} />
                                                            <InfoField label={t('recordsHub.details.insuranceCardNumber')} value={selectedPatient.insurance_card_number || selectedPatient.insurance_card || t('recordsHub.details.notInformed')} />
                                                        </>
                                                    ) : (
                                                        <div className="flex items-baseline gap-2 pt-2">
                                                            <CreditCard size={14} className="text-graphite-300" />
                                                            <p className="text-sm font-bold text-graphite-500">{t('recordsHub.details.noInsurance')}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Section 5: Observações - Full Width */}
                                            <div className="md:col-span-2 bg-white p-8 rounded-[32px] border border-ice-100 shadow-sm">
                                                <div className="flex items-center gap-3 mb-6">
                                                    <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
                                                        <BookOpen size={20} />
                                                    </div>
                                                    <h4 className="text-sm font-black uppercase tracking-widest text-graphite-900">{t('recordsHub.details.notes')}</h4>
                                                </div>
                                                <div className="p-6 bg-amber-50/30 rounded-2xl border border-amber-100/50 min-h-[100px]">
                                                    <p className="text-sm text-graphite-600 leading-relaxed font-medium italic">
                                                        {selectedPatient.notes || t('recordsHub.details.notesEmpty')}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-end gap-3 pt-4">
                                            <button
                                                className="px-6 py-3 bg-white border border-ice-200 text-graphite-400 rounded-2xl font-bold text-sm cursor-not-allowed opacity-50 flex items-center gap-2"
                                                disabled
                                            >
                                                <Trash2 size={16} /> {t('recordsHub.details.deletePatient')}
                                            </button>
                                            <button
                                                onClick={() => showToast(t('recordsHub.toasts.editComingSoon'), 'info')}
                                                className="px-8 py-3 bg-brand-primary text-white rounded-2xl font-black text-sm flex items-center gap-2 hover:opacity-90 transition-all cursor-pointer shadow-lg shadow-brand-primary/10"
                                            >
                                                <Plus size={18} /> {t('recordsHub.details.editRegistration')}
                                            </button>
                                        </div>
                                    </motion.div>
                                )}

                                {view === 'form' && (
                                    <motion.div 
                                        key="view-form"
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="max-w-2xl mx-auto"
                                    >
                                        <div className="bg-white p-10 rounded-[40px] border border-ice-100 shadow-xl">
                                            <div className="flex items-center gap-3 mb-8">
                                                <button onClick={() => setView('timeline')} className="p-2 hover:bg-ice-50 rounded-xl transition-all border-none bg-transparent cursor-pointer">
                                                    <ArrowLeft size={20} className="text-graphite-900" />
                                                </button>
                                                <h3 className="text-2xl font-black tracking-tight text-graphite-900">{t('recordsHub.form.title')}</h3>
                                            </div>

                                            <div className="space-y-6">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-[10px] font-black uppercase tracking-widest text-graphite-400 mb-2 ml-1">{t('recordsHub.form.eventType')}</label>
                                                        <select
                                                            className="w-full p-4 bg-ice-50 border-none rounded-2xl font-bold text-sm outline-none ring-brand-primary/10 focus:ring-4 transition-all appearance-none"
                                                            value={newNote.type}
                                                            onChange={(e) => setNewNote({...newNote, type: e.target.value})}
                                                        >
                                                            <option value="consulta">{t('recordsHub.form.eventOptions.consulta')}</option>
                                                            <option value="exame">{t('recordsHub.form.eventOptions.exame')}</option>
                                                            <option value="procedimento">{t('recordsHub.form.eventOptions.procedimento')}</option>
                                                            <option value="nota">{t('recordsHub.form.eventOptions.nota')}</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] font-black uppercase tracking-widest text-graphite-400 mb-2 ml-1">{t('recordsHub.form.dateLabel')}</label>
                                                        <div className="p-4 bg-ice-50 border-none rounded-2xl font-bold text-sm text-graphite-400">{t('recordsHub.form.todayPrefix', { date: formatInTimezone(new Date(), tenant?.timezone || 'America/Sao_Paulo', { dateStyle: 'short' }, 'pt-BR') })}</div>
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="block text-[10px] font-black uppercase tracking-widest text-graphite-400 mb-2 ml-1">{t('recordsHub.form.titleLabel')}</label>
                                                    <input
                                                        type="text"
                                                        placeholder={t('recordsHub.form.titlePlaceholder')}
                                                        className="w-full p-4 bg-ice-50 border-none rounded-2xl font-bold text-sm outline-none ring-brand-primary/10 focus:ring-4 transition-all"
                                                        value={newNote.title}
                                                        onChange={(e) => setNewNote({...newNote, title: e.target.value})}
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-[10px] font-black uppercase tracking-widest text-graphite-400 mb-2 ml-1">{t('recordsHub.form.descriptionLabel')}</label>
                                                    <textarea
                                                        rows={6}
                                                        placeholder={t('recordsHub.form.descriptionPlaceholder')}
                                                        className="w-full p-4 bg-ice-50 border-none rounded-2xl font-bold text-sm outline-none ring-brand-primary/10 focus:ring-4 transition-all resize-none"
                                                        value={newNote.description}
                                                        onChange={(e) => setNewNote({...newNote, description: e.target.value})}
                                                    />
                                                </div>

                                                <button
                                                    onClick={handleSaveNote}
                                                    className="w-full p-5 bg-brand-primary text-white rounded-[32px] font-black text-base shadow-xl shadow-brand-primary/20 hover:scale-[1.02] active:scale-95 transition-all border-none cursor-pointer"
                                                >
                                                    {t('recordsHub.form.save')}
                                                </button>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

                                {view === 'prescription' && (
                                    <motion.div
                                        key="view-prescription"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="max-w-4xl mx-auto"
                                    >
                                        <div className="bg-white rounded-[40px] border border-ice-100 shadow-2xl overflow-hidden flex min-h-[600px]">
                                            {/* Left: Editor */}
                                            <div className="flex-1 p-10 border-r border-ice-50">
                                                <div className="flex items-center gap-3 mb-8">
                                                    <Pill className="text-rose-500" size={24} />
                                                    <h3 className="text-2xl font-black tracking-tight text-graphite-900">{t('recordsHub.prescriptionEditor.title')}</h3>
                                                </div>

                                                <div className="space-y-6">
                                                    <div>
                                                        <label className="block text-[10px] font-black uppercase tracking-widest text-graphite-400 mb-2 ml-1">{t('recordsHub.prescriptionEditor.medicationsLabel')}</label>
                                                        <textarea
                                                            rows={12}
                                                            placeholder={t('recordsHub.prescriptionEditor.medicationsPlaceholder')}
                                                            className="w-full p-6 bg-ice-50 border-none rounded-[32px] font-medium text-base outline-none ring-brand-primary/10 focus:ring-4 transition-all resize-none"
                                                            value={prescriptionContent}
                                                            onChange={(e) => setPrescriptionContent(e.target.value)}
                                                        />
                                                    </div>
                                                    
                                                    <div className="flex gap-4">
                                                        <button
                                                            onClick={handlePrint}
                                                            className="flex-1 p-4 bg-brand-primary text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 border-none cursor-pointer"
                                                        >
                                                            <Download size={18} /> {t('recordsHub.prescriptionEditor.savePdf')}
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                if (confirm(t('recordsHub.toasts.clearContentConfirm'))) {
                                                                    setPrescriptionContent('');
                                                                }
                                                            }}
                                                            className="p-4 bg-ice-50 text-rose-500 rounded-2xl hover:bg-rose-50 transition-all border-none cursor-pointer"
                                                            title={t('recordsHub.prescriptionEditor.clearTitle')}
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                        <button 
                                                            onClick={handlePrint}
                                                            className="p-4 bg-ice-50 text-graphite-400 rounded-2xl hover:bg-ice-100 transition-all border-none cursor-pointer"
                                                        >
                                                            <Printer size={18} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right: Preview (Professional Look) */}
                                            <div className="w-[300px] bg-slate-50 p-8 hidden md:block">
                                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6">{t('recordsHub.prescriptionEditor.previewVisualLabel')}</h4>
                                                <div className="aspect-[1/1.4] bg-white shadow-sm rounded-lg p-4 text-[6px] flex flex-col">
                                                    <div className="border-b-[0.5px] border-slate-200 pb-2 mb-2 flex justify-between">
                                                        <div className="font-bold">{t('recordsHub.prescriptionEditor.previewBrand')}</div>
                                                        <div className="text-slate-300">{t('recordsHub.prescriptionEditor.previewCrm')}</div>
                                                    </div>
                                                    <div className="text-center font-bold text-[8px] mb-4">{t('recordsHub.prescriptionEditor.previewTitle')}</div>
                                                    <div className="mb-1 uppercase font-bold text-slate-300">{t('recordsHub.prescriptionEditor.previewPatientLabel')}</div>
                                                    <div className="mb-4 font-bold border-b-[0.2px] border-slate-100">{selectedPatient.full_name}</div>
                                                    <div className="flex-1 text-slate-600 italic whitespace-pre-wrap">
                                                        {prescriptionContent || t('recordsHub.prescriptionEditor.previewPlaceholder')}
                                                    </div>
                                                    <div className="mt-auto pt-4 border-t-[0.5px] border-slate-100 text-center">
                                                        <div className="w-12 h-0.5 bg-slate-200 mx-auto mb-1" />
                                                        <div className="font-bold">{t('recordsHub.prescriptionEditor.previewSignature')}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

                                {view === 'prescriptions' && (
                                    <motion.div 
                                        key="view-prescriptions"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        className="max-w-5xl mx-auto flex gap-6 pb-20 relative h-[calc(100vh-280px)]"
                                    >
                                        {/* Left: List of Prescriptions */}
                                        <div className={clsx(
                                            "transition-all duration-500 overflow-y-auto pr-2",
                                            selectedPrescriptionForView ? "w-1/2" : "w-full"
                                        )}>
                                            <div className="space-y-4">
                                                {loadingPrescriptions ? (
                                                    <div className="text-center py-20 opacity-50 font-bold italic">{t('recordsHub.prescriptionsList.loading')}</div>
                                                ) : prescriptions.length === 0 ? (
                                                    <div className="bg-white p-12 rounded-[32px] border border-dashed border-ice-200 text-center">
                                                        <div className="w-16 h-16 bg-ice-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                                            <History className="text-graphite-300" size={24} />
                                                        </div>
                                                        <h4 className="text-lg font-black text-graphite-900 mb-1">{t('recordsHub.prescriptionsList.emptyTitle')}</h4>
                                                        <p className="text-sm text-graphite-400 font-medium max-w-xs mx-auto mb-6">{t('recordsHub.prescriptionsList.emptySubtitle')}</p>
                                                        <button
                                                            onClick={() => setView('prescription')}
                                                            className="px-6 py-3 bg-brand-primary text-white rounded-2xl font-black text-sm hover:scale-105 transition-all border-none cursor-pointer"
                                                        >
                                                            {t('recordsHub.prescriptionsList.newPrescription')}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    prescriptions.map(presc => (
                                                        <div 
                                                            key={presc.id}
                                                            onClick={() => setSelectedPrescriptionForView(selectedPrescriptionForView?.id === presc.id ? null : presc)}
                                                            className={clsx(
                                                                "bg-white p-6 rounded-[32px] border transition-all cursor-pointer group hover:shadow-lg",
                                                                selectedPrescriptionForView?.id === presc.id ? "border-brand-primary shadow-xl shadow-brand-primary/5 translate-x-1" : "border-ice-100 hover:border-ice-200 shadow-sm"
                                                            )}
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-4">
                                                                    <div className={clsx(
                                                                        "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                                                                        selectedPrescriptionForView?.id === presc.id ? "bg-brand-primary text-white" : "bg-ice-50 text-graphite-400 group-hover:bg-ice-100"
                                                                    )}>
                                                                        <FileText size={20} />
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-black uppercase tracking-widest text-graphite-400 mb-0.5">
                                                                            {new Date(presc.created_at).toLocaleDateString(getIntlLocale(i18n.language), { day: '2-digit', month: 'long', year: 'numeric' })}
                                                                        </p>
                                                                        <h4 className="text-sm font-black text-graphite-900">
                                                                            {t('recordsHub.prescriptionsList.digitalPrescription', { time: new Date(presc.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) })}
                                                                        </h4>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="text-right hidden sm:block">
                                                                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">{t('recordsHub.prescriptionsList.persisted')}</p>
                                                                    </div>
                                                                    <ChevronRight size={18} className={clsx(
                                                                        "transition-all",
                                                                        selectedPrescriptionForView?.id === presc.id ? "rotate-90 text-brand-primary" : "text-graphite-300"
                                                                    )} />
                                                                </div>
                                                            </div>
                                                            <div className="mt-4 pt-4 border-t border-ice-50 flex gap-2">
                                                                <span className="text-xs font-bold text-graphite-400 truncate max-w-[200px]">
                                                                    {presc.content_json?.content?.substring(0, 80)}...
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>

                                        {/* Right: Quick View Modal Overlay */}
                                        <AnimatePresence>
                                            {selectedPrescriptionForView && (
                                                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-12">
                                                    <motion.div 
                                                        initial={{ opacity: 0 }}
                                                        animate={{ opacity: 1 }}
                                                        exit={{ opacity: 0 }}
                                                        onClick={() => setSelectedPrescriptionForView(null)}
                                                        className="absolute inset-0 bg-graphite-900/40 backdrop-blur-sm"
                                                    />
                                                    
                                                    <motion.div 
                                                        key="prescription-quickview"
                                                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                                                        className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-[40px] border border-ice-100 shadow-2xl flex flex-col overflow-hidden"
                                                    >
                                                        <div className="p-8 border-b border-ice-50 flex items-center justify-between bg-ice-50/30">
                                                            <div>
                                                                <h3 className="text-xl font-black text-graphite-900 leading-none mb-1">{t('recordsHub.prescriptionViewer.title')}</h3>
                                                                <p className="text-xs font-black uppercase tracking-widest text-graphite-400">{t('recordsHub.prescriptionViewer.fullScreenView', { id: selectedPrescriptionForView.id.substring(0, 8) })}</p>
                                                            </div>
                                                            <button
                                                                onClick={() => setSelectedPrescriptionForView(null)}
                                                                className="p-3 hover:bg-white rounded-2xl transition-all border-none bg-transparent cursor-pointer text-graphite-400 group"
                                                            >
                                                                <Plus size={28} className="rotate-45 group-hover:text-rose-500 transition-colors" />
                                                            </button>
                                                        </div>

                                                        <div className="flex-1 overflow-y-auto p-12 bg-slate-100/50">
                                                            <div className="max-w-2xl mx-auto bg-white shadow-2xl rounded-3xl p-16 aspect-[1/1.414] flex flex-col text-sm border border-slate-200">
                                                                {/* Scaled Template */}
                                                                <div className="border-b-4 border-slate-900 pb-8 mb-8 flex justify-between items-end">
                                                                    <div>
                                                                        <div className="font-black text-2xl uppercase tracking-tighter text-slate-900">{t('recordsHub.prescriptionViewer.brand')}</div>
                                                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t('recordsHub.prescriptionViewer.brandTagline')}</div>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <div className="text-sm font-black text-slate-900">{t('recordsHub.prescriptionViewer.doctorPrefix', { name: tenant?.name || t('recordsHub.prescriptionViewer.doctorFallback') })}</div>
                                                                        <div className="text-[10px] font-bold text-slate-400 uppercase">{t('recordsHub.prescriptionViewer.doctorCrm')}</div>
                                                                    </div>
                                                                </div>

                                                                <div className="text-center font-black text-xl mb-12 tracking-[0.2em] uppercase text-slate-900 underline underline-offset-8 decoration-slate-200">{t('recordsHub.prescriptionViewer.heading')}</div>

                                                                <div className="mb-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                                                    <div className="flex justify-between items-center">
                                                                        <div>
                                                                            <span className="font-black uppercase text-[10px] text-slate-400 block mb-1">{t('recordsHub.prescriptionViewer.patientLabel')}</span>
                                                                            <span className="font-black text-lg text-slate-900">{selectedPrescriptionForView.content_json?.patient_name}</span>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <span className="font-black uppercase text-[10px] text-slate-400 block mb-1">{t('recordsHub.prescriptionViewer.issueDate')}</span>
                                                                            <span className="font-bold text-slate-700">{new Date(selectedPrescriptionForView.created_at).toLocaleDateString('pt-BR')}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                
                                                                <div className="flex-1 text-slate-800 whitespace-pre-wrap font-medium leading-relaxed italic text-lg pt-6">
                                                                    {selectedPrescriptionForView.content_json?.content}
                                                                </div>

                                                                <div className="mt-12 pt-8 border-t-2 border-slate-100 text-center relative">
                                                                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 opacity-10">
                                                                        <Stethoscope size={80} className="text-slate-900" />
                                                                    </div>
                                                                    <div className="w-24 h-1 bg-slate-900 mx-auto mb-3 rounded-full" />
                                                                    <div className="font-black uppercase tracking-[0.3em] text-[10px] text-slate-900">{t('recordsHub.prescriptionViewer.signatureLabel')}</div>
                                                                    <div className="text-[8px] font-bold text-slate-400 mt-1">{t('recordsHub.prescriptionViewer.authenticatedVia')}</div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="p-8 border-t border-ice-100 flex gap-4 bg-white">
                                                            <button
                                                                onClick={() => {
                                                                    setPrescriptionContent(selectedPrescriptionForView.content_json?.content);
                                                                    setView('prescription');
                                                                    setSelectedPrescriptionForView(null);
                                                                }}
                                                                className="flex-1 px-8 py-5 bg-brand-primary text-white rounded-[24px] font-black text-sm flex items-center justify-center gap-3 hover:opacity-90 hover:scale-[1.02] transform transition-all cursor-pointer shadow-xl shadow-brand-primary/20"
                                                            >
                                                                <Printer size={20} /> {t('recordsHub.prescriptionViewer.reprint')}
                                                            </button>
                                                            <button
                                                                onClick={() => showToast('info', t('recordsHub.toasts.generatingHighResPdf'))}
                                                                className="px-10 py-5 bg-ice-50 text-graphite-900 rounded-[24px] font-black text-sm flex items-center justify-center gap-3 hover:bg-ice-100 transition-all cursor-pointer border-none"
                                                            >
                                                                <Download size={20} /> {t('recordsHub.prescriptionViewer.downloadPdf')}
                                                            </button>
                                                        </div>
                                                    </motion.div>
                                                </div>
                                            )}
                                        </AnimatePresence>
                                    </motion.div>
                                )}
                                {view === 'files' && (
                                    <motion.div 
                                        key="view-files"
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="max-w-4xl mx-auto space-y-6"
                                    >
                                        {/* Upload Zone */}
                                        <div className="bg-white p-8 rounded-[32px] border-2 border-dashed border-ice-100 flex flex-col items-center justify-center group hover:border-brand-primary/30 transition-all">
                                            <div className="w-16 h-16 bg-ice-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                                <Upload className="text-brand-primary" size={24} />
                                            </div>
                                            <h4 className="text-lg font-black text-graphite-900 mb-1">{t('recordsHub.files.addDocument')}</h4>
                                            <p className="text-sm text-graphite-400 font-medium mb-6">{t('recordsHub.files.dragHint')}</p>

                                            <label className={clsx(
                                                "px-8 py-3 rounded-2xl font-black text-sm transition-all cursor-pointer",
                                                isUploading ? "bg-ice-100 text-graphite-300 pointer-events-none" : "bg-brand-primary text-white hover:shadow-xl hover:shadow-brand-primary/20"
                                            )}>
                                                {isUploading ? t('recordsHub.files.uploading') : t('recordsHub.files.selectFile')}
                                                <input
                                                    type="file"
                                                    className="hidden"
                                                    onChange={handleFileUpload}
                                                    disabled={isUploading}
                                                />
                                            </label>
                                        </div>

                                        {/* Documents Grid */}
                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                            {documents.length === 0 ? (
                                                <div className="col-span-full text-center py-10 opacity-50 font-bold text-graphite-400">
                                                    {t('recordsHub.files.empty')}
                                                </div>
                                            ) : (
                                                documents.map(doc => (
                                                    <div key={doc.id} className="bg-white p-5 rounded-[28px] border border-ice-100 shadow-sm hover:shadow-md transition-all group flex flex-col">
                                                        <div className="flex items-start justify-between mb-4">
                                                            <div className="w-12 h-12 bg-ice-50 rounded-2xl flex items-center justify-center text-brand-primary">
                                                                <File size={24} />
                                                            </div>
                                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button 
                                                                    onClick={() => handleViewDocument(doc)}
                                                                    className="w-8 h-8 rounded-lg hover:bg-ice-50 flex items-center justify-center text-brand-primary border-none bg-transparent cursor-pointer"
                                                                    title={t('recordsHub.files.quickView')}
                                                                >
                                                                    <Eye size={16} />
                                                                </button>
                                                                <button 
                                                                    onClick={() => handleDownloadDocument(doc)}
                                                                    className="w-8 h-8 rounded-lg hover:bg-ice-50 flex items-center justify-center text-graphite-400 border-none bg-transparent cursor-pointer"
                                                                >
                                                                    <Download size={16} />
                                                                </button>
                                                                <button 
                                                                    onClick={() => handleDeleteDocument(doc)}
                                                                    className="w-8 h-8 rounded-lg hover:bg-rose-50 flex items-center justify-center text-rose-400 border-none bg-transparent cursor-pointer"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="flex-1 overflow-hidden">
                                                            <p className="font-bold text-sm truncate text-graphite-900" title={doc.name}>{doc.name}</p>
                                                            <p className="text-[10px] font-medium text-graphite-400 uppercase tracking-widest mt-1">
                                                                {(doc.file_size / 1024 / 1024).toFixed(2)} MB • {new Date(doc.created_at).toLocaleDateString('pt-BR')}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </>
                )}
            </div>

            {/* Document Preview Modal */}
            <AnimatePresence>
                {previewDoc && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => {
                                setPreviewDoc(null);
                                setPreviewUrl(null);
                            }}
                            className="absolute inset-0 bg-graphite-900/60 backdrop-blur-md"
                        />
                        
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="relative w-full max-w-6xl max-h-[95vh] bg-white rounded-[48px] shadow-2xl flex flex-col overflow-hidden"
                        >
                            {/* Modal Header */}
                            <div className="p-8 border-b border-ice-50 flex items-center justify-between bg-white relative z-10">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-ice-50 rounded-2xl flex items-center justify-center text-brand-primary">
                                        <File size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-graphite-900 leading-none mb-1">{previewDoc.name}</h3>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-graphite-400">
                                            {previewDoc.file_type} • {(previewDoc.file_size / 1024 / 1024).toFixed(2)} MB
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => handleDownloadDocument(previewDoc)}
                                        className="p-4 bg-ice-50 text-graphite-900 rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-ice-100 transition-all cursor-pointer border-none"
                                    >
                                        <Download size={18} /> {t('recordsHub.documentPreview.downloadOriginal')}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setPreviewDoc(null);
                                            setPreviewUrl(null);
                                        }}
                                        className="p-4 bg-rose-50 text-rose-500 rounded-2xl hover:bg-rose-100 transition-all border-none cursor-pointer flex items-center justify-center"
                                    >
                                        <Plus size={24} className="rotate-45" />
                                    </button>
                                </div>
                            </div>

                            {/* Modal Content */}
                            <div className="flex-1 overflow-hidden bg-ice-50/50 flex items-center justify-center p-8">
                                {isPreviewLoading ? (
                                    <div className="flex flex-col items-center gap-4">
                                        <Loader2 size={48} className="text-brand-primary animate-spin" />
                                        <p className="font-bold text-graphite-400">{t('recordsHub.documentPreview.loading')}</p>
                                    </div>
                                ) : previewUrl ? (
                                    <div className="w-full h-full flex items-center justify-center">
                                        {previewDoc.file_type.startsWith('image/') ? (
                                            <img 
                                                src={previewUrl} 
                                                alt={previewDoc.name} 
                                                className="max-w-full max-h-full object-contain rounded-2xl shadow-lg border border-ice-100"
                                            />
                                        ) : previewDoc.file_type === 'application/pdf' ? (
                                            <iframe 
                                                src={`${previewUrl}#toolbar=0`}
                                                className="w-full h-full rounded-2xl border border-ice-100 shadow-inner bg-white"
                                                title="PDF Preview"
                                            />
                                        ) : (
                                            <div className="text-center p-12 bg-white rounded-[32px] border border-ice-100 shadow-sm">
                                                <File size={64} className="mx-auto text-ice-200 mb-6" />
                                                <h4 className="text-xl font-black text-graphite-900 mb-2">{t('recordsHub.documentPreview.unsupportedTitle')}</h4>
                                                <p className="text-graphite-400 font-medium mb-8">{t('recordsHub.documentPreview.unsupportedSubtitle', { type: previewDoc.file_type })}</p>
                                                <button
                                                    onClick={() => handleDownloadDocument(previewDoc)}
                                                    className="px-8 py-4 bg-brand-primary text-white rounded-2xl font-black text-base hover:scale-105 active:scale-95 transition-all border-none cursor-pointer shadow-lg shadow-brand-primary/20"
                                                >
                                                    {t('recordsHub.documentPreview.downloadNow')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-rose-500 font-bold">{t('recordsHub.documentPreview.loadError')}</div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

// ─── Helper Components ───────────────────────────────────────

const InfoField = ({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) => (
    <div className="space-y-1">
        <label className="text-[10px] font-black uppercase tracking-widest text-graphite-300 block ml-0.5">{label}</label>
        <div className="flex items-center gap-2 group">
            {icon && <span className="shrink-0">{icon}</span>}
            <div className="flex-1 bg-ice-50/50 px-3 py-2 rounded-xl text-sm font-bold text-graphite-700 border border-transparent group-hover:border-ice-100 transition-all">
                {value || '---'}
            </div>
        </div>
    </div>
);
