import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface VoidReasonModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void | Promise<void>;
    title: string;
    description: string;
    confirmLabel: string;
}

/**
 * Modal genérico para ações que precisam de motivo registrado (anular receita/
 * evolução, excluir exame). Dado clínico não some silenciosamente — toda anulação
 * ou exclusão fica no clinical_audit_log com o motivo digitado aqui.
 */
export const VoidReasonModal: React.FC<VoidReasonModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    confirmLabel,
}) => {
    const { t } = useTranslation('medical');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        if (!reason.trim()) return;
        setLoading(true);
        try {
            await onConfirm(reason.trim());
            setReason('');
        } finally {
            setLoading(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-graphite-900/60 backdrop-blur-sm" onClick={() => !loading && onClose()} />
            <div className="relative max-w-md w-full bg-white rounded-[32px] shadow-2xl p-8 border border-ice-100 animate-in fade-in zoom-in duration-200">
                <div className="flex items-start justify-between mb-4">
                    <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl">
                        <AlertTriangle size={24} />
                    </div>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        aria-label={t('viewPrescriptionModal.close')}
                        className="w-9 h-9 rounded-xl bg-ice-50 flex items-center justify-center text-graphite-400 hover:text-graphite-900 transition-colors border-none cursor-pointer disabled:opacity-50"
                    >
                        <X size={18} />
                    </button>
                </div>

                <h2 className="text-lg font-black text-graphite-900 mb-1">{title}</h2>
                <p className="text-sm text-graphite-500 font-medium mb-5 leading-relaxed">{description}</p>

                <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1.5 block">
                    {t('voidReasonModal.reasonLabel')}
                </label>
                <textarea
                    autoFocus
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('voidReasonModal.reasonPlaceholder')}
                    className="w-full bg-ice-50 border border-ice-200 rounded-xl p-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all min-h-[90px] resize-none mb-6"
                />

                <div className="flex flex-col gap-3">
                    <button
                        onClick={handleConfirm}
                        disabled={loading || !reason.trim()}
                        className="w-full bg-rose-500 text-white py-4 rounded-xl font-bold shadow-lg shadow-rose-500/25 hover:scale-[1.02] active:scale-[0.98] hover:bg-rose-600 transition-all flex items-center justify-center gap-2 border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading && <Loader2 size={18} className="animate-spin" />}
                        {confirmLabel}
                    </button>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="w-full bg-white border border-ice-200 text-graphite-700 py-4 rounded-xl font-bold hover:bg-ice-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {t('voidReasonModal.cancel')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
