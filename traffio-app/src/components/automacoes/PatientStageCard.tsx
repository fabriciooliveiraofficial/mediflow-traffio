import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreVertical, MessageCircle, Clock, Calendar, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { PatientFunnelRow, FunnelStage } from '../../hooks/usePatientFunnel';
import { clsx } from 'clsx';
import { formatPhone, phoneFlag } from '../../lib/formatPhone';
import { useTenant } from '../../contexts/TenantContext';
import { type CountryCode } from '../../lib/i18n/countryFormats';

interface PatientStageCardProps {
    patient: PatientFunnelRow;
    onViewJourney: (phone: string, name: string) => void;
    onMove: (phone: string, to: FunnelStage) => void;
    onCancel: (phone: string) => void;
    onStartConversation: (phone: string) => void;
}

export const PatientStageCard: React.FC<PatientStageCardProps> = ({ 
    patient, 
    onViewJourney, 
    onMove, 
    onCancel, 
    onStartConversation 
}) => {
    const { t } = useTranslation('automations');
    const { tenant } = useTenant();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const stages: { key: FunnelStage; label: string }[] = [
        { key: 'novo_lead', label: t('patientStageCard.stages.novoLead') },
        { key: 'em_follow_up', label: t('patientStageCard.stages.emFollowUp') },
        { key: 'qualificado', label: t('patientStageCard.stages.qualificado') },
        { key: 'agendado', label: t('patientStageCard.stages.agendado') },
        { key: 'perdido', label: t('patientStageCard.stages.perdido') }
    ];

    const getNextActionLabel = () => {
        if (!patient.next_action_at) return null;
        const date = new Date(patient.next_action_at);
        const distance = formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
        return {
            text: `${patient.next_action_type?.replace(/_/g, ' ')} ${distance}`,
            isFuture: date > new Date()
        };
    };

    const nextAction = getNextActionLabel();

    return (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-ice-100 hover:shadow-md transition-all group relative">
            {/* Header */}
            <div className="flex justify-between items-start mb-3">
                <div className="overflow-hidden">
                    <h4 className="font-black text-sm text-graphite-900 truncate pr-6">{patient.patient_name}</h4>
                    <span className="text-[10px] font-bold text-graphite-400 block tracking-tight">{phoneFlag(patient.patient_phone, tenant?.country as CountryCode)} {formatPhone(patient.patient_phone, tenant?.country as CountryCode)}</span>
                </div>
                
                <div className="relative">
                    <button 
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="p-1 hover:bg-ice-50 rounded-lg text-graphite-300 hover:text-brand-primary"
                    >
                        <MoreVertical size={16} />
                    </button>
                    
                    {isMenuOpen && (
                        <>
                            <div 
                                className="fixed inset-0 z-10" 
                                onClick={() => setIsMenuOpen(false)}
                            />
                            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-ice-100 z-20 py-1 overflow-hidden">
                                <button 
                                    onClick={() => { onViewJourney(patient.patient_phone, patient.patient_name); setIsMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-xs font-bold text-graphite-700 hover:bg-ice-50 flex items-center gap-2 border-none bg-transparent cursor-pointer"
                                >
                                    <Clock size={14} /> {t('patientStageCard.menu.viewFullJourney')}
                                </button>
                                <button
                                    onClick={() => { onStartConversation(patient.patient_phone); setIsMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-xs font-bold text-graphite-700 hover:bg-ice-50 flex items-center gap-2 border-none bg-transparent cursor-pointer"
                                >
                                    <MessageCircle size={14} /> {t('patientStageCard.menu.openConversation')}
                                </button>

                                <div className="h-px bg-ice-50 my-1" />

                                <span className="block px-4 py-1 text-[9px] font-black uppercase text-graphite-300 tracking-widest">{t('patientStageCard.menu.moveTo')}</span>
                                {stages.filter(s => s.key !== patient.current_stage).map(stage => (
                                    <button 
                                        key={stage.key}
                                        onClick={() => { onMove(patient.patient_phone, stage.key); setIsMenuOpen(false); }}
                                        className="w-full text-left px-4 py-2 text-[11px] font-bold text-graphite-600 hover:bg-brand-primary/10 hover:text-brand-primary border-none bg-transparent cursor-pointer"
                                    >
                                        • {stage.label}
                                    </button>
                                ))}
                                
                                <div className="h-px bg-ice-50 my-1" />
                                
                                <button 
                                    onClick={() => { onCancel(patient.patient_phone); setIsMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-xs font-bold text-rose-500 hover:bg-rose-50 flex items-center gap-2 border-none bg-transparent cursor-pointer"
                                >
                                    <XCircle size={14} /> {t('patientStageCard.menu.cancelFollowUps')}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Content info */}
            <div className="space-y-2">
                {patient.last_message_snippet && (
                    <div className="bg-ice-50/50 p-2 rounded-xl border border-ice-100/50 mb-1">
                        <p className="text-[10px] text-graphite-600 line-clamp-2 leading-relaxed italic">
                            "{patient.last_message_snippet}"
                        </p>
                    </div>
                )}

                <div className="flex items-center gap-1.5 text-graphite-400">
                    <MessageCircle size={12} className="shrink-0" />
                    <span className="text-[10px] font-bold truncate">
                        {t('patientStageCard.lastInteraction', { distance: formatDistanceToNow(new Date(patient.last_interaction_at || patient.created_at), { addSuffix: true, locale: ptBR }) })}
                    </span>
                </div>

                {nextAction && (
                    <div className={clsx(
                        "flex items-center gap-1.5 px-2 py-1 rounded-lg",
                        nextAction.isFuture ? "bg-brand-primary/10 text-brand-primary" : "bg-rose-50 text-rose-500"
                    )}>
                        {nextAction.isFuture ? <Calendar size={12} className="shrink-0" /> : <Clock size={12} className="shrink-0" />}
                        <span className="text-[10px] font-black tracking-tight capitalize truncate">
                            {nextAction.text}
                        </span>
                    </div>
                )}

                <div className="flex items-center gap-1.5 text-graphite-400">
                    <div className="px-1.5 py-0.5 rounded-md bg-ice-100 text-[9px] font-black uppercase tracking-wider">
                        {patient.lead_source}
                    </div>
                </div>
            </div>

            {/* Click area to view journey */}
            <div 
                className="absolute inset-x-0 top-0 bottom-12 cursor-pointer" 
                onClick={() => onViewJourney(patient.patient_phone, patient.patient_name)}
            />
        </div>
    );
};
