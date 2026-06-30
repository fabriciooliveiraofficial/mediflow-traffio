import React from 'react';
import { X, Calendar, MessageSquare, Play, User, Activity, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLeadTimeline } from '../../hooks/useLeadTimeline';
import type { CrmTimelineEvent, CrmTimelineEventType } from '../../hooks/useLeadTimeline';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';
import { IconButton } from '../ui/IconButton';
import { Badge } from '../ui/Badge';
import { formatPhone, phoneFlag } from '../../lib/formatPhone';
import { useAuth } from '../../contexts/AuthContext';

interface FollowUpTimelineDrawerProps {
    session: any;
    onClose: () => void;
}

export function FollowUpTimelineDrawer({ session, onClose }: FollowUpTimelineDrawerProps) {
    const { t } = useTranslation('crm');
    const { tenant } = useAuth();
    const { events, loading } = useLeadTimeline(session.id, tenant?.id);
    const { formatDate } = useLocaleFormat();

    const getEventIcon = (type: CrmTimelineEventType, status?: string | null) => {
        switch (type) {
            case 'session_created':
                return <Play className="w-4 h-4 text-brand-primary" />;
            case 'appointment':
                if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
                if (status === 'canceled') return <XCircle className="w-4 h-4 text-red-500" />;
                if (status === 'no_show') return <AlertCircle className="w-4 h-4 text-orange-500" />;
                return <Calendar className="w-4 h-4 text-blue-500" />;
            case 'message_outbound':
                return <MessageSquare className="w-4 h-4 text-indigo-500" />;
            case 'message_inbound':
                return <User className="w-4 h-4 text-graphite-500" />;
            case 'stage_change':
                return <Activity className="w-4 h-4 text-purple-500" />;
            default:
                return <Activity className="w-4 h-4 text-gray-500" />;
        }
    };

    const getEventColor = (type: CrmTimelineEventType, status?: string | null) => {
        switch (type) {
            case 'session_created': return 'bg-brand-primary/10 border-brand-primary/20';
            case 'appointment':
                if (status === 'completed') return 'bg-emerald-50 border-emerald-100';
                if (status === 'canceled') return 'bg-red-50 border-red-100';
                if (status === 'no_show') return 'bg-orange-50 border-orange-100';
                return 'bg-blue-50 border-blue-100';
            case 'message_outbound': return 'bg-indigo-50 border-indigo-100';
            case 'message_inbound': return 'bg-gray-50 border-gray-100';
            case 'stage_change': return 'bg-purple-50 border-purple-100';
            default: return 'bg-ice-50 border-ice-100';
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex justify-end z-[60] overflow-hidden">
            {/* Overlay click to close */}
            <div className="absolute inset-0 cursor-pointer" onClick={onClose} />

            {/* Drawer */}
            <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="p-6 border-b border-ice-100 flex items-center justify-between bg-ice-50/50 shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-primary to-indigo-600 flex items-center justify-center shadow-inner">
                            <User className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-graphite-900 leading-tight">
                                {session.variables?.patient_name || session.patient_phone || t('timeline.unknownLead', { defaultValue: 'Lead Desconhecido' })}
                            </h2>
                            <p className="text-xs font-bold text-graphite-500 flex items-center gap-1 mt-0.5">
                                {phoneFlag(session.patient_phone)} {formatPhone(session.patient_phone)}
                            </p>
                        </div>
                    </div>
                    <IconButton onClick={onClose} className="hover:bg-ice-100">
                        <X className="w-5 h-5" />
                    </IconButton>
                </div>

                {/* Sub-header Context */}
                <div className="px-6 py-3 border-b border-ice-100 bg-white flex items-center justify-between shrink-0">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-graphite-400 uppercase tracking-widest">{t('timeline.currentStage', { defaultValue: 'Fase Atual' })}</span>
                        <Badge accent="brand" size="sm" className="mt-0.5 w-fit">{session.kanban_stage || 'Novos Leads'}</Badge>
                    </div>
                    {session.revenue_estimated > 0 && (
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] font-bold text-graphite-400 uppercase tracking-widest">{t('timeline.estimatedValue', { defaultValue: 'Valor Estimado' })}</span>
                            <span className="text-sm font-black text-emerald-600">R$ {session.revenue_estimated.toLocaleString('pt-BR')}</span>
                        </div>
                    )}
                </div>

                {/* Timeline Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-white custom-scrollbar relative">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 opacity-60">
                            <Activity className="w-8 h-8 text-brand-primary animate-spin" />
                            <p className="text-xs font-bold text-graphite-500 uppercase tracking-widest">{t('timeline.loading', { defaultValue: 'Carregando Histórico...' })}</p>
                        </div>
                    ) : events.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 opacity-60">
                            <Clock className="w-8 h-8 text-graphite-300" />
                            <p className="text-sm font-bold text-graphite-500">{t('timeline.noEvents', { defaultValue: 'Nenhum evento encontrado' })}</p>
                        </div>
                    ) : (
                        <div className="relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-ice-200 before:to-transparent">
                            {events.map((event, i) => (
                                <div key={event.id} className="relative flex items-center justify-normal group mb-8 last:mb-0">
                                    
                                    {/* Icon Marker */}
                                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-ice-50 shadow-sm shrink-0 z-10 transition-transform group-hover:scale-110">
                                        {getEventIcon(event.type, event.status)}
                                    </div>

                                    {/* Content Card */}
                                    <div className={`w-[calc(100%-3rem)] ml-4 p-4 rounded-2xl border shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-1 ${getEventColor(event.type, event.status)}`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <h3 className="text-sm font-black text-graphite-900">{event.title}</h3>
                                            <span className="text-[10px] font-bold text-graphite-500 uppercase tracking-wider bg-white/60 px-2 py-0.5 rounded-md backdrop-blur-sm shrink-0">
                                                {formatDate(event.date, { hour: '2-digit', minute: '2-digit', month: 'short', day: '2-digit' })}
                                            </span>
                                        </div>
                                        {event.subtitle && (
                                            <p className="text-xs text-graphite-600 font-medium leading-relaxed">
                                                {event.subtitle}
                                            </p>
                                        )}
                                        
                                        {/* Status Badge for Appointments */}
                                        {event.type === 'appointment' && event.status && event.status !== 'created' && (
                                            <div className="mt-3">
                                                <Badge accent={event.status === 'completed' ? 'success' : event.status === 'canceled' ? 'danger' : 'warning'} size="sm">
                                                    {event.status === 'completed' ? 'Realizada' : event.status === 'canceled' ? 'Cancelada' : 'Faltou'}
                                                </Badge>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
