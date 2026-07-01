import { useState } from 'react';
import {
    X, Calendar, MessageSquare, Play, User, Activity, Clock,
    CheckCircle2, XCircle, AlertCircle, Save, Loader2, DollarSign,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useLeadTimeline } from '../../hooks/useLeadTimeline';
import type { CrmTimelineEvent, CrmTimelineEventType } from '../../hooks/useLeadTimeline';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';
import { IconButton } from '../ui/IconButton';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatPhone, phoneFlag } from '../../lib/formatPhone';
import { useTenant } from '../../contexts/TenantContext';
import { useToast } from '../../contexts/ToastContext';

interface FollowUpTimelineDrawerProps {
    session: any;
    onClose: () => void;
}

interface OutcomeModal {
    appointmentId: string;
    dateLabel: string;
}

export function FollowUpTimelineDrawer({ session, onClose }: FollowUpTimelineDrawerProps) {
    const { t } = useTranslation('crm');
    const { tenant } = useTenant();
    const { formatDate } = useLocaleFormat();
    const { showToast } = useToast();
    const { events, loading, refresh } = useLeadTimeline(session.id, tenant?.id);

    const [outcomeModal, setOutcomeModal] = useState<OutcomeModal | null>(null);
    const [procedure, setProcedure] = useState('');
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [savingNoShow, setSavingNoShow] = useState<string | null>(null);

    // Agendamento passado ou hoje, ainda não concluído
    const isPendingPastAppointment = (event: CrmTimelineEvent) => {
        if (event.type !== 'appointment' || event.status !== 'created') return false;
        const apt = event.data;
        if (!apt || !['scheduled', 'confirmed'].includes(apt.status ?? '')) return false;
        const today = new Date().toISOString().split('T')[0];
        return apt.date <= today;
    };

    const handleClickCompleted = (event: CrmTimelineEvent) => {
        const apt = event.data;
        setProcedure(apt?.appointment_types?.name || apt?.type_id || '');
        setValue('');
        setOutcomeModal({
            appointmentId: apt.id,
            dateLabel: `${apt.date} ${(apt.start_time || '').slice(0, 5)}`,
        });
    };

    const handleSaveOutcome = async () => {
        if (!outcomeModal || !tenant?.id) return;
        setSaving(true);
        try {
            // 1. Marcar consulta como realizada → dispara trigger NPS + trigger Kanban
            const { error: aptErr } = await supabase
                .from('appointments')
                .update({ status: 'completed' })
                .eq('id', outcomeModal.appointmentId);
            if (aptErr) throw aptErr;

            // 2. Registrar receita e procedimento na sessão (Kanban trigger já avançou o estágio)
            const revenueNum = parseFloat(value.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
            const sessionUpdate: Record<string, any> = {};
            if (revenueNum > 0) sessionUpdate.revenue_estimated = revenueNum;
            if (procedure.trim()) sessionUpdate.variables = { ...(session.variables || {}), procedure_name: procedure.trim() };

            if (Object.keys(sessionUpdate).length > 0) {
                await supabase
                    .from('conversation_sessions')
                    .update(sessionUpdate)
                    .eq('id', session.id);
            }

            showToast('success', t('timeline.toasts.completedSuccess', { defaultValue: 'Consulta registrada como realizada! NPS será enviado automaticamente.' }));
            setOutcomeModal(null);
            refresh();
        } catch (e: any) {
            showToast('error', t('timeline.toasts.completedError', { defaultValue: 'Erro ao registrar resultado.' }));
        } finally {
            setSaving(false);
        }
    };

    const handleMarkNoShow = async (event: CrmTimelineEvent) => {
        const apt = event.data;
        if (!apt?.id || !tenant?.id) return;
        setSavingNoShow(apt.id);
        try {
            // Marcar como no_show → dispara trigger Kanban automaticamente
            const { error: aptErr } = await supabase
                .from('appointments')
                .update({ status: 'no_show' })
                .eq('id', apt.id);
            if (aptErr) throw aptErr;

            showToast('success', t('timeline.toasts.noShowSuccess', { defaultValue: 'Falta registrada. Kanban atualizado.' }));
            refresh();
        } catch (e: any) {
            showToast('error', t('timeline.toasts.noShowError', { defaultValue: 'Erro ao registrar falta.' }));
        } finally {
            setSavingNoShow(null);
        }
    };

    const getEventIcon = (type: CrmTimelineEventType, status?: string | null) => {
        switch (type) {
            case 'session_created':   return <Play className="w-4 h-4 text-brand-primary" />;
            case 'appointment':
                if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
                if (status === 'canceled')  return <XCircle className="w-4 h-4 text-red-500" />;
                if (status === 'no_show')   return <AlertCircle className="w-4 h-4 text-orange-500" />;
                return <Calendar className="w-4 h-4 text-blue-500" />;
            case 'message_outbound':  return <MessageSquare className="w-4 h-4 text-indigo-500" />;
            case 'message_inbound':   return <User className="w-4 h-4 text-graphite-500" />;
            case 'stage_change':      return <Activity className="w-4 h-4 text-purple-500" />;
            default:                  return <Activity className="w-4 h-4 text-gray-500" />;
        }
    };

    const getEventColor = (type: CrmTimelineEventType, status?: string | null) => {
        switch (type) {
            case 'session_created':  return 'bg-brand-primary/10 border-brand-primary/20';
            case 'appointment':
                if (status === 'completed') return 'bg-emerald-50 border-emerald-100';
                if (status === 'canceled')  return 'bg-red-50 border-red-100';
                if (status === 'no_show')   return 'bg-orange-50 border-orange-100';
                return 'bg-blue-50 border-blue-100';
            case 'message_outbound': return 'bg-indigo-50 border-indigo-100';
            case 'message_inbound':  return 'bg-gray-50 border-gray-100';
            case 'stage_change':     return 'bg-purple-50 border-purple-100';
            default:                 return 'bg-ice-50 border-ice-100';
        }
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex justify-end z-[60] overflow-hidden">
                {/* Overlay */}
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

                    {/* Sub-header */}
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

                    {/* Timeline */}
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
                                {events.map((event) => {
                                    const isPending = isPendingPastAppointment(event);
                                    const isLoadingNoShow = savingNoShow === event.data?.id;

                                    return (
                                        <div key={event.id} className="relative flex items-start justify-normal group mb-8 last:mb-0">
                                            {/* Icon Marker */}
                                            <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-ice-50 shadow-sm shrink-0 z-10 mt-1 transition-transform group-hover:scale-110">
                                                {getEventIcon(event.type, event.status)}
                                            </div>

                                            {/* Content Card */}
                                            <div className={`w-[calc(100%-3rem)] ml-4 p-4 rounded-2xl border shadow-sm transition-all duration-300 hover:shadow-md ${isPending ? 'border-amber-200 bg-amber-50/60' : getEventColor(event.type, event.status)}`}>
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

                                                {/* Badge de status para eventos não-pendentes */}
                                                {event.type === 'appointment' && event.status && event.status !== 'created' && !isPending && (
                                                    <div className="mt-3">
                                                        <Badge accent={event.status === 'completed' ? 'success' : event.status === 'canceled' ? 'error' : 'warning'} size="sm">
                                                            {event.status === 'completed' ? t('timeline.status.completed', { defaultValue: 'Realizada' })
                                                                : event.status === 'canceled' ? t('timeline.status.canceled', { defaultValue: 'Cancelada' })
                                                                : t('timeline.status.noShow', { defaultValue: 'Não compareceu' })}
                                                        </Badge>
                                                    </div>
                                                )}

                                                {/* ── Botões de Resultado (agendamentos passados pendentes) ── */}
                                                {isPending && (
                                                    <div className="mt-4 pt-3 border-t border-amber-200">
                                                        <p className="text-[10px] font-black text-amber-700 uppercase tracking-wider mb-2">
                                                            {t('timeline.outcome.label', { defaultValue: 'Registrar resultado desta consulta' })}
                                                        </p>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleClickCompleted(event)}
                                                                className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black py-2 px-3 rounded-xl transition-colors border-none cursor-pointer"
                                                            >
                                                                <CheckCircle2 size={14} />
                                                                {t('timeline.outcome.attended', { defaultValue: 'Compareceu' })}
                                                            </button>
                                                            <button
                                                                onClick={() => handleMarkNoShow(event)}
                                                                disabled={isLoadingNoShow}
                                                                className="flex-1 flex items-center justify-center gap-1.5 bg-orange-100 hover:bg-orange-200 text-orange-700 text-xs font-black py-2 px-3 rounded-xl transition-colors border-none cursor-pointer disabled:opacity-60"
                                                            >
                                                                {isLoadingNoShow
                                                                    ? <Loader2 size={14} className="animate-spin" />
                                                                    : <AlertCircle size={14} />}
                                                                {t('timeline.outcome.noShow', { defaultValue: 'Não compareceu' })}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal de Resultado da Consulta */}
            {outcomeModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-white/20 animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-ice-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-graphite-900">{t('timeline.outcomeModal.title', { defaultValue: 'Registrar Resultado' })}</h3>
                                    <p className="text-xs text-graphite-500 font-medium">{outcomeModal.dateLabel}</p>
                                </div>
                            </div>
                            <IconButton onClick={() => setOutcomeModal(null)}>
                                <X className="w-5 h-5" />
                            </IconButton>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-graphite-700 uppercase tracking-wider mb-1.5 ml-1">
                                    {t('timeline.outcomeModal.procedureLabel', { defaultValue: 'Procedimento Realizado' })}
                                </label>
                                <input
                                    type="text"
                                    value={procedure}
                                    onChange={(e) => setProcedure(e.target.value)}
                                    placeholder={t('timeline.outcomeModal.procedurePlaceholder', { defaultValue: 'Ex: Consulta de avaliação, Limpeza, Implante...' })}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-graphite-700 uppercase tracking-wider mb-1.5 ml-1">
                                    {t('timeline.outcomeModal.valueLabel', { defaultValue: 'Valor do Procedimento (opcional)' })}
                                </label>
                                <div className="relative">
                                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite-400" />
                                    <input
                                        type="text"
                                        value={value}
                                        onChange={(e) => setValue(e.target.value)}
                                        placeholder="0,00"
                                        className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-9 pr-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                                    />
                                </div>
                            </div>

                            <div className="p-3 bg-emerald-50 rounded-xl flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                                <p className="text-[11px] font-medium text-emerald-800 leading-relaxed">
                                    {t('timeline.outcomeModal.npsHint', { defaultValue: 'A pesquisa NPS será enviada automaticamente ao paciente após o prazo configurado em Inteligência.' })}
                                </p>
                            </div>
                        </div>

                        <div className="p-6 bg-ice-50 rounded-b-3xl flex gap-3">
                            <Button variant="ghost" className="flex-1 justify-center" onClick={() => setOutcomeModal(null)}>
                                {t('timeline.outcomeModal.cancel', { defaultValue: 'Cancelar' })}
                            </Button>
                            <Button variant="success" className="flex-1 justify-center" onClick={handleSaveOutcome} disabled={saving}>
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                {t('timeline.outcomeModal.save', { defaultValue: 'Confirmar Realização' })}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
