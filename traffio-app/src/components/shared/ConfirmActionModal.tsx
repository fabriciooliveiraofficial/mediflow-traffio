import { AlertTriangle, Loader2 } from 'lucide-react';
import React from 'react';

interface ConfirmActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isLoading?: boolean;
}

export const ConfirmActionModal: React.FC<ConfirmActionModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    isLoading = false
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-graphite-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-[32px] shadow-2xl p-8 md:p-10 border border-ice-100 animate-in fade-in zoom-in duration-300 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-rose-50 text-rose-500 rounded-2xl mb-4">
                    <AlertTriangle size={28} />
                </div>
                
                <h2 className="text-2xl font-black text-graphite-900 mb-2">{title}</h2>
                <p className="text-sm text-graphite-500 font-medium mb-6 leading-relaxed">
                    {message}
                </p>

                <div className="flex flex-col gap-3">
                    <button
                        onClick={onConfirm}
                        disabled={isLoading}
                        className="w-full bg-rose-500 text-white py-4 rounded-xl font-bold shadow-lg shadow-rose-500/25 hover:scale-[1.02] active:scale-[0.98] hover:bg-rose-600 transition-all flex items-center justify-center gap-2 border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading && <Loader2 size={18} className="animate-spin" />}
                        {confirmText}
                    </button>
                    
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="w-full bg-white border border-ice-200 text-graphite-700 py-4 rounded-xl font-bold hover:bg-ice-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {cancelText}
                    </button>
                </div>
            </div>
        </div>
    );
};
