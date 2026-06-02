import React, { useState, useEffect } from 'react';
import { Save, Eraser, Info, MousePointer2 } from 'lucide-react';
import { dentalService } from '../../services/dentalService';
import type { DentalRecord } from '../../services/dentalService';
import { useToast } from '../../contexts/ToastContext';
import { useTenant } from '../../contexts/TenantContext';
import { Tooth } from './Tooth';
import type { ToothPlane } from './Tooth';

interface OdontogramProps {
    patientId?: string;
    onSuccess?: () => void;
}

export const Odontogram: React.FC<OdontogramProps> = ({ patientId, onSuccess }) => {
    const { showToast } = useToast();
    const { tenant } = useTenant();
    const [loading, setLoading] = useState(false);
    const [persistedRecords, setPersistedRecords] = useState<DentalRecord[]>([]);
    const [selectedItems, setSelectedItems] = useState<Array<{ tooth: number, plane: ToothPlane, condition: string }>>([]);
    const [activeCondition, setActiveCondition] = useState<string>('caries');

    useEffect(() => {
        if (patientId) {
            fetchRecords();
        }
    }, [patientId]);

    const fetchRecords = async () => {
        if (!patientId) return;
        try {
            const data = await dentalService.getRecords(patientId);
            setPersistedRecords(data || []);
        } catch (error) {
            console.error('Error fetching dental records:', error);
        }
    };

    const handlePlaneClick = (tooth: number, plane: ToothPlane) => {
        const isSelected = selectedItems.find(item => item.tooth === tooth && item.plane === plane);
        if (isSelected) {
            setSelectedItems(prev => prev.filter(item => !(item.tooth === tooth && item.plane === plane)));
        } else {
            setSelectedItems(prev => [...prev, { tooth, plane, condition: activeCondition }]);
        }
    };

    const handleSave = async () => {
        if (!patientId || !tenant?.id) {
            showToast('warning', 'Paciente ou clínica não identificados.');
            return;
        }

        if (selectedItems.length === 0) {
            showToast('info', 'Selecione ao menos uma face para salvar.');
            return;
        }

        setLoading(true);
        try {
            const recordsToSave: DentalRecord[] = selectedItems.map(item => ({
                patient_id: patientId,
                tenant_id: tenant.id,
                tooth_number: item.tooth,
                plane: item.plane,
                condition: item.condition
            }));

            await dentalService.saveRecords(recordsToSave);
            showToast('success', 'Mapa odontológico salvo com sucesso!');
            setSelectedItems([]);
            await fetchRecords();
            if (onSuccess) onSuccess();
        } catch (error: any) {
            console.error('Error saving dental records:', error);
            showToast('error', 'Erro ao salvar mapa: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const quadrants = {
        upperLeft: [18, 17, 16, 15, 14, 13, 12, 11],
        upperRight: [21, 22, 23, 24, 25, 26, 27, 28],
        lowerLeft: [48, 47, 46, 45, 44, 43, 42, 41],
        lowerRight: [31, 32, 33, 34, 35, 36, 37, 38],
    };

    const clearSelection = () => setSelectedItems([]);

    const getToothConditions = (toothNumber: number) => {
        const conditions: Record<string, string> = {};
        
        // Load persisted conditions first
        persistedRecords
            .filter(r => r.tooth_number === toothNumber)
            .forEach(r => {
                conditions[r.plane] = r.condition;
            });
            
        // Overlay current session selections
        selectedItems
            .filter(i => i.tooth === toothNumber)
            .forEach(i => {
                conditions[i.plane] = i.condition;
            });
            
        return conditions;
    };

    return (
        <div className="bg-white rounded-[32px] border border-ice-200 shadow-sm overflow-hidden flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Toolbar */}
            <div className="p-6 border-b border-ice-100 flex items-center justify-between bg-ice-50/30">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <MousePointer2 size={18} className="text-brand-primary" />
                        <h3 className="font-black text-graphite-900 uppercase tracking-widest text-xs">Exame Clínico</h3>
                    </div>
                    
                    {/* Condition Selector */}
                    <div className="hidden md:flex items-center gap-2 p-1 bg-white rounded-xl border border-ice-100">
                        {['caries', 'restored', 'missing'].map((condition) => (
                            <button
                                key={condition}
                                onClick={() => setActiveCondition(condition)}
                                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all border-none cursor-pointer ${activeCondition === condition 
                                    ? 'bg-brand-primary text-white shadow-md' 
                                    : 'text-graphite-400 hover:text-brand-primary'}`}
                            >
                                {condition === 'caries' ? 'Cárie' : condition === 'restored' ? 'Restaurado' : 'Ausente'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button 
                        onClick={clearSelection}
                        className="p-2 text-graphite-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all border-none cursor-pointer"
                        title="Limpar seleção"
                    >
                        <Eraser size={20} />
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={loading || selectedItems.length === 0}
                        className="flex items-center gap-2 bg-brand-primary text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-105 transition-transform border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                        <span>{loading ? 'Salvando...' : 'Salvar Mapa'}</span>
                    </button>
                </div>
            </div>

            {/* Tooth Map Container */}
            <div className="flex-1 p-8 flex flex-col items-center justify-center gap-12 overflow-x-auto min-h-[500px] custom-scrollbar">
                {/* Upper Arch */}
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-1">
                        <div className="flex items-center gap-2 bg-ice-50/50 p-4 rounded-[40px] border border-ice-100">
                            {quadrants.upperLeft.map(num => (
                                <Tooth 
                                    key={num} 
                                    number={num} 
                                    selectedPlanes={selectedItems.filter(i => i.tooth === num).map(i => i.plane)}
                                    conditions={getToothConditions(num)}
                                    onPlaneClick={handlePlaneClick}
                                />
                            ))}
                            <div className="w-px h-12 bg-ice-200 mx-2" />
                            {quadrants.upperRight.map(num => (
                                <Tooth 
                                    key={num} 
                                    number={num} 
                                    selectedPlanes={selectedItems.filter(i => i.tooth === num).map(i => i.plane)}
                                    conditions={getToothConditions(num)}
                                    onPlaneClick={handlePlaneClick}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Lower Arch */}
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-1">
                        <div className="flex items-center gap-2 bg-ice-50/50 p-4 rounded-[40px] border border-ice-100">
                            {quadrants.lowerLeft.map(num => (
                                <Tooth 
                                    key={num} 
                                    number={num} 
                                    selectedPlanes={selectedItems.filter(i => i.tooth === num).map(i => i.plane)}
                                    conditions={getToothConditions(num)}
                                    onPlaneClick={handlePlaneClick}
                                />
                            ))}
                            <div className="w-px h-12 bg-ice-200 mx-2" />
                            {quadrants.lowerRight.map(num => (
                                <Tooth 
                                    key={num} 
                                    number={num} 
                                    selectedPlanes={selectedItems.filter(i => i.tooth === num).map(i => i.plane)}
                                    conditions={getToothConditions(num)}
                                    onPlaneClick={handlePlaneClick}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Info Footer */}
            <div className="p-4 bg-ice-50/50 border-t border-ice-100 flex items-center justify-center gap-8">
                <div className="flex items-center gap-2 text-[10px] font-bold text-graphite-400">
                    <div className="w-3 h-3 rounded bg-rose-500" />
                    CÁRIE IDENTIFICADA
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-graphite-400">
                    <div className="w-3 h-3 rounded bg-emerald-500" />
                    RESTAURAÇÃO EXISTENTE
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-graphite-400">
                    <div className="w-3 h-3 rounded border border-ice-300" />
                    SAUDÁVEL / NORMAL
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-graphite-400 italic">
                    <Info size={12} className="text-brand-primary" />
                    CLIQUE NAS FACES PARA MARCAR O PROCEDIMENTO
                </div>
            </div>
        </div>
    );
};
