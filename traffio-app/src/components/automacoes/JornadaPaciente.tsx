import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    X, 
    MessageCircle, 
    Bot, 
    Calendar, 
    CheckCircle, 
    Clock, 
    XCircle, 
    ExternalLink,
    ChevronDown,
    ChevronUp
} from 'lucide-react';
import { usePatientAutomationJourney } from '../../hooks/usePatientAutomationJourney';
import type { JourneyEvent } from '../../hooks/usePatientAutomationJourney';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { formatPhone, phoneFlag } from '../../lib/formatPhone';
import { motion, AnimatePresence } from 'framer-motion';

interface JornadaPacienteProps {
    tenantId: string;
    phone: string;
    name: string;
    isOpen: boolean;
    onClose: () => void;
    onOpenInbox: (phone: string) => void;
}

export const JornadaPaciente: React.FC<JornadaPacienteProps> = ({
    tenantId,
    phone,
    name,
    isOpen,
    onClose,
    onOpenInbox
}) => {
    const { t } = useTranslation('automations');
    const { events, isLoading } = usePatientAutomationJourney(phone, tenantId);

    if (!isOpen) return null;

    const getIcon = (type: string) => {
        switch (type) {
            case 'inbound': return <MessageCircle size={14} />;
            case 'outbound': return <Bot size={14} />;
            case 'appointment': return <Calendar size={14} />;
            default: return <Clock size={14} />;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'text-emerald-500 bg-emerald-50';
            case 'pending': return 'text-blue-500 bg-blue-50';
            case 'failed': return 'text-rose-500 bg-rose-50';
            case 'cancelled': return 'text-graphite-300 bg-ice-50';
            default: return 'text-graphite-400 bg-ice-100';
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-end p-0 lg:p-6 bg-graphite-900/40 backdrop-blur-sm">
            <motion.div 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                className="bg-white h-full w-full max-w-2xl rounded-l-[40px] shadow-2xl flex flex-col relative"
            >
                {/* Header */}
                <div className="p-8 border-b border-ice-50 flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-black text-graphite-900 tracking-tighter leading-tight">{name}</h3>
                        <p className="text-sm font-bold text-graphite-400">{phoneFlag(phone)} {formatPhone(phone)}</p>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 flex items-center justify-center bg-ice-50 rounded-xl hover:bg-ice-100 transition-all border-none cursor-pointer">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    <div className="mb-12">
                        <h4 className="text-[10px] font-black uppercase text-graphite-300 tracking-[0.2em] mb-8">{t('jornadaPaciente.timelineTitle')}</h4>

                        <div className="space-y-0 relative before:absolute before:left-6 before:top-2 before:bottom-2 before:w-px before:bg-ice-100">
                            {isLoading ? (
                                <div className="py-12 text-center opacity-40">{t('jornadaPaciente.loading')}</div>
                            ) : events.length === 0 ? (
                                <div className="py-12 text-center text-sm font-bold text-graphite-300">{t('jornadaPaciente.noEvents')}</div>
                            ) : events.map((event, idx) => (
                                <TimelineItem key={event.id} event={event} icon={getIcon(event.type)} statusClass={getStatusColor(event.status)} isFirst={idx === 0} />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-8 border-t border-ice-50 bg-ice-25/30 flex items-center gap-4">
                    <button 
                        onClick={() => onOpenInbox(phone)}
                        className="flex-1 px-8 py-4 bg-brand-primary text-white font-black rounded-2xl shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-95 transition-all border-none cursor-pointer flex items-center justify-center gap-2"
                    >
                        <ExternalLink size={18} /> {t('jornadaPaciente.openConversation')}
                    </button>
                    <button
                        onClick={onClose}
                        className="px-8 py-4 bg-white border border-ice-100 text-graphite-600 font-bold rounded-2xl hover:bg-ice-50 transition-all border-none cursor-pointer"
                    >
                        {t('jornadaPaciente.close')}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

const TimelineItem = ({ event, icon, statusClass, isFirst }: { event: JourneyEvent, icon: any, statusClass: string, isFirst: boolean }) => {
    const [expanded, setExpanded] = React.useState(isFirst);
    const date = new Date(event.timestamp);

    return (
        <div className="relative pl-14 pb-8 group">
            {/* Circle Node */}
            <div className={clsx(
                "absolute left-3.5 top-1 -translate-x-1/2 w-5 h-5 rounded-full z-10 border-2 border-white ring-4 ring-white flex items-center justify-center transition-all",
                event.status === 'completed' ? "bg-emerald-500 shadow-md shadow-emerald-500/20" : 
                event.status === 'pending' ? "bg-blue-500 shadow-md shadow-blue-500/20" : 
                "bg-ice-200"
            )}>
                {event.status === 'completed' && <CheckCircle size={10} className="text-white" />}
                {event.status === 'failed' && <XCircle size={10} className="text-white" />}
                {event.status === 'pending' && <Clock size={10} className="text-white" />}
            </div>

            <div className="bg-white rounded-3xl border border-ice-100 p-5 hover:border-brand-primary/20 transition-all shadow-sm group-hover:shadow-md cursor-pointer" onClick={() => setExpanded(!expanded)}>
                <div className="flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className={clsx("p-1.5 rounded-lg flex items-center justify-center", statusClass)}>
                                {icon}
                            </span>
                            <h5 className="text-xs font-black text-graphite-900 tracking-tight leading-none uppercase">{event.title}</h5>
                        </div>
                        <p className="text-[10px] font-bold text-graphite-400">
                            {format(date, "dd MMM 'às' HH:mm", { locale: ptBR })}
                        </p>
                    </div>
                    {event.content && (
                        <button className="p-1 text-graphite-200 hover:text-brand-primary transition-all border-none bg-transparent cursor-pointer">
                            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                    )}
                </div>

                <AnimatePresence>
                    {expanded && event.content && (
                        <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="mt-4 pt-4 border-t border-ice-50 overflow-hidden"
                        >
                            <div className="bg-ice-50 rounded-2xl p-4 text-[11px] font-bold text-graphite-600 leading-relaxed italic whitespace-pre-wrap">
                                "{event.content}"
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};
