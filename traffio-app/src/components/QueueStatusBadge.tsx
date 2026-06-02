import React from 'react';
import type { DoctorAvailability } from '../types/patient';

interface QueueStatusBadgeProps {
    status: DoctorAvailability;
    compact?: boolean;
}

const STATUS_CONFIG: Record<DoctorAvailability, { label: string; color: string; bgColor: string; pulseColor: string }> = {
    on_time: {
        label: 'No Horário',
        color: 'text-emerald-700',
        bgColor: 'bg-emerald-50 border-emerald-200',
        pulseColor: 'bg-emerald-400',
    },
    slight_delay: {
        label: 'Leve Atraso',
        color: 'text-amber-700',
        bgColor: 'bg-amber-50 border-amber-200',
        pulseColor: 'bg-amber-400',
    },
    moderate_delay: {
        label: 'Atraso Moderado',
        color: 'text-orange-700',
        bgColor: 'bg-orange-50 border-orange-200',
        pulseColor: 'bg-orange-400',
    },
};

export const QueueStatusBadge: React.FC<QueueStatusBadgeProps> = ({ status, compact = false }) => {
    const config = STATUS_CONFIG[status];

    if (compact) {
        return (
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase border ${config.bgColor} ${config.color}`}>
                <span className={`w-2 h-2 rounded-full ${config.pulseColor} animate-pulse`} />
                {config.label}
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
                <p className={`text-xs font-black uppercase tracking-wider ${config.color}`}>{config.label}</p>
                <p className="text-[10px] text-graphite-400 font-medium">
                    {status === 'on_time' && 'Atendimento fluindo normalmente'}
                    {status === 'slight_delay' && 'Atraso de 5-15 min estimado'}
                    {status === 'moderate_delay' && 'Atraso superior a 15 min'}
                </p>
            </div>
        </div>
    );
};
