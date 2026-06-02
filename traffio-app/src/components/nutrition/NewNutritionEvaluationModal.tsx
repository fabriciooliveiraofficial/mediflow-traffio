import React from 'react';
import { X } from 'lucide-react';
import { AnthropometryForm } from './AnthropometryForm';

interface NewNutritionEvaluationModalProps {
    isOpen: boolean;
    onClose: () => void;
    patientId?: string;
    patientName?: string;
}

export const NewNutritionEvaluationModal: React.FC<NewNutritionEvaluationModalProps> = ({ 
    isOpen, 
    onClose, 
    patientId,
    patientName
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-graphite-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-4xl rounded-[40px] shadow-2xl overflow-hidden border border-ice-100 animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                <div className="p-8 border-b border-ice-100 flex items-center justify-between bg-ice-50/30">
                    <div>
                        <h3 className="text-2xl font-black text-graphite-900 tracking-tight">Nova Avaliação Antropométrica</h3>
                        <p className="text-xs text-brand-primary font-black tracking-widest uppercase mt-1">Paciente: {patientName || 'Selecionar'}</p>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="p-3 hover:bg-ice-100 rounded-2xl transition-all border-none bg-transparent cursor-pointer text-graphite-400"
                    >
                        <X size={24} />
                    </button>
                </div>
                
                <div className="flex-1 overflow-auto p-8 bg-white">
                    <AnthropometryForm 
                        patientId={patientId || ''} 
                        onSuccess={() => {
                            onClose();
                        }} 
                    />
                </div>
            </div>
        </div>
    );
};
