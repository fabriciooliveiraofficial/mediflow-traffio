import React from 'react';
import { X, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Odontogram } from './Odontogram';
import { useToast } from '../../contexts/ToastContext';

interface OdontogramModalProps {
    isOpen: boolean;
    onClose: () => void;
    patientId: string;
    patientName?: string;
    patientCpf?: string;
}

export const OdontogramModal: React.FC<OdontogramModalProps> = ({ isOpen, onClose, patientId, patientName, patientCpf }) => {
    const { t } = useTranslation('medical');
    const { showToast } = useToast();

    if (!isOpen) return null;

    const handleOpenIDocs = () => {
        if (!patientCpf) {
            showToast('warning', t('dentalModals.odontogramModal.toasts.cpfRequired'));
            return;
        }
        window.open('https://s3.radiomemory.com.br/', '_blank');
        showToast('info', t('dentalModals.odontogramModal.toasts.opening'));
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-graphite-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-ice-50 w-full max-w-5xl rounded-[40px] shadow-2xl overflow-hidden border border-white animate-in zoom-in-95 duration-300 flex flex-col max-h-[95vh]">
                <div className="p-8 border-b border-ice-100 flex items-center justify-between bg-white/50 backdrop-blur-md">
                    <div>
                        <h3 className="text-2xl font-black text-graphite-900 tracking-tight">{t('dentalModals.odontogramModal.title')}</h3>
                        <p className="text-xs text-brand-primary font-black tracking-widest uppercase mt-1">{t('dentalModals.odontogramModal.patientPrefix', { name: patientName || t('dentalModals.odontogramModal.selectFallback') })}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleOpenIDocs}
                            className="px-5 py-3 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-indigo-100 transition-all cursor-pointer shadow-sm"
                            title={t('dentalModals.odontogramModal.idocsTitle')}
                        >
                            <ExternalLink size={18} /> iDocs
                        </button>
                        <button 
                            onClick={onClose} 
                            className="p-3 hover:bg-ice-100 rounded-2xl transition-all border-none bg-transparent cursor-pointer text-graphite-400 ml-2"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>
                
                <div className="flex-1 overflow-auto p-8">
                    <Odontogram patientId={patientId} onSuccess={onClose} />
                </div>
            </div>
        </div>
    );
};
