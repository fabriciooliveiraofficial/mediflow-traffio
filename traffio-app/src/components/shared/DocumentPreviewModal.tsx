import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, File, Download, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

interface DocumentPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    bucket: string;
    filePath: string | null | undefined;
    fileName: string;
    fileType?: string | null;
}

/**
 * Modal de pré-visualização de documento, renderizado via portal em document.body —
 * evita o bug de position:fixed quebrado por um ancestral com transform (framer-motion),
 * que fazia esse tipo de modal abrir cortado/inacessível dentro de colunas roláveis.
 */
export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
    isOpen,
    onClose,
    bucket,
    filePath,
    fileName,
    fileType,
}) => {
    const { t } = useTranslation('medical');
    const { showToast } = useToast();
    const [signedUrl, setSignedUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        if (!filePath) { setSignedUrl(null); return; }

        setLoading(true);
        setSignedUrl(null);
        supabase.storage
            .from(bucket)
            .createSignedUrl(filePath, 3600)
            .then(({ data, error }) => {
                if (error) throw error;
                setSignedUrl(data.signedUrl);
            })
            .catch((err) => {
                console.error('[DocumentPreviewModal] Error creating signed URL:', err);
                showToast('error', t('documentPreviewModal.loadError'));
            })
            .finally(() => setLoading(false));
    }, [isOpen, bucket, filePath]);

    const handleDownload = async () => {
        if (!filePath) return;
        try {
            const { data, error } = await supabase.storage.from(bucket).download(filePath);
            if (error) throw error;
            const url = window.URL.createObjectURL(data);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('[DocumentPreviewModal] Download error:', err);
            showToast('error', t('documentPreviewModal.loadError'));
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8">
            <div className="absolute inset-0 bg-graphite-900/60 backdrop-blur-md" onClick={onClose} />

            <div className="relative w-full max-w-5xl max-h-[92vh] bg-white rounded-[32px] shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-ice-50 flex items-center justify-between bg-white relative z-10 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-2xl bg-ice-50 flex items-center justify-center text-brand-primary shrink-0">
                            <File size={22} />
                        </div>
                        <h3 className="text-lg font-black text-graphite-900 truncate" title={fileName}>{fileName}</h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={handleDownload}
                            disabled={!filePath}
                            className="p-3 bg-ice-50 text-graphite-900 rounded-xl font-black text-sm flex items-center gap-2 hover:bg-ice-100 transition-all cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
                            title={t('documentPreviewModal.downloadOriginal')}
                        >
                            <Download size={18} />
                        </button>
                        <button
                            onClick={onClose}
                            aria-label={t('documentPreviewModal.close')}
                            className="p-3 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100 transition-all border-none cursor-pointer flex items-center justify-center"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto bg-ice-50/50 flex items-center justify-center p-8 min-h-0">
                    {loading ? (
                        <div className="flex flex-col items-center gap-4">
                            <Loader2 size={40} className="text-brand-primary animate-spin" />
                            <p className="font-bold text-graphite-400">{t('documentPreviewModal.loading')}</p>
                        </div>
                    ) : !signedUrl ? (
                        <div className="text-rose-500 font-bold">{t('documentPreviewModal.loadError')}</div>
                    ) : (fileType || '').startsWith('image/') ? (
                        <img
                            src={signedUrl}
                            alt={fileName}
                            className="max-w-full max-h-full object-contain rounded-2xl shadow-lg border border-ice-100"
                        />
                    ) : fileType === 'application/pdf' ? (
                        <iframe
                            src={`${signedUrl}#toolbar=0`}
                            className="w-full h-full rounded-2xl border border-ice-100 shadow-inner bg-white"
                            title={fileName}
                        />
                    ) : (
                        <div className="text-center p-12 bg-white rounded-[32px] border border-ice-100 shadow-sm">
                            <File size={56} className="mx-auto text-ice-200 mb-6" />
                            <h4 className="text-lg font-black text-graphite-900 mb-2">{t('documentPreviewModal.unsupportedTitle')}</h4>
                            <p className="text-graphite-400 font-medium mb-8">{t('documentPreviewModal.unsupportedSubtitle', { type: fileType || '?' })}</p>
                            <button
                                onClick={handleDownload}
                                className="px-8 py-4 bg-brand-primary text-white rounded-2xl font-black text-base hover:scale-105 active:scale-95 transition-all border-none cursor-pointer shadow-lg shadow-brand-primary/20"
                            >
                                {t('documentPreviewModal.downloadNow')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};
