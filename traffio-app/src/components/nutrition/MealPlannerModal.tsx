import React, { useState, useEffect } from 'react';
import { X, Sparkles, Clock, Weight, Settings, ArrowLeft, Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { nutritionService } from '../../services/nutritionService';
import type { MealPlan } from '../../services/nutritionService';
import { useToast } from '../../contexts/ToastContext';
import { useTenant } from '../../contexts/TenantContext';

interface MealPlannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    patientId?: string;
    patientName?: string;
}

type ModalMode = 'menu' | 'ai' | 'manual';

export const MealPlannerModal: React.FC<MealPlannerModalProps> = ({ isOpen, onClose, patientId, patientName }) => {
    const { t } = useTranslation('medical');
    const { showToast } = useToast();
    const { tenant } = useTenant();
    const [mode, setMode] = useState<ModalMode>('menu');
    const [loading, setLoading] = useState(false);
    const [apiKey, setApiKey] = useState(localStorage.getItem('traffio_llm_key') || '');
    const [showSettings, setShowSettings] = useState(false);

    // Manual Flow State
    const [manualPlan, setManualPlan] = useState<any[]>([
        { period: t('nutritionModals.mealPlanner.defaultPeriods.breakfast'), foods: '' },
        { period: t('nutritionModals.mealPlanner.defaultPeriods.lunch'), foods: '' },
        { period: t('nutritionModals.mealPlanner.defaultPeriods.dinner'), foods: '' }
    ]);

    useEffect(() => {
        if (!isOpen) {
            setMode('menu');
            setShowSettings(false);
        }
    }, [isOpen]);

    const handleSaveApiKey = () => {
        localStorage.setItem('traffio_llm_key', apiKey);
        showToast('success', t('nutritionModals.mealPlanner.toasts.apiKeySaved'));
        setShowSettings(false);
    };

    const handleGenerateAI = async () => {
        if (!patientId) {
            showToast('error', t('nutritionModals.mealPlanner.toasts.patientIdMissing'));
            return;
        }

        if (!apiKey) {
            setShowSettings(true);
            showToast('warning', t('nutritionModals.mealPlanner.toasts.apiKeyRequired'));
            return;
        }

        setLoading(true);
        try {
            // Em um cenário real, aqui faríamos a chamada ao LLM usando a chave.
            // Para esta execução, simulamos a geração e persistimos no banco.
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const aiData = {
                calories_target: 2200,
                macros: { prot: '150g', carb: '200g', fat: '60g' },
                meals: manualPlan // Usando o template por agora
            };

            const newPlan: MealPlan = {
                patient_id: patientId!,
                tenant_id: tenant?.id || '',
                source: 'ai',
                plan_data: aiData
            };

            await nutritionService.saveMealPlan(newPlan);
            showToast('success', t('nutritionModals.mealPlanner.toasts.aiPlanSaved'));
            onClose();
        } catch (error: any) {
            showToast('error', t('nutritionModals.mealPlanner.toasts.aiPlanError') + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveManual = async () => {
        if (!patientId) {
            showToast('error', t('nutritionModals.mealPlanner.toasts.patientIdMissing'));
            return;
        }
        setLoading(true);
        try {
            const newPlan: MealPlan = {
                patient_id: patientId!,
                tenant_id: tenant?.id || '',
                source: 'manual',
                plan_data: { meals: manualPlan }
            };

            await nutritionService.saveMealPlan(newPlan);
            showToast('success', t('nutritionModals.mealPlanner.toasts.manualPlanSaved'));
            onClose();
        } catch (error: any) {
            showToast('error', t('nutritionModals.mealPlanner.toasts.manualPlanError') + error.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-graphite-950/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                
                {/* Header Section */}
                <div className="relative h-48 bg-gradient-to-br from-indigo-600 to-brand-primary p-12 flex flex-col justify-end text-white shrink-0">
                    <button 
                        onClick={onClose} 
                        className="absolute top-6 right-6 p-2 bg-white/20 hover:bg-white/30 rounded-xl transition-all border-none cursor-pointer text-white"
                    >
                        <X size={20} />
                    </button>
                    
                    {mode !== 'menu' && (
                        <button 
                            onClick={() => setMode('menu')}
                            className="absolute top-6 left-6 p-2 bg-white/20 hover:bg-white/30 rounded-xl transition-all border-none cursor-pointer text-white flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                        >
                            <ArrowLeft size={16} /> {t('nutritionModals.mealPlanner.back')}
                        </button>
                    )}

                    {!showSettings && mode === 'menu' && (
                        <button 
                            onClick={() => setShowSettings(!showSettings)}
                            className="absolute top-6 left-6 p-2 bg-white/20 hover:bg-white/30 rounded-xl transition-all border-none cursor-pointer text-white flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                        >
                            <Settings size={16} /> {t('nutritionModals.mealPlanner.configureAi')}
                        </button>
                    )}

                    <div className="flex items-center gap-3 mb-2">
                        <Sparkles size={24} className="text-amber-300 fill-amber-300" />
                        <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 px-2 py-1 rounded-full">{mode === 'manual' ? t('nutritionModals.mealPlanner.modeManual') : t('nutritionModals.mealPlanner.modeAi')}</span>
                    </div>
                    <h3 className="text-3xl font-black tracking-tighter">{t('nutritionModals.mealPlanner.headerTitle')}</h3>
                </div>

                <div className="p-12 overflow-y-auto custom-scrollbar">
                    {showSettings ? (
                        <div className="space-y-6 animate-in slide-in-from-left-4">
                            <h4 className="text-xl font-black text-graphite-900 tracking-tight">{t('nutritionModals.mealPlanner.settings.title')}</h4>
                            <div className="p-6 bg-amber-50 border border-amber-100 rounded-3xl text-xs text-amber-900 font-bold leading-relaxed">
                                {t('nutritionModals.mealPlanner.settings.disclaimer')}
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{t('nutritionModals.mealPlanner.settings.apiKeyLabel')}</label>
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="sk-proj-..."
                                    className="w-full bg-ice-50 border border-ice-200 rounded-2xl px-6 py-4 text-sm font-medium focus:outline-none focus:border-indigo-600 transition-all"
                                />
                            </div>
                            <button
                                onClick={handleSaveApiKey}
                                className="w-full py-5 bg-brand-primary text-white rounded-2xl font-black text-sm shadow-xl shadow-brand-primary/20 hover:scale-[1.02] transition-all border-none cursor-pointer"
                            >
                                {t('nutritionModals.mealPlanner.settings.save')}
                            </button>
                        </div>
                    ) : mode === 'menu' ? (
                        <div className="space-y-8 animate-in fade-in">
                            <div className="space-y-2">
                                <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{t('nutritionModals.mealPlanner.menu.selectedPatient')}</p>
                                <p className="text-xl font-black text-graphite-900">{patientName || t('nutritionModals.mealPlanner.menu.noPatientSelected')}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button 
                                    onClick={() => setMode('ai')}
                                    className="bg-indigo-50 hover:bg-indigo-100 p-8 rounded-[32px] border border-indigo-100 flex flex-col items-center gap-4 text-center transition-all cursor-pointer group"
                                >
                                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/10 group-hover:scale-110 transition-transform">
                                        <Sparkles size={24} className="text-indigo-600" />
                                    </div>
                                    <div>
                                        <span className="text-sm font-black text-indigo-900 uppercase">{t('nutritionModals.mealPlanner.menu.generateAi')}</span>
                                        <p className="text-[10px] font-bold text-indigo-400 mt-1">{t('nutritionModals.mealPlanner.menu.generateAiSubtitle')}</p>
                                    </div>
                                </button>
                                <button 
                                    onClick={() => setMode('manual')}
                                    className="bg-emerald-50 hover:bg-emerald-100 p-8 rounded-[32px] border border-emerald-100 flex flex-col items-center gap-4 text-center transition-all cursor-pointer group"
                                >
                                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-600/10 group-hover:scale-110 transition-transform">
                                        <Clock size={24} className="text-emerald-600" />
                                    </div>
                                    <div>
                                        <span className="text-sm font-black text-emerald-900 uppercase tracking-tight">{t('nutritionModals.mealPlanner.menu.manualFlow')}</span>
                                        <p className="text-[10px] font-bold text-emerald-400 mt-1">{t('nutritionModals.mealPlanner.menu.manualFlowSubtitle')}</p>
                                    </div>
                                </button>
                            </div>

                            <div className="p-6 bg-ice-50 border border-ice-100 rounded-3xl flex items-center gap-4">
                                <Weight size={24} className="text-graphite-400" />
                                <p className="text-xs text-graphite-600 font-bold leading-relaxed">
                                    {t('nutritionModals.mealPlanner.menu.engineHint')}
                                </p>
                            </div>
                        </div>
                    ) : mode === 'ai' ? (
                        <div className="space-y-8 animate-in slide-in-from-right-4">
                             <div className="space-y-4">
                                <h4 className="text-xl font-black text-graphite-900 tracking-tight flex items-center gap-2">
                                    <Sparkles size={24} className="text-amber-500" />
                                    {t('nutritionModals.mealPlanner.ai.title')}
                                </h4>
                                <p className="text-sm text-graphite-500 font-medium">
                                    {t('nutritionModals.mealPlanner.ai.description')}
                                </p>
                             </div>

                             <button 
                                onClick={handleGenerateAI}
                                disabled={loading}
                                className="w-full py-6 bg-indigo-600 text-white rounded-2xl font-black text-base shadow-2xl shadow-indigo-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all border-none cursor-pointer flex items-center justify-center gap-3 disabled:opacity-50"
                             >
                                {loading ? <Loader2 className="animate-spin" size={24} /> : <Sparkles size={24} />}
                                {loading ? t('nutritionModals.mealPlanner.ai.processing') : t('nutritionModals.mealPlanner.ai.submit')}
                             </button>
                        </div>
                    ) : (
                        <div className="space-y-8 animate-in slide-in-from-right-4">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xl font-black text-graphite-900 tracking-tight">{t('nutritionModals.mealPlanner.manual.title')}</h4>
                                <button
                                    onClick={() => setManualPlan([...manualPlan, { period: t('nutritionModals.mealPlanner.defaultPeriods.newMeal'), foods: '' }])}
                                    className="p-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-colors border-none cursor-pointer"
                                    title={t('nutritionModals.mealPlanner.manual.addMealTitle')}
                                >
                                    <Plus size={20} />
                                </button>
                            </div>
                            
                            <div className="space-y-4">
                                {manualPlan.map((item, idx) => (
                                    <div key={idx} className="p-6 bg-ice-50 border border-ice-100 rounded-3xl space-y-3 group/item">
                                        <div className="flex items-center justify-between">
                                            <input 
                                                value={item.period}
                                                onChange={(e) => {
                                                    const newPlan = [...manualPlan];
                                                    newPlan[idx].period = e.target.value;
                                                    setManualPlan(newPlan);
                                                }}
                                                className="bg-transparent border-none text-xs font-black text-indigo-600 uppercase tracking-widest focus:outline-none"
                                            />
                                            <button 
                                                onClick={() => setManualPlan(manualPlan.filter((_, i) => i !== idx))}
                                                className="opacity-0 group-hover/item:opacity-100 p-1 text-rose-400 hover:text-rose-600 transition-all border-none bg-transparent cursor-pointer"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                        <textarea 
                                            value={item.foods}
                                            onChange={(e) => {
                                                const newPlan = [...manualPlan];
                                                newPlan[idx].foods = e.target.value;
                                                setManualPlan(newPlan);
                                            }}
                                            placeholder={t('nutritionModals.mealPlanner.manual.foodsPlaceholder')}
                                            rows={2}
                                            className="w-full bg-transparent border-none text-sm font-medium text-graphite-900 focus:outline-none resize-none placeholder:text-graphite-300"
                                        />
                                    </div>
                                ))}
                            </div>

                            <button 
                                onClick={handleSaveManual}
                                disabled={loading}
                                className="w-full py-5 bg-emerald-600 text-white rounded-2xl font-black text-sm shadow-xl shadow-emerald-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all border-none cursor-pointer flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                                {loading ? t('nutritionModals.mealPlanner.manual.saving') : t('nutritionModals.mealPlanner.manual.save')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

