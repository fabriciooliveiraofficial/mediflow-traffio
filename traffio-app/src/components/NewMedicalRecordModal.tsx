import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Save, Stethoscope, FileText, Activity, Brain, ClipboardList, Upload, History, ExternalLink } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { supabase } from '../lib/supabase';

interface NewMedicalRecordModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    patientId: string;
    patientCpf?: string;
}

export const NewMedicalRecordModal: React.FC<NewMedicalRecordModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    patientId,
    patientCpf
}) => {
    const { t } = useTranslation('medical');
    const { showToast } = useToast();
    const { formatDate } = useLocaleFormat();
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState<any[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const [soap, setSoap] = useState({
        s: '',
        o: '',
        a: '',
        p: ''
    });

    useEffect(() => {
        if (isOpen && patientId) {
            supabase
                .from('medical_records')
                .select('id, soap_notes, created_at, content')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false })
                .limit(5)
                .then(({ data }) => setHistory(data || []));
        }
    }, [isOpen, patientId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            // 1. Get current user and tenant
            const { data: { user } } = await supabase.auth.getUser();
            
            if (!user) throw new Error(t('newMedicalRecordModal.errors.noSession'));

            const { data: memberData } = await supabase
                .from('members')
                .select('tenant_id')
                .eq('user_id', user.id)
                .single();

            if (!memberData) throw new Error(t('newMedicalRecordModal.errors.noClinic'));

            // 2. Resolve doctor_id (must be a record in the 'doctors' table)
            // If the user is an admin or staff (not a doctor), doctor_id stays null (which is allowed)
            let resolvedDoctorId = null;
            if (user.email) {
                const { data: doctorData } = await supabase
                    .from('doctors')
                    .select('id')
                    .eq('email', user.email)
                    .eq('tenant_id', memberData.tenant_id)
                    .maybeSingle();
                
                if (doctorData) {
                    resolvedDoctorId = doctorData.id;
                }
            }

            const { error } = await supabase
                .from('medical_records')
                .insert([{
                    patient_id: patientId,
                    doctor_id: resolvedDoctorId,
                    tenant_id: memberData.tenant_id,
                    soap_notes: soap,
                    content: t('newMedicalRecordModal.contentPrefix', { date: formatDate(new Date()) })
                }]);

            if (error) throw error;


            showToast('success', t('newMedicalRecordModal.toasts.saved'));
            onSuccess();
            onClose();
            setSoap({ s: '', o: '', a: '', p: '' });

        } catch (error: any) {
            console.error('Error adding record:', error);
            showToast('error', t('newMedicalRecordModal.toasts.saveErrorPrefix') + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        onClick={onClose}
                        className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]"
                    />

                    {/* Modal */}
                    <div
                        className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none"
                    >
                        <div className="bg-white pointer-events-auto w-full max-w-4xl rounded-[32px] shadow-2xl shadow-brand-primary/20 overflow-hidden border border-white/20 flex flex-col max-h-[90vh]">
                            {/* Header */}
                            <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50 shrink-0">
                                <div>
                                    <h3 className="text-xl font-black text-graphite-900 tracking-tight flex items-center gap-2">
                                        <Stethoscope className="text-brand-primary" size={24} />
                                        {t('newMedicalRecordModal.title')}
                                    </h3>
                                    <p className="text-sm text-graphite-400 font-medium">{t('newMedicalRecordModal.subtitle')}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => {
                                            if (!patientCpf) {
                                                showToast('warning', t('newMedicalRecordModal.toasts.idocsCpfRequired'));
                                                return;
                                            }
                                            window.open('https://s3.radiomemory.com.br/', '_blank');
                                            showToast('info', t('newMedicalRecordModal.toasts.idocsOpening'));
                                        }}
                                        className="px-4 py-2 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl font-black text-xs flex items-center gap-2 hover:bg-indigo-100 transition-all cursor-pointer shadow-sm"
                                    >
                                        <ExternalLink size={16} /> {t('newMedicalRecordModal.idocs')}
                                    </button>
                                    <button
                                        onClick={onClose}
                                        className="w-10 h-10 rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 hover:text-brand-primary hover:border-brand-primary/30 transition-all cursor-pointer"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>

                            {/* Body: Form + History Sidebar */}
                            <div className="flex flex-1 overflow-hidden">
                                {/* Form */}
                                <form onSubmit={handleSubmit} className="flex-1 p-8 space-y-5 overflow-y-auto">

                                    {/* S - Subjetivo */}
                                    <div className="space-y-1">
                                        <label className="flex items-center gap-2 text-xs font-black text-brand-primary uppercase tracking-wider">
                                            <FileText size={14} />
                                            {t('newMedicalRecordModal.subjective.label')}
                                        </label>
                                        <textarea
                                            required
                                            value={soap.s}
                                            onChange={e => setSoap({ ...soap, s: e.target.value })}
                                            placeholder={t('newMedicalRecordModal.subjective.placeholder')}
                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl p-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all placeholder:text-graphite-300 min-h-[80px] resize-none"
                                        />
                                    </div>

                                    {/* O - Objetivo */}
                                    <div className="space-y-1">
                                        <label className="flex items-center gap-2 text-xs font-black text-brand-primary uppercase tracking-wider">
                                            <Activity size={14} />
                                            {t('newMedicalRecordModal.objective.label')}
                                        </label>
                                        <textarea
                                            required
                                            value={soap.o}
                                            onChange={e => setSoap({ ...soap, o: e.target.value })}
                                            placeholder={t('newMedicalRecordModal.objective.placeholder')}
                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl p-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all placeholder:text-graphite-300 min-h-[80px] resize-none"
                                        />
                                    </div>

                                    {/* A - Avaliação */}
                                    <div className="space-y-1">
                                        <label className="flex items-center gap-2 text-xs font-black text-brand-primary uppercase tracking-wider">
                                            <Brain size={14} />
                                            {t('newMedicalRecordModal.assessment.label')}
                                        </label>
                                        <textarea
                                            required
                                            value={soap.a}
                                            onChange={e => setSoap({ ...soap, a: e.target.value })}
                                            placeholder={t('newMedicalRecordModal.assessment.placeholder')}
                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl p-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all placeholder:text-graphite-300 min-h-[60px] resize-none"
                                        />
                                    </div>

                                    {/* P - Plano */}
                                    <div className="space-y-1">
                                        <label className="flex items-center gap-2 text-xs font-black text-brand-primary uppercase tracking-wider">
                                            <ClipboardList size={14} />
                                            {t('newMedicalRecordModal.plan.label')}
                                        </label>
                                        <textarea
                                            required
                                            value={soap.p}
                                            onChange={e => setSoap({ ...soap, p: e.target.value })}
                                            placeholder={t('newMedicalRecordModal.plan.placeholder')}
                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl p-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all placeholder:text-graphite-300 min-h-[60px] resize-none"
                                        />
                                    </div>

                                    {/* File Upload */}
                                    <div className="space-y-1">
                                        <label className="flex items-center gap-2 text-xs font-black text-graphite-400 uppercase tracking-wider">
                                            <Upload size={14} />
                                            {t('newMedicalRecordModal.attachLabel')}
                                        </label>
                                        <label className="flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed border-ice-200 rounded-xl text-sm font-medium text-graphite-400 hover:border-brand-primary/40 hover:text-brand-primary transition-all cursor-pointer">
                                            <Upload size={16} />
                                            {file ? file.name : t('newMedicalRecordModal.attachPlaceholder')}
                                            <input
                                                type="file"
                                                accept=".pdf,.jpg,.jpeg,.png,.dicom"
                                                className="hidden"
                                                onChange={(e) => setFile(e.target.files?.[0] || null)}
                                            />
                                        </label>
                                    </div>

                                    <div className="pt-2 flex gap-3 shrink-0">
                                        <button
                                            type="button"
                                            onClick={onClose}
                                            className="flex-1 py-3.5 rounded-2xl font-bold text-graphite-700 hover:bg-ice-50 border border-ice-200 transition-all cursor-pointer"
                                        >
                                            {t('newMedicalRecordModal.cancel')}
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="flex-[2] bg-brand-primary text-white py-3.5 rounded-2xl font-bold shadow-xl shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed border-none cursor-pointer"
                                        >
                                            {loading ? t('newMedicalRecordModal.saving') : (<><Save size={18} /><span>{t('newMedicalRecordModal.save')}</span></>)}
                                        </button>
                                    </div>
                                </form>

                                {/* History Sidebar */}
                                <div className="hidden md:flex w-72 border-l border-ice-100 bg-ice-50/30 flex-col p-5 overflow-y-auto">
                                    <h4 className="text-xs font-black text-graphite-400 uppercase tracking-wider flex items-center gap-1.5 mb-4">
                                        <History size={14} /> {t('newMedicalRecordModal.history.title')}
                                    </h4>
                                    {history.length === 0 ? (
                                        <p className="text-xs text-graphite-300 font-medium">{t('newMedicalRecordModal.history.empty')}</p>
                                    ) : (
                                        <div className="space-y-3">
                                            {history.map((rec) => (
                                                <div key={rec.id} className="bg-white rounded-xl p-3 border border-ice-100 space-y-1.5">
                                                    <p className="text-[10px] font-bold text-graphite-400">
                                                        {new Date(rec.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                    </p>
                                                    {rec.soap_notes && (
                                                        <>
                                                            <p className="text-[10px] text-graphite-600"><span className="font-black text-brand-primary">S:</span> {(rec.soap_notes as any)?.s?.slice(0, 60) || '-'}...</p>
                                                            <p className="text-[10px] text-graphite-600"><span className="font-black text-emerald-600">A:</span> {(rec.soap_notes as any)?.a?.slice(0, 60) || '-'}...</p>
                                                        </>
                                                    )}
                                                    {!rec.soap_notes && rec.content && (
                                                        <p className="text-[10px] text-graphite-500 italic">{rec.content.slice(0, 80)}...</p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )
            }
        </>
    );
};
