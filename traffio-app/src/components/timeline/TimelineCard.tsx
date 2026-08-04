import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    Stethoscope,
    Pill,
    FlaskConical,
    Clock,
} from 'lucide-react';
import type { TimelineEvent, MedicalRecord } from '../../types/patient';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';

interface TimelineCardProps {
    event: TimelineEvent;
    onExplain?: (term: string) => void;
}

const TYPE_CONFIG = {
    consultation: {
        icon: Stethoscope,
        badgeClass: 'bg-brand-secondary/30 text-brand-primary',
        dotClass: 'bg-brand-primary',
    },
    prescription: {
        icon: Pill,
        badgeClass: 'bg-emerald-100 text-emerald-700',
        dotClass: 'bg-emerald-500',
    },
    exam_result: {
        icon: FlaskConical,
        badgeClass: 'bg-sky-100 text-sky-700',
        dotClass: 'bg-sky-500',
    },
};

export const TimelineCard: React.FC<TimelineCardProps> = ({ event, onExplain }) => {
    const { t } = useTranslation('medical');
    const { formatDateTime } = useLocaleFormat();
    const config = TYPE_CONFIG[event.type];
    const Icon = config.icon;

    const soap = event.type === 'consultation'
        ? (event.data as MedicalRecord).soap_notes
        : null;

    return (
        <div className="relative group">
            {/* Timeline Dot */}
            <div className={`absolute -left-[41px] top-0 w-5 h-5 rounded-full ${config.dotClass} border-4 border-white shadow-sm`} />

            {/* Card */}
            <div className="bg-white rounded-2xl border border-ice-200 p-5 shadow-sm hover:shadow-md transition-shadow">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-black uppercase ${config.badgeClass}`}>
                            <Icon size={12} />
                            {t(`timelineCard.types.${event.type}`)}
                        </span>
                        <span className="text-[10px] font-bold text-graphite-400 flex items-center gap-1">
                            <Clock size={10} />
                            {formatDateTime(event.date, { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                    </div>
                </div>

                {/* Title */}
                <h4 className="text-sm font-black text-graphite-900 mb-1">
                    {event.title}
                    {onExplain && event.type === 'consultation' && (
                        <button
                            onClick={() => onExplain(event.title)}
                            className="ml-2 px-1.5 py-0.5 text-[8px] font-black bg-brand-primary/10 text-brand-primary rounded uppercase hover:bg-brand-primary hover:text-white transition-all border-none cursor-pointer"
                        >
                            {t('timelineCard.aiExplain')}
                        </button>
                    )}
                </h4>

                {/* Subtitle / Content */}
                {event.subtitle && (
                    <p className="text-xs text-graphite-500 font-medium italic line-clamp-2">
                        "{event.subtitle}"
                    </p>
                )}

                {/* SOAP Preview (for consultations) */}
                {soap && (
                    <div className="mt-3 space-y-2">
                        {soap.s && <SoapLine letter="S" text={soap.s} color="text-brand-primary" bg="bg-brand-primary/5" />}
                        {soap.a && <SoapLine letter="A" text={soap.a} color="text-emerald-600" bg="bg-emerald-50" />}
                        {soap.p && <SoapLine letter="P" text={soap.p} color="text-sky-600" bg="bg-sky-50" />}
                    </div>
                )}
            </div>
        </div>
    );
};

function SoapLine({ letter, text, color, bg }: { letter: string; text: string; color: string; bg: string }) {
    return (
        <div className="flex gap-2">
            <span className={`text-[10px] font-black ${color} ${bg} w-5 h-5 rounded flex items-center justify-center shrink-0`}>
                {letter}
            </span>
            <p className="text-xs text-graphite-600 line-clamp-2">{text}</p>
        </div>
    );
}
