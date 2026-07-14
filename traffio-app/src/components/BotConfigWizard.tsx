import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Zap,
    Target,
    Calendar,
    RefreshCw,
    Users,
    Bot,
    Heart,
    Briefcase,
    Save,
    Loader2,
    X,
    ChevronLeft,
    ChevronRight,
    Check,
    AlertCircle
} from 'lucide-react';
import type { BotConfig } from '../pages/Intelligence';

interface BotConfigWizardProps {
    isOpen: boolean;
    onClose: () => void;
    currentConfig: BotConfig;
    onSave: (newConfig: BotConfig) => Promise<void>;
    saving: boolean;
}

interface WizardDraft {
    objective: 'lead_capture' | 'agenda_management' | 'hybrid' | null;
    has_commercial_team: boolean | null;
    personality: 'acolhedor' | 'formal' | 'eficiente' | null;
}

type WizardStep = 1 | 2 | 3 | 4;

export const BotConfigWizard = ({ isOpen, onClose, currentConfig, onSave, saving }: BotConfigWizardProps) => {
    const { t } = useTranslation('automations');
    const [step, setStep] = useState<WizardStep>(1);
    const [draft, setDraft] = useState<WizardDraft>({
        objective: currentConfig.objective || null,
        has_commercial_team: currentConfig.has_commercial_team ?? null,
        personality: (currentConfig.personality as any) || 'acolhedor'
    });

    if (!isOpen) return null;

    const getNextStep = (current: WizardStep): WizardStep => {
        if (current === 1) {
            return draft.objective === 'agenda_management' ? 3 : 2;
        }
        return (current + 1) as WizardStep;
    };

    const getPrevStep = (current: WizardStep): WizardStep => {
        if (current === 3 && draft.objective === 'agenda_management') return 1;
        return (current - 1) as WizardStep;
    };

    function generateConfigFromWizard(draft: WizardDraft, base: BotConfig): BotConfig {
        const next = { ...base };

        // Objetivo e modo
        next.objective             = draft.objective!;
        next.has_commercial_team   = draft.has_commercial_team ?? false;
        next.personality           = draft.personality ?? 'acolhedor';

        // Modo por tipo de paciente
        if (draft.objective === 'hybrid') {
            next.new_patient_mode      = 'lead_capture';
            next.returning_patient_mode = 'agenda_management';
        } else if (draft.objective === 'lead_capture') {
            next.new_patient_mode      = 'lead_capture';
            next.returning_patient_mode = 'lead_capture';
        } else {
            next.new_patient_mode      = 'agenda_management';
            next.returning_patient_mode = 'agenda_management';
        }

        // Modo de fechamento e follow-up
        const isSales = draft.objective !== 'agenda_management';
        next.closing_mode             = isSales && !draft.has_commercial_team ? 'autonomous_closer' : 'warm_handoff';
        next.follow_up_enabled        = isSales;
        next.follow_up_sequence_hours = isSales ? [7, 60, 360, 1440, 10080] : [];
        next.no_show_prevention       = true;
        next.nps_enabled              = true;
        next.human_handoff_policy     = !isSales
            ? 'always_available'
            : draft.has_commercial_team
                ? 'after_qualification'
                : 'last_resort_only';

        // Identidade do agente
        const roleMap = {
            lead_capture:       t('botConfigWizard.roleMap.leadCapture'),
            agenda_management:  t('botConfigWizard.roleMap.agendaManagement'),
            hybrid:             t('botConfigWizard.roleMap.hybrid'),
        };
        next.identity = { name: base.identity.name || 'Amanda', role: roleMap[draft.objective!] };

        // Regras e workflow gerados automaticamente por objetivo
        if (isSales) {
            next.strict_rules = [
                t('botConfigWizard.strictRulesSales.neverCloseWithoutNextStep'),
                t('botConfigWizard.strictRulesSales.alwaysOfferAlternative'),
                draft.has_commercial_team
                    ? t('botConfigWizard.strictRulesSales.transferAfterQualification')
                    : t('botConfigWizard.strictRulesSales.closeAutonomously'),
                t('botConfigWizard.strictRulesSales.neverMentionSlotTypes'),
            ];
            next.workflow = [
                t('botConfigWizard.workflowSales.respondWithSlot'),
                t('botConfigWizard.workflowSales.qualify'),
                t('botConfigWizard.workflowSales.presentBenefits'),
                t('botConfigWizard.workflowSales.proposeSpecificTime'),
                draft.has_commercial_team
                    ? t('botConfigWizard.workflowSales.transferToHuman')
                    : t('botConfigWizard.workflowSales.closeAndConfirm'),
            ];
        } else {
            next.strict_rules = [
                t('botConfigWizard.strictRulesAgenda.neverScheduleWithoutValidating'),
                t('botConfigWizard.strictRulesAgenda.verifyIdentity'),
                t('botConfigWizard.strictRulesAgenda.alwaysWelcoming'),
            ];
            next.workflow = [
                t('botConfigWizard.workflowAgenda.greetByName'),
                t('botConfigWizard.workflowAgenda.understandNeed'),
                t('botConfigWizard.workflowAgenda.findAvailability'),
                t('botConfigWizard.workflowAgenda.confirmAndConclude'),
            ];
        }

        next.onboarding_completed = true;
        return next;
    }

    const handleNext = () => setStep(getNextStep(step));
    const handleBack = () => setStep(getPrevStep(step));
    const handleSave = () => {
        const finalConfig = generateConfigFromWizard(draft, currentConfig);
        onSave(finalConfig);
    };

    const isNextDisabled = () => {
        if (step === 1) return !draft.objective;
        if (step === 2) return draft.has_commercial_team === null;
        if (step === 3) return !draft.personality;
        return false;
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-6">
            <div className="absolute inset-0 bg-graphite-900/60 backdrop-blur-md animate-in fade-in duration-300" onClick={onClose} />
            
            <div className="relative w-full max-w-2xl bg-white rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-8 duration-500">
                {/* Header Context */}
                <div className="p-8 pb-0 flex items-center justify-between">
                    <button onClick={onClose} className="p-2 hover:bg-ice-100 rounded-full transition-colors border-none bg-transparent cursor-pointer">
                        <X size={20} className="text-graphite-400" />
                    </button>
                    
                    <div className="flex gap-2">
                        {[1, 2, 3, 4].map(s => (
                            <div 
                                key={s}
                                className={`h-1.5 rounded-full transition-all duration-500 ${
                                    step === s ? 'w-8 bg-brand-primary' : 
                                    step > s ? 'w-4 bg-brand-primary/40' : 'w-4 bg-ice-200'
                                }`}
                            />
                        ))}
                    </div>
                    <div className="w-8" /> {/* Spacer for balance */}
                </div>

                <div className="p-8">
                    {/* Step Content */}
                    <div className="min-h-[380px]">
                        {step === 1 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                                <h2 className="text-2xl font-black text-graphite-900 mb-2">{t('botConfigWizard.step1.title')}</h2>
                                <p className="text-graphite-400 text-sm mb-8">{t('botConfigWizard.step1.subtitle')}</p>

                                <div className="grid grid-cols-1 gap-4">
                                    <button
                                        onClick={() => setDraft({...draft, objective: 'hybrid'})}
                                        className={`relative p-5 rounded-2xl border-2 text-left transition-all ${
                                            draft.objective === 'hybrid' ? 'border-brand-primary bg-brand-primary/5' : 'border-ice-100 hover:border-ice-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`p-3 rounded-xl ${draft.objective === 'hybrid' ? 'bg-brand-primary text-white' : 'bg-ice-100 text-graphite-400'}`}>
                                                <RefreshCw size={24} />
                                            </div>
                                            <div>
                                                <p className="font-black text-graphite-900">{t('botConfigWizard.step1.hybridTitle')}</p>
                                                <p className="text-xs text-graphite-400 mt-1">{t('botConfigWizard.step1.hybridDescription')}</p>
                                            </div>
                                            <span className="absolute top-4 right-4 bg-emerald-100 text-emerald-600 text-[10px] font-black uppercase px-2 py-0.5 rounded-md">{t('botConfigWizard.step1.mostUsedBadge')}</span>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => setDraft({...draft, objective: 'lead_capture'})}
                                        className={`p-5 rounded-2xl border-2 text-left transition-all ${
                                            draft.objective === 'lead_capture' ? 'border-brand-primary bg-brand-primary/5' : 'border-ice-100 hover:border-ice-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`p-3 rounded-xl ${draft.objective === 'lead_capture' ? 'bg-brand-primary text-white' : 'bg-ice-100 text-graphite-400'}`}>
                                                <Target size={24} />
                                            </div>
                                            <div>
                                                <p className="font-black text-graphite-900">{t('botConfigWizard.step1.leadCaptureTitle')}</p>
                                                <p className="text-xs text-graphite-400 mt-1">{t('botConfigWizard.step1.leadCaptureDescription')}</p>
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => setDraft({...draft, objective: 'agenda_management'})}
                                        className={`p-5 rounded-2xl border-2 text-left transition-all ${
                                            draft.objective === 'agenda_management' ? 'border-brand-primary bg-brand-primary/5' : 'border-ice-100 hover:border-ice-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`p-3 rounded-xl ${draft.objective === 'agenda_management' ? 'bg-brand-primary text-white' : 'bg-ice-100 text-graphite-400'}`}>
                                                <Calendar size={24} />
                                            </div>
                                            <div>
                                                <p className="font-black text-graphite-900">{t('botConfigWizard.step1.agendaTitle')}</p>
                                                <p className="text-xs text-graphite-400 mt-1">{t('botConfigWizard.step1.agendaDescription')}</p>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                                <h2 className="text-2xl font-black text-graphite-900 mb-2">{t('botConfigWizard.step2.title')}</h2>
                                <p className="text-graphite-400 text-sm mb-8">{t('botConfigWizard.step2.subtitle')}</p>

                                <div className="grid grid-cols-1 gap-4">
                                    <button
                                        onClick={() => setDraft({...draft, has_commercial_team: true})}
                                        className={`p-5 rounded-2xl border-2 text-left transition-all ${
                                            draft.has_commercial_team === true ? 'border-brand-primary bg-brand-primary/5' : 'border-ice-100 hover:border-ice-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`p-3 rounded-xl ${draft.has_commercial_team === true ? 'bg-brand-primary text-white' : 'bg-ice-100 text-graphite-400'}`}>
                                                <Users size={24} />
                                            </div>
                                            <div>
                                                <p className="font-black text-graphite-900">{t('botConfigWizard.step2.teamTitle')}</p>
                                                <p className="text-xs text-graphite-400 mt-1">{t('botConfigWizard.step2.teamDescription')}</p>
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => setDraft({...draft, has_commercial_team: false})}
                                        className={`p-5 rounded-2xl border-2 text-left transition-all ${
                                            draft.has_commercial_team === false ? 'border-brand-primary bg-brand-primary/5' : 'border-ice-100 hover:border-ice-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`p-3 rounded-xl ${draft.has_commercial_team === false ? 'bg-brand-primary text-white' : 'bg-ice-100 text-graphite-400'}`}>
                                                <Bot size={24} />
                                            </div>
                                            <div>
                                                <p className="font-black text-graphite-900">{t('botConfigWizard.step2.botOnlyTitle')}</p>
                                                <p className="text-xs text-graphite-400 mt-1">{t('botConfigWizard.step2.botOnlyDescription')}</p>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 3 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                                <h2 className="text-2xl font-black text-graphite-900 mb-2">{t('botConfigWizard.step3.title')}</h2>
                                <p className="text-graphite-400 text-sm mb-8">{t('botConfigWizard.step3.subtitle')}</p>

                                <div className="grid grid-cols-1 gap-4">
                                    <button
                                        onClick={() => setDraft({...draft, personality: 'acolhedor'})}
                                        className={`p-5 rounded-2xl border-2 text-left transition-all ${
                                            draft.personality === 'acolhedor' ? 'border-brand-primary bg-brand-primary/5' : 'border-ice-100 hover:border-ice-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`p-3 rounded-xl ${draft.personality === 'acolhedor' ? 'bg-brand-primary text-white' : 'bg-ice-100 text-graphite-400'}`}>
                                                <Heart size={24} />
                                            </div>
                                            <div>
                                                <p className="font-black text-graphite-900">{t('botConfigWizard.step3.welcomingTitle')}</p>
                                                <p className="text-xs text-graphite-400 mt-1">{t('botConfigWizard.step3.welcomingDescription')}</p>
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => setDraft({...draft, personality: 'formal'})}
                                        className={`p-5 rounded-2xl border-2 text-left transition-all ${
                                            draft.personality === 'formal' ? 'border-brand-primary bg-brand-primary/5' : 'border-ice-100 hover:border-ice-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`p-3 rounded-xl ${draft.personality === 'formal' ? 'bg-brand-primary text-white' : 'bg-ice-100 text-graphite-400'}`}>
                                                <Briefcase size={24} />
                                            </div>
                                            <div>
                                                <p className="font-black text-graphite-900">{t('botConfigWizard.step3.formalTitle')}</p>
                                                <p className="text-xs text-graphite-400 mt-1">{t('botConfigWizard.step3.formalDescription')}</p>
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => setDraft({...draft, personality: 'eficiente'})}
                                        className={`p-5 rounded-2xl border-2 text-left transition-all ${
                                            draft.personality === 'eficiente' ? 'border-brand-primary bg-brand-primary/5' : 'border-ice-100 hover:border-ice-300'
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`p-3 rounded-xl ${draft.personality === 'eficiente' ? 'bg-brand-primary text-white' : 'bg-ice-100 text-graphite-400'}`}>
                                                <Zap size={24} />
                                            </div>
                                            <div>
                                                <p className="font-black text-graphite-900">{t('botConfigWizard.step3.efficientTitle')}</p>
                                                <p className="text-xs text-graphite-400 mt-1">{t('botConfigWizard.step3.efficientDescription')}</p>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 4 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                                <h2 className="text-2xl font-black text-graphite-900 mb-2">{t('botConfigWizard.step4.title')}</h2>
                                <p className="text-graphite-400 text-sm mb-6">{t('botConfigWizard.step4.subtitle')}</p>

                                <div className="space-y-4 bg-ice-50/50 p-6 rounded-3xl border border-ice-100 mb-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wider">{t('botConfigWizard.step4.objectiveLabel')}</p>
                                            <div className="bg-white px-3 py-1.5 rounded-xl border border-ice-100 inline-block">
                                                <p className="text-xs font-bold text-brand-primary">
                                                    {draft.objective === 'hybrid' ? t('botConfigWizard.step4.objectiveHybrid') :
                                                     draft.objective === 'lead_capture' ? t('botConfigWizard.step4.objectiveLeadCapture') : t('botConfigWizard.step4.objectiveAgenda')}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wider">{t('botConfigWizard.step4.serviceLabel')}</p>
                                            <div className="bg-white px-3 py-1.5 rounded-xl border border-ice-100 inline-block">
                                                <p className="text-xs font-bold text-graphite-700">
                                                    {draft.has_commercial_team ? t('botConfigWizard.step4.serviceHandoff') : t('botConfigWizard.step4.serviceAutonomous')}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-4 mt-4 border-t border-ice-100 space-y-3">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-graphite-400 font-medium italic">{t('botConfigWizard.step4.identityLabel')}</span>
                                            <span className="text-graphite-700 font-bold">{t('botConfigWizard.step4.identityValue')}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-graphite-400 font-medium">{t('botConfigWizard.step4.followUpLabel')}</span>
                                            <span className="text-emerald-500 font-bold flex items-center gap-1">
                                                {draft.objective !== 'agenda_management' ? <Check size={14} /> : <X size={14} className="text-graphite-300" />}
                                                {draft.objective !== 'agenda_management' ? t('botConfigWizard.step4.followUpActive') : t('botConfigWizard.step4.followUpOffline')}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-graphite-400 font-medium">{t('botConfigWizard.step4.noShowLabel')}</span>
                                            <span className="text-emerald-500 font-bold flex items-center gap-1"><Check size={14} /> {t('botConfigWizard.step4.noShowActive')}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                                    <AlertCircle className="text-indigo-500 shrink-0" size={18} />
                                    <p className="text-[10px] text-indigo-700 font-bold leading-relaxed">
                                        {t('botConfigWizard.step4.disclaimer')}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer Controls */}
                    <div className="flex items-center justify-between pt-8 border-t border-ice-100">
                        {step > 1 ? (
                            <button 
                                onClick={handleBack}
                                className="flex items-center gap-2 text-sm font-black text-graphite-400 hover:text-graphite-900 transition-colors bg-transparent border-none cursor-pointer"
                            >
                                <ChevronLeft size={18} /> {t('botConfigWizard.footer.back')}
                            </button>
                        ) : <div />}

                        {step < 4 ? (
                            <button
                                onClick={handleNext}
                                disabled={isNextDisabled()}
                                className="flex items-center gap-2 bg-brand-primary text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-105 transition-all border-none cursor-pointer disabled:opacity-30 disabled:hover:scale-100"
                            >
                                {t('botConfigWizard.footer.next')} <ChevronRight size={18} />
                            </button>
                        ) : (
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 bg-emerald-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-emerald-500/20 hover:scale-105 transition-all border-none cursor-pointer disabled:opacity-50"
                            >
                                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                {t('botConfigWizard.footer.save')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
