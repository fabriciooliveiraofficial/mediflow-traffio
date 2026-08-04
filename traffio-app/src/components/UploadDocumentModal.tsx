import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Upload, Save, FlaskConical, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';

interface UploadDocumentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    patientId: string;
}

export const UploadDocumentModal: React.FC<UploadDocumentModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    patientId
}) => {
    const { t } = useTranslation('medical');
    const { showToast } = useToast();
    const { tenant } = useTenant();
    const [loading, setLoading] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [description, setDescription] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) {
            showToast('error', t('uploadDocumentModal.toasts.fileRequired'));
            return;
        }
        if (!tenant?.id) {
            showToast('error', t('uploadDocumentModal.toasts.noSession'));
            return;
        }

        setLoading(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();

            // 1. Upload real do arquivo para o Storage (bucket privado 'documents')
            const filePath = `${tenant.id}/${patientId}/${Date.now()}_${file.name}`;
            const { error: uploadError } = await supabase.storage
                .from('documents')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // 2. Metadados na tabela documents
            const { error } = await supabase
                .from('documents')
                .insert([{
                    patient_id: patientId,
                    tenant_id: tenant.id,
                    filename: description || file.name,
                    file_path: filePath,
                    file_type: file.type,
                    category: 'exam_result',
                    uploaded_by: user?.id,
                }]);

            if (error) throw error;

            showToast('success', t('uploadDocumentModal.toasts.saved'));
            onSuccess();
            onClose();
            setFile(null);
            setDescription('');

        } catch (error: any) {
            console.error('Error uploading document:', error);
            showToast('error', t('uploadDocumentModal.toasts.saveErrorPrefix') + error.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]"
            />

            {/* Modal */}
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-white pointer-events-auto w-full max-w-xl rounded-[32px] shadow-2xl overflow-hidden border border-white/20">
                    {/* Header */}
                    <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50">
                        <div>
                            <h3 className="text-xl font-black text-graphite-900 tracking-tight flex items-center gap-2">
                                <FlaskConical className="text-emerald-500" size={24} />
                                {t('uploadDocumentModal.title')}
                            </h3>
                            <p className="text-sm text-graphite-400 font-medium">{t('uploadDocumentModal.subtitle')}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-10 h-10 rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 hover:text-brand-primary hover:border-brand-primary/30 transition-all cursor-pointer"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Body */}
                    <form onSubmit={handleSubmit} className="p-8 space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1 block">{t('uploadDocumentModal.descriptionLabel')}</label>
                                <input
                                    type="text"
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    placeholder={t('uploadDocumentModal.descriptionPlaceholder')}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1 block">{t('uploadDocumentModal.fileLabel')}</label>
                                <label className="flex flex-col items-center justify-center gap-3 w-full py-12 border-2 border-dashed border-ice-200 rounded-2xl text-sm font-medium text-graphite-400 hover:border-emerald-500/40 hover:bg-emerald-50/30 transition-all cursor-pointer group">
                                    <div className="w-16 h-16 rounded-2xl bg-ice-50 flex items-center justify-center group-hover:scale-110 group-hover:bg-emerald-50 transition-all">
                                        <Upload className="text-ice-300 group-hover:text-emerald-500" size={32} />
                                    </div>
                                    <div className="text-center">
                                        <p className="font-bold text-graphite-900 group-hover:text-emerald-600">
                                            {file ? file.name : t('uploadDocumentModal.fileSelectPlaceholder')}
                                        </p>
                                        <p className="text-xs text-graphite-400">{t('uploadDocumentModal.fileHint')}</p>
                                    </div>
                                    <input
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png,.dicom"
                                        className="hidden"
                                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    />
                                </label>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="pt-4 flex gap-4">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-4 rounded-2xl font-bold text-graphite-700 hover:bg-ice-50 border border-ice-200 transition-all cursor-pointer"
                            >
                                {t('uploadDocumentModal.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={loading || !file}
                                className="flex-[2] bg-emerald-500 text-white py-4 rounded-2xl font-black shadow-xl shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed border-none cursor-pointer"
                            >
                                {loading ? (
                                    <Loader2 className="animate-spin" size={18} />
                                ) : (
                                    <><Save size={18} /><span>{t('uploadDocumentModal.save')}</span></>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
};
