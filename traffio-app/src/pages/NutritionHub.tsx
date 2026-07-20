import React, { useEffect, useState, useMemo } from 'react';
import { 
    Apple, 
    TrendingUp, 
    Table,
    Plus,
    ChevronRight,
    Sparkles,
    Calendar,
    Filter,
    Activity,
    ClipboardList,
    Download
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { nutritionService } from '../services/nutritionService';
import { useToast } from '../contexts/ToastContext';
import { PatientSearchModal } from '../components/shared/PatientSearchModal';
import { NewNutritionEvaluationModal } from '../components/nutrition/NewNutritionEvaluationModal';
import { MealPlannerModal } from '../components/nutrition/MealPlannerModal';

export const NutritionHub: React.FC = () => {
    const { t } = useTranslation('medical');
    const location = useLocation();
    const { showToast } = useToast();
    const [evaluations, setEvaluations] = useState<any[]>([]);
    const [timeline, setTimeline] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [timelineLoading, setTimelineLoading] = useState(false);

    // Modal states
    const [isEvalOpen, setIsEvalOpen] = useState(false);
    const [isMealOpen, setIsMealOpen] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    
    // Selection state
    const [selectedPatient, setSelectedPatient] = useState<any>(null);
    const [pendingAction, setPendingAction] = useState<'eval' | 'meal' | null>(null);

    useEffect(() => {
        if (location.pathname.endsWith('/nutrition-plan')) {
            handleActionRequest('meal');
        }
    }, [location.pathname]);

    useEffect(() => {
        const fetchHubData = async () => {
            try {
                setLoading(true);
                const data = await nutritionService.getAllEvaluations();
                setEvaluations(data || []);
            } catch (error: any) {
                showToast('error', t('nutritionHub.toasts.loadError') + error.message);
            } finally {
                setLoading(false);
            }
        };
        fetchHubData();
    }, []);

    useEffect(() => {
        if (selectedPatient?.id) {
            fetchTimeline(selectedPatient.id);
        }
    }, [selectedPatient]);

    const fetchTimeline = async (patientId: string) => {
        try {
            setTimelineLoading(true);
            const data = await nutritionService.getPatientTimeline(patientId);
            setTimeline(data);
        } catch (error: any) {
            showToast('error', t('nutritionHub.toasts.timelineLoadError') + error.message);
        } finally {
            setTimelineLoading(false);
        }
    };

    const handleActionRequest = (action: 'eval' | 'meal') => {
        setPendingAction(action);
        setIsSearchOpen(true);
    };

    const stats = useMemo(() => {
        const totalWeightLoss = evaluations.length > 1 
            ? Math.abs(evaluations[0].weight - evaluations[evaluations.length - 1].weight)
            : 0;
            
        const avgBmi = evaluations.length > 0
            ? (evaluations.reduce((acc, curr) => acc + (curr.bmi || 0), 0) / evaluations.length).toFixed(1)
            : '0';

        return [
            { label: t('nutritionHub.stats.aiPlanner'), value: t('nutritionHub.stats.aiPlannerValue'), icon: Sparkles, color: 'text-brand-primary', bg: 'bg-brand-primary/10', onClick: () => handleActionRequest('meal') },
            { label: t('nutritionHub.stats.weightLoss'), value: `${totalWeightLoss.toFixed(1)}kg`, icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: t('nutritionHub.stats.avgBmi'), value: avgBmi, icon: Apple, color: 'text-amber-600', bg: 'bg-amber-50' },
        ];
    }, [evaluations, t]);

    if (loading) return <div className="p-8 text-center font-bold text-graphite-400 uppercase tracking-widest animate-pulse">{t('nutritionHub.loading')}</div>;

    return (
        <div className="space-y-8 pb-12">
            {/* Super Header */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-1">
                    <h2 className="text-4xl font-black text-graphite-900 tracking-tighter">{t('nutritionHub.titlePrefix')}<span className="text-brand-primary">{t('nutritionHub.titleHighlight')}</span></h2>
                    <p className="text-graphite-400 font-medium italic">{t('nutritionHub.subtitle')}</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => handleActionRequest('meal')}
                        className="px-6 py-3 bg-white border border-ice-200 text-graphite-900 rounded-2xl text-sm font-bold shadow-sm hover:bg-ice-50 transition-all border-none cursor-pointer flex items-center gap-2"
                    >
                        <Table size={18} className="text-brand-primary" />
                        {t('nutritionHub.mealPlannerButton')}
                    </button>
                    <button
                        onClick={() => handleActionRequest('eval')}
                        className="px-6 py-3 bg-brand-primary text-white rounded-2xl text-sm font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] transition-all border-none cursor-pointer flex items-center gap-2"
                    >
                        <Plus size={18} />
                        {t('nutritionHub.newEvaluation')}
                    </button>
                </div>
            </header>

            {/* 3-Column Super Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* Column 1: Patient Profile & Quick Analytics (4 cols) */}
                <div className="lg:col-span-3 space-y-6">
                    <div className="glass p-6 rounded-[32px] border-none shadow-xl shadow-ice-100/50 space-y-6">
                        <div className="text-center space-y-4">
                            <div className="w-24 h-24 bg-gradient-to-br from-brand-primary to-indigo-600 rounded-[32px] mx-auto flex items-center justify-center text-white text-3xl font-black shadow-lg">
                                {selectedPatient ? selectedPatient.full_name?.charAt(0) : <Activity size={32} />}
                            </div>
                            <div>
                                <h4 className="font-black text-graphite-900 text-lg leading-tight">
                                    {selectedPatient ? selectedPatient.full_name : t('nutritionHub.patientCard.selectPatient')}
                                </h4>
                                <p className="text-[10px] font-bold text-graphite-400 uppercase tracking-widest mt-1">
                                    {selectedPatient ? t('nutritionHub.patientCard.idPrefix', { id: selectedPatient.id.slice(0, 8) }) : t('nutritionHub.patientCard.waitingSelection')}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            {stats.map((stat: any, i: number) => (
                                <div key={i} className={`p-4 rounded-3xl ${stat.bg} ${stat.color} flex flex-col items-center justify-center text-center space-y-1 cursor-pointer hover:scale-105 transition-all`} onClick={stat.onClick}>
                                    <stat.icon size={18} />
                                    <span className="text-[10px] font-black uppercase opacity-70 tracking-tighter">{stat.label}</span>
                                    <span className="text-sm font-black tracking-tight">{stat.value}</span>
                                </div>
                            ))}
                        </div>

                        <button
                            onClick={() => setIsSearchOpen(true)}
                            className="w-full py-4 glass border border-ice-200 rounded-2xl text-xs font-black text-graphite-600 hover:bg-ice-50 transition-all border-none cursor-pointer"
                        >
                            {t('nutritionHub.patientCard.changePatient')}
                        </button>
                    </div>

                    {/* Quick Analytics Card */}
                    <div className="glass p-6 rounded-[32px] bg-ice-50/50 border-ice-100 space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{t('nutritionHub.weightEvolution.title')}</p>
                            <TrendingUp size={14} className="text-emerald-500" />
                        </div>
                        <div className="h-24 w-full flex items-end gap-1 px-1">
                            {[40, 60, 45, 80, 55, 70, 90].map((h, i) => (
                                <div key={i} className="flex-1 bg-brand-primary/20 rounded-t-lg hover:bg-brand-primary transition-all relative group" style={{ height: `${h}%` }}>
                                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-graphite-900 text-white text-[8px] font-bold px-1 rounded opacity-0 group-hover:opacity-100 transition-all">
                                        {h}kg
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="text-[9px] text-graphite-400 font-medium text-center italic">{t('nutritionHub.weightEvolution.subtitle')}</p>
                    </div>
                </div>

                {/* Column 2: Unified Metabolic Timeline (6 cols) */}
                <div className="lg:col-span-6 space-y-6">
                    <div className="flex items-center justify-between px-2">
                        <h4 className="text-xl font-black text-graphite-900 tracking-tight flex items-center gap-2">
                            <ClipboardList className="text-brand-primary" size={20} />
                            {t('nutritionHub.timeline.title')}
                        </h4>
                        <div className="flex gap-2">
                            <button className="p-2 bg-white rounded-xl border border-ice-200 text-graphite-400 hover:text-brand-primary transition-all border-none cursor-pointer"><Filter size={16} /></button>
                            <button className="p-2 bg-white rounded-xl border border-ice-200 text-graphite-400 hover:text-brand-primary transition-all border-none cursor-pointer"><Calendar size={16} /></button>
                        </div>
                    </div>

                    <div className="relative space-y-4 before:absolute before:left-6 before:top-2 before:bottom-2 before:w-0.5 before:bg-ice-200">
                        {timelineLoading ? (
                            <div className="py-20 text-center space-y-4">
                                <div className="w-10 h-10 border-4 border-brand-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
                                <p className="text-xs font-black text-graphite-400 uppercase tracking-widest">{t('nutritionHub.timeline.syncing')}</p>
                            </div>
                        ) : timeline.length > 0 ? (
                            timeline.map((item, i) => (
                                <motion.div 
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.1 }}
                                    key={item.id} 
                                    className="relative pl-14"
                                >
                                    <div className={`absolute left-4 top-1 w-4 h-4 rounded-full border-4 border-white shadow-sm z-10 ${item.type === 'evaluation' ? 'bg-brand-primary' : 'bg-amber-500'}`} />
                                    
                                    <div className="glass p-5 rounded-[24px] border-none shadow-lg shadow-ice-100/50 hover:scale-[1.01] transition-all cursor-pointer group">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg ${item.type === 'evaluation' ? 'bg-brand-primary/10 text-brand-primary' : 'bg-amber-100 text-amber-600'}`}>
                                                    {item.type === 'evaluation' ? t('nutritionHub.timeline.evaluationType') : t('nutritionHub.timeline.mealPlanType')}
                                                </span>
                                                <h5 className="font-black text-graphite-900 mt-2">
                                                    {item.type === 'evaluation' ? t('nutritionHub.timeline.checkinPrefix', { weight: item.weight }) : (item.source === 'ai' ? t('nutritionHub.timeline.dietAiPrefix') : t('nutritionHub.timeline.dietManualPrefix'))}
                                                </h5>
                                            </div>
                                            <span className="text-[10px] font-bold text-graphite-400">{new Date(item.created_at).toLocaleDateString()}</span>
                                        </div>
                                        
                                        <div className="flex items-center justify-between text-xs font-medium text-graphite-600 italic">
                                            {item.type === 'evaluation' ? (
                                                <p>{t('nutritionHub.timeline.evaluationSummary', { bmi: item.bmi, fat: item.body_fat_pct || '--', waist: item.waist_circ || '--' })}</p>
                                            ) : (
                                                <p>{t('nutritionHub.timeline.mealsCount', { count: Object.keys(item.plan_data?.meals || {}).length })}</p>
                                            )}
                                            <ChevronRight size={14} className="text-graphite-300 group-hover:text-brand-primary group-hover:translate-x-1 transition-all" />
                                        </div>
                                    </div>
                                </motion.div>
                            ))
                        ) : (
                            <div className="glass p-12 rounded-[32px] text-center space-y-4 border-dashed border-2 border-ice-200">
                                <Activity size={40} className="mx-auto text-ice-300" />
                                <div>
                                    <p className="text-sm font-black text-graphite-900">{t('nutritionHub.timeline.emptyTitle')}</p>
                                    <p className="text-xs text-graphite-400 font-medium">{t('nutritionHub.timeline.emptySubtitle')}</p>
                                </div>
                                <button className="px-6 py-2 bg-ice-50 text-brand-primary rounded-xl text-xs font-bold border-none cursor-pointer hover:bg-ice-100" onClick={() => handleActionRequest('eval')}>{t('nutritionHub.timeline.emptyAction')}</button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Column 3: AI Engine & Quick Tools (3 cols) */}
                <div className="lg:col-span-3 space-y-6">
                    <h4 className="text-xl font-black tracking-tight text-graphite-900">{t('nutritionHub.aiEngine.titlePrefix')}<span className="text-brand-primary">{t('nutritionHub.aiEngine.titleHighlight')}</span></h4>
                    
                    {/* IA Engine Card */}
                    <div className="bg-gradient-to-br from-indigo-600 to-brand-primary rounded-[32px] p-6 text-white space-y-6 relative overflow-hidden group shadow-xl shadow-indigo-200/50 transition-all hover:scale-[1.02]">
                        <div className="relative z-10 space-y-4">
                            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20">
                                <Sparkles size={24} />
                            </div>
                            <h5 className="text-lg font-black leading-tight">{t('nutritionHub.aiEngine.cardTitleLine1')} <br/>{t('nutritionHub.aiEngine.cardTitleLine2')}</h5>
                            <p className="text-[10px] text-white/70 font-medium leading-relaxed uppercase tracking-wider font-black">
                                {selectedPatient ? selectedPatient.full_name : t('nutritionHub.patientCard.selectPatient')}
                            </p>
                            <button
                                onClick={() => handleActionRequest('meal')}
                                className="w-full py-4 bg-white text-indigo-600 rounded-2xl font-black text-sm hover:translate-y-[-2px] transition-all border-none cursor-pointer flex items-center justify-center gap-2"
                            >
                                {t('nutritionHub.aiEngine.startGenerator')}
                            </button>
                        </div>
                        <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white opacity-10 rounded-full group-hover:scale-110 transition-transform duration-700"></div>
                    </div>

                    {/* Quick Tools */}
                    <div className="glass p-6 rounded-[32px] border-ice-100 space-y-4 shadow-xl shadow-ice-100/50">
                        <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest border-b border-ice-100 pb-2">{t('nutritionHub.quickTools.title')}</p>
                        <ul className="space-y-3">
                            <li className="flex items-center gap-3 text-xs font-bold text-graphite-600 hover:text-brand-primary cursor-pointer transition-all">
                                <div className="w-8 h-8 rounded-lg bg-ice-50 flex items-center justify-center"><Download size={14} /></div>
                                {t('nutritionHub.quickTools.exportPdf')}
                            </li>
                            <li className="flex items-center gap-3 text-xs font-bold text-graphite-600 hover:text-brand-primary cursor-pointer transition-all">
                                <div className="w-8 h-8 rounded-lg bg-ice-50 flex items-center justify-center"><Apple size={14} /></div>
                                {t('nutritionHub.quickTools.supplementation')}
                            </li>
                            <li className="flex items-center gap-3 text-xs font-bold text-graphite-600 hover:text-brand-primary cursor-pointer transition-all">
                                <div className="w-8 h-8 rounded-lg bg-ice-50 flex items-center justify-center"><ClipboardList size={14} /></div>
                                {t('nutritionHub.quickTools.whatsappSummary')}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Feature Modals */}
            <PatientSearchModal 
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                title={pendingAction === 'eval' ? t('nutritionHub.searchModal.evalTitle') : t('nutritionHub.searchModal.mealTitle')}
                specialty="nutrition"
                onSelect={(patient) => {
                    setSelectedPatient(patient);
                    setIsSearchOpen(false);
                    if (pendingAction === 'eval') setIsEvalOpen(true);
                    else if (pendingAction === 'meal') setIsMealOpen(true);
                }}
            />

            <NewNutritionEvaluationModal 
                isOpen={isEvalOpen}
                onClose={() => {
                    setIsEvalOpen(false);
                    if (selectedPatient) fetchTimeline(selectedPatient.id);
                }}
                patientId={selectedPatient?.id}
                patientName={selectedPatient?.full_name}
            />

            <MealPlannerModal 
                isOpen={isMealOpen}
                onClose={() => {
                    setIsMealOpen(false);
                    if (selectedPatient) fetchTimeline(selectedPatient.id);
                }}
                patientId={selectedPatient?.id}
                patientName={selectedPatient?.full_name}
            />
        </div>
    );
};
