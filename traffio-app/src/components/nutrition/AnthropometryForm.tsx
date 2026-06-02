import React, { useState, useEffect } from 'react';
import { Apple, Scale, Ruler, Save, Calculator } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useTenant } from '../../contexts/TenantContext';
import { nutritionService } from '../../services/nutritionService';

interface AnthropometryFormProps {
    patientId: string;
    onSuccess?: () => void;
    initialData?: any;
}

export const AnthropometryForm = ({ patientId, onSuccess, initialData }: AnthropometryFormProps) => {
    const { showToast } = useToast();
    const { tenant } = useTenant();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        weight: initialData?.weight || '',
        height: initialData?.height || '',
        body_fat_pct: initialData?.body_fat_pct || '',
        waist_circ: initialData?.waist_circ || '',
        hip_circ: initialData?.hip_circ || '',
        notes: initialData?.notes || ''
    });

    const [bmi, setBmi] = useState<number | null>(null);

    useEffect(() => {
        if (formData.weight && formData.height) {
            const h = Number(formData.height) / 100;
            const w = Number(formData.weight);
            const calculatedBmi = w / (h * h);
            setBmi(Number(calculatedBmi.toFixed(1)));
        } else {
            setBmi(null);
        }
    }, [formData.weight, formData.height]);

    const handleSave = async () => {
        if (!patientId) {
            showToast('error', 'Paciente não selecionado');
            return;
        }

        try {
            setLoading(true);
            const { error } = await nutritionService.saveEvaluation({
                tenant_id: tenant?.id || '',
                patient_id: patientId,
                weight: Number(formData.weight),
                height: Number(formData.height),
                bmi: bmi || 0,
                body_fat_pct: Number(formData.body_fat_pct),
                waist_circ: Number(formData.waist_circ),
                hip_circ: Number(formData.hip_circ),
                notes: formData.notes
            });

            if (error) throw error;

            showToast('success', 'Avaliação salva com sucesso!');
            if (onSuccess) onSuccess();
        } catch (error: any) {
            showToast('error', 'Erro ao salvar: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const getBmiCategory = (val: number) => {
        if (val < 18.5) return { label: 'Abaixo do peso', color: 'text-amber-500' };
        if (val < 25) return { label: 'Peso normal', color: 'text-emerald-500' };
        if (val < 30) return { label: 'Sobrepeso', color: 'text-amber-500' };
        return { label: 'Obesidade', color: 'text-rose-500' };
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <Apple size={24} />
                </div>
                <div>
                    <h3 className="text-lg font-black text-graphite-900">Nova Avaliação</h3>
                    <p className="text-xs text-graphite-400">Registre as medidas atuais do paciente</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Core Stats */}
                <div className="bg-white p-6 rounded-3xl border border-ice-200 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Scale size={18} className="text-indigo-600" />
                        <h4 className="font-black text-xs text-graphite-900 uppercase tracking-widest">Peso & Altura</h4>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-graphite-400 uppercase">Peso (kg)</label>
                        <input 
                            name="weight"
                            type="number" 
                            step="0.1"
                            value={formData.weight}
                            onChange={handleChange}
                            placeholder="70.5"
                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 focus:border-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-graphite-400 uppercase">Altura (cm)</label>
                        <input 
                            name="height"
                            type="number" 
                            value={formData.height}
                            onChange={handleChange}
                            placeholder="175"
                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 focus:border-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>

                {/* Body Composition */}
                <div className="bg-white p-6 rounded-3xl border border-ice-200 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Ruler size={18} className="text-rose-500" />
                        <h4 className="font-black text-xs text-graphite-900 uppercase tracking-widest">Composição</h4>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-graphite-400 uppercase">Gordura Corporal (%)</label>
                        <input 
                            name="body_fat_pct"
                            type="number" 
                            step="0.1"
                            value={formData.body_fat_pct}
                            onChange={handleChange}
                            placeholder="18.5"
                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 focus:border-rose-500 outline-none transition-all"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-graphite-400 uppercase">Cintura (cm)</label>
                        <input 
                            name="waist_circ"
                            type="number" 
                            value={formData.waist_circ}
                            onChange={handleChange}
                            placeholder="80"
                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 focus:border-rose-500 outline-none transition-all"
                        />
                    </div>
                </div>

                {/* BMI Result (Auto) */}
                <div className="bg-indigo-600 p-6 rounded-3xl shadow-xl shadow-indigo-600/20 flex flex-col justify-between text-white">
                    <div className="flex items-center justify-between">
                        <h4 className="font-black text-[10px] uppercase tracking-widest opacity-80">Cálculo de IMC</h4>
                        <Calculator size={20} />
                    </div>
                    
                    {bmi ? (
                        <div className="py-2">
                            <p className="text-4xl font-black">{bmi}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wider mt-1 opacity-90">
                                {getBmiCategory(bmi).label}
                            </p>
                        </div>
                    ) : (
                        <p className="text-xs font-bold opacity-70">Preencha peso e altura para calcular</p>
                    )}

                    <div className="pt-2 border-t border-white/10 mt-2">
                        <div className="h-1.5 w-full bg-white/20 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-white transition-all duration-500" 
                                style={{ width: bmi ? `${Math.min((bmi / 40) * 100, 100)}%` : '0%' }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-ice-200 shadow-sm">
                <label className="text-[10px] font-black text-graphite-400 uppercase mb-2 block">Observações Clínicas</label>
                <textarea 
                    name="notes"
                    value={formData.notes}
                    onChange={handleChange}
                    className="w-full bg-ice-50 border border-ice-200 rounded-2xl px-4 py-4 text-sm font-medium text-graphite-900 focus:border-indigo-500 outline-none transition-all min-h-[100px]"
                    placeholder="Evolução do paciente, dificuldades na dieta, etc..."
                />
            </div>

            <div className="flex justify-end">
                <button 
                    disabled={loading}
                    onClick={handleSave}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 hover:scale-[1.02] transition-all shadow-lg shadow-indigo-600/25 border-none cursor-pointer disabled:opacity-50"
                >
                    <Save size={16} />
                    {loading ? 'Salvando...' : 'Salvar Avaliação'}
                </button>
            </div>
        </div>
    );
};
