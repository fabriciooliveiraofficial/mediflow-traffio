import React, { useState } from 'react';
import { X, Save, ClipboardList, Plus, Trash2, Pill } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';

interface NewPrescriptionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    patientId: string;
}

interface Medication {
    name: string;
    dosage: string;
    instructions: string;
}

export const NewPrescriptionModal: React.FC<NewPrescriptionModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    patientId
}) => {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [medications, setMedications] = useState<Medication[]>([
        { name: '', dosage: '', instructions: '' }
    ]);

    const addMedication = () => {
        setMedications([...medications, { name: '', dosage: '', instructions: '' }]);
    };

    const removeMedication = (index: number) => {
        if (medications.length === 1) return;
        setMedications(medications.filter((_, i) => i !== index));
    };

    const updateMedication = (index: number, field: keyof Medication, value: string) => {
        const newMeds = [...medications];
        newMeds[index][field] = value;
        setMedications(newMeds);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // Filter out empty medications
        const validMeds = medications.filter(m => m.name.trim() !== '');
        if (validMeds.length === 0) {
            showToast('error', 'Adicione pelo menos um medicamento.');
            return;
        }

        setLoading(true);

        try {
            // Get current member/tenant context
            const { data: memberData } = await supabase
                .from('members')
                .select('user_id, tenant_id')
                .limit(1)
                .single();

            if (!memberData) throw new Error("Sessão não encontrada.");

            const { error } = await supabase
                .from('prescriptions')
                .insert([{
                    patient_id: patientId,
                    tenant_id: memberData.tenant_id,
                    content_json: { medications: validMeds },
                    // medical_record_id: null // Independent prescription
                }]);

            if (error) throw error;

            showToast('success', 'Receita emitida com sucesso!');
            onSuccess();
            onClose();
            setMedications([{ name: '', dosage: '', instructions: '' }]);

        } catch (error: any) {
            console.error('Error adding prescription:', error);
            showToast('error', 'Erro ao emitir receita: ' + error.message);
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
                <div className="bg-white pointer-events-auto w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden border border-white/20 flex flex-col max-h-[90vh]">
                    {/* Header */}
                    <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50">
                        <div>
                            <h3 className="text-xl font-black text-graphite-900 tracking-tight flex items-center gap-2">
                                <ClipboardList className="text-brand-primary" size={24} />
                                Nova Receita Médica
                            </h3>
                            <p className="text-sm text-graphite-400 font-medium">Prescreva medicamentos e orientações</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-10 h-10 rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 hover:text-brand-primary hover:border-brand-primary/30 transition-all cursor-pointer"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Body */}
                    <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 space-y-6 no-scrollbar">
                        <div className="space-y-4">
                            {medications.map((med, index) => (
                                <div key={index} className="p-5 rounded-2xl bg-ice-50 border border-ice-100 relative group animate-in fade-in slide-in-from-top-2 duration-300">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="md:col-span-2">
                                            <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1 block">Nome do Medicamento</label>
                                            <div className="relative">
                                                <Pill className="absolute left-3 top-1/2 -translate-y-1/2 text-ice-300" size={16} />
                                                <input
                                                    required={index === 0}
                                                    type="text"
                                                    value={med.name}
                                                    onChange={e => updateMedication(index, 'name', e.target.value)}
                                                    placeholder="Ex: Amoxicilina 500mg"
                                                    className="w-full bg-white border border-ice-200 rounded-xl py-2.5 pl-10 pr-4 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all h-11"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1 block">Posologia / Dose</label>
                                            <input
                                                type="text"
                                                value={med.dosage}
                                                onChange={e => updateMedication(index, 'dosage', e.target.value)}
                                                placeholder="Ex: 1 comprimido"
                                                className="w-full bg-white border border-ice-200 rounded-xl px-4 py-2.5 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all h-11"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1 block">Frequência / Instruções</label>
                                            <input
                                                type="text"
                                                value={med.instructions}
                                                onChange={e => updateMedication(index, 'instructions', e.target.value)}
                                                placeholder="Ex: 8 em 8 horas por 7 dias"
                                                className="w-full bg-white border border-ice-200 rounded-xl px-4 py-2.5 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all h-11"
                                            />
                                        </div>
                                    </div>
                                    
                                    {medications.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeMedication(index)}
                                            className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-white border border-ice-200 text-graphite-300 hover:text-accent-error hover:border-accent-error/30 transition-all flex items-center justify-center shadow-sm cursor-pointer"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        <button
                            type="button"
                            onClick={addMedication}
                            className="w-full py-4 border-2 border-dashed border-ice-200 rounded-2xl text-sm font-black text-graphite-400 hover:border-brand-primary/40 hover:text-brand-primary hover:bg-brand-primary/5 transition-all flex items-center justify-center gap-2 cursor-pointer group"
                        >
                            <Plus size={18} className="group-hover:scale-110 transition-transform" />
                            ADICIONAR OUTRO MEDICAMENTO
                        </button>
                    </form>

                    {/* Footer */}
                    <div className="p-8 border-t border-ice-100 bg-ice-50/30 flex gap-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-4 rounded-2xl font-bold text-graphite-700 hover:bg-white border border-ice-200 transition-all cursor-pointer"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading}
                            className="flex-[2] bg-brand-primary text-white py-4 rounded-2xl font-black shadow-xl shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed border-none cursor-pointer"
                        >
                            {loading ? 'Emitindo...' : (<><Save size={18} /><span>EMITIR RECEITA</span></>)}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};
