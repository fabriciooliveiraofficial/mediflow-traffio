import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DicomViewer } from './DicomViewer';

interface DicomViewerModalProps {
    isOpen: boolean;
    onClose: () => void;
    fileUrl?: string;
}

export const DicomViewerModal: React.FC<DicomViewerModalProps> = ({ isOpen, onClose, fileUrl }) => {
    const { t } = useTranslation('medical');
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-graphite-950/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-graphite-900 w-full max-w-6xl rounded-[40px] shadow-2xl overflow-hidden border border-white/5 animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-black text-white tracking-tight">{t('dentalModals.dicomViewer.title')}</h3>
                        <p className="text-xs text-graphite-400 font-bold tracking-widest uppercase mt-1">{t('dentalModals.dicomViewer.subtitle')}</p>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="p-3 hover:bg-white/10 rounded-2xl transition-all border-none bg-transparent cursor-pointer text-graphite-400 hover:text-white"
                    >
                        <X size={24} />
                    </button>
                </div>
                
                <div className="flex-1 overflow-auto p-4 md:p-8">
                    <DicomViewer fileUrl={fileUrl || "https://images.unsplash.com/photo-1579154235828-4019a5ca884c?q=80&w=1000&auto=format&fit=crop"} />
                </div>
            </div>
        </div>
    );
};
