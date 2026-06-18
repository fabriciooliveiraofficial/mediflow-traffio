import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DoctorAvailability } from '../types/patient';

interface QueueStatusBadgeProps {
    status: DoctorAvailability;
    compact?: boolean;
}

const STATUS_CONFIG: Record<DoctorAvailability, { key: string; color: string; bgColor: string; pulseColor: string }> = {
    on_time: {
        key: 'onTime',
        color: 'text-emerald-700',
        bgColor: 'bg-emerald-50 border-emerald-200',
        pulseColor: 'bg-emerald-400',
    },
    slight_delay: {
        key: 'slightDelay',
        color: 'text-amber-700',
        bgColor: 'bg-amber-50 border-amber-200',
        pulseColor: 'bg-amber-400',
    },
    moderate_delay: {
        key: 'moderateDelay',
        color: 'text-orange-700',
        bgColor: 'bg-orange-50 border-orange-200',
        pulseColor: 'bg-orange-400',
    },
};

export const QueueStatusBadge: React.FC<QueueStatusBadgeProps> = ({ status, compact = false }) => {
    const { t } = useTranslation('patient');
    const config = STATUS_CONFIG[status];
    const label = t(`waitingRoom.status.${config.key}.label`);

    if (compact) {
        return (
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase border ${config.bgColor} ${config.color}`}>
                <span className={`w-2 h-2 rounded-full ${config.pulseColor} animate-pulse`} />
                {label}
            </span>
        );
    }

    return (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${config.bgColor}`}>
            <div className="relative">
                <span className={`block w-3.5 h-3.5 rounded-full ${config.pulseColor}`} />
                <span className={`absolute inset-0 w-3.5 h-3.5 rounded-full ${config.pulseColor} animate-ping opacity-75`} />
            </div>
            <div>
                <p className={`text-xs font-black uppercase tracking-wider ${config.color}`}>{label}</p>
                <p className="text-[10px] text-graphite-400 font-medium">
                    {t(`waitingRoom.status.${config.key}.description`)}
                </p>
            </div>
        </div>
    );
};
