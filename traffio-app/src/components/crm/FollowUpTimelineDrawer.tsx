import { useState, useEffect } from 'react';
import {
    X, Calendar, MessageSquare, Play, User, Activity, Clock,
    CheckCircle2, XCircle, AlertCircle, Save, Loader2, DollarSign, Zap, StickyNote,
    GitMerge, Search,
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
import { CRM_STAGE_LABEL_KEYS, type CrmStageId } from '../../lib/crmStages';

interface FollowUpTimelineDrawerProps {
    journey: any;
    onClose: () => void;
}

interface OutcomeModal {
    appointmentId: string;
    dateLabel: string;
}

interface MergeCandidate {
    id: string;
    label: string;
    sublabel: string;
    stage_id: string;
}

export function FollowUpTimelineDrawer({ journey, onClose }: FollowUpTimelineDrawerProps) {
    const { t } = useTranslation('crm');
    const { tenant } = useTenant();
    const { formatDate } = useLocaleFormat();
    const { showToast } = useToast();
    const { events, pendingAppointments, loading, refresh } = useLeadTimeline(journey.id, tenant?.id);

    const [outcomeModal, setOutcomeModal] = useState<OutcomeModal | null>(null);
    const [procedure, setProcedure] = useState('');
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [savingNoShow, setSavingNoShow] = useState<string | null>(null);

    // Merge de contato (identity resolution manual)
    const [mergeOpen, setMergeOpen] = useState(false);
    const [mergeSearch, setMergeSearch] = useState('');
    const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[]>([]);
    const [mergeTarget, setMergeTarget] = useState<MergeCandidate | null>(null);
    const [merging, setMerging] = useState(false);

    const phone = journey.lead_phone || journey.patients?.phone || journey.conversation_sessions?.patient_phone || '';
    const displayName = journey.patients?.full_name
        || (journey.crm_journey_identities || []).find((i: any) => i.display_name)?.display_name
        || journey.conversation_sessions?.platform_display_name
        || journey.conversation_sessions?.context?.visitor_name
        || phone;

    // Candidatos ao merge: cards abertos do mesmo tenant, exceto o atual
    useEffect(() => {
        if (!mergeOpen || !tenant?.id) return;
        (async () => {
            const { data } = await supabase
                .from('crm_journeys')
                .select('id, stage_id, lead_phone, patients(full_name, phone), crm_journey_identities(channel, identifier, display_name)')
                .eq('tenant_id', tenant.id)
                .neq('id', journey.id)
                .not('stage_id', 'in', '("won","lost")')
                .order('last_event_at', { ascending: false })
                .limit(200);

            const candidates: MergeCandidate[] = (data || []).map((j: any) => {
                const identityName = (j.crm_journey_identities || []).find((i: any) => i.display_name)?.display_name;
                const label = j.patients?.full_name || identityName || formatPhone(j.lead_phone || '');
                const channels = [...new Set((j.crm_journey_identities || []).map((i: any) => i.channel))].join(', ');
                const sublabel = j.patients?.phone ? formatPhone(j.patients.phone) : (channels || formatPhone(j.lead_phone || ''));
                return { id: j.id, label, sublabel, stage_id: j.stage_id };
            });
            setMergeCandidates(candidates);
        })();
    }, [mergeOpen, tenant?.id, journey.id]);

    const filteredCandidates = mergeCandidates.filter(c =>
        !mergeSearch.trim()
        || c.label.toLowerCase().includes(mergeSearch.toLowerCase())
        || c.sublabel.toLowerCase().includes(mergeSearch.toLowerCase())
    ).slice(0, 8);

    const handleMerge = async () => {
        if (!mergeTarget) return;
        setMerging(true);
        try {
            // O card selecionado é o primário (sobrevive); o card atual funde nele.
            const { error } = await supabase.rpc('crm_merge_journeys', {
                p_primary: mergeTarget.id,
                p_duplicate: journey.id,
                p_actor: 'user',
            });
            if (error) throw error;
            showToast('success', t('timeline.merge.success', { defaultValue: 'Contatos mesclados com sucesso!' }));
            setMergeOpen(false);
            onClose();
        } catch (e: any) {
            showToast('error', e.message || t('timeline.merge.error', { defaultValue: 'Erro ao mesclar contatos.' }));
        } finally {
            setMerging(false);
        }
    };

    const handleClickCompleted = (apt: any) => {
        setProcedure(apt?.type?.name || '');
        setValue('');
        setOutcomeModal({ appointmentId: apt.id, dateLabel: `${apt.date} ${(apt.start_time || '').slice(0, 5)}` });
    };

    const handleSaveOutcome = async () => {
        if (!outcomeModal) return;
        setSaving(true);
        try {
            // Marca como concluída → trigger do CRM Journey Engine avança o card
            // automaticamente para "Compareceu" e mantém o kanban sincronizado.
            const { error: aptErr } = await supabase
                .from('appointments')
                .update({ status: 'completed' })
                .eq('id', outcomeModal.appointmentId);
            if (aptErr) throw aptErr;

            const revenueNum = parseFloat(value.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
            if (revenueNum > 0 || procedure.trim()) {
                await supabase.rpc('crm_move_stage', {
                    p_journey_id: journey.id,
                    p_to_stage: journey.stage_id === 'showed_up' ? 'proposal' : journey.stage_id,
                    p_actor: 'user',
                    p_extra: {
                        ...(revenueNum > 0 ? { revenue_estimated: revenueNum } : {}),
                        ...(procedure.trim() ? { procedure_name: procedure.trim() } : {}),
                    },
                }).then(({ error }) => {
                    // Transição pode ser no-op (mesmo estágio) — apenas os dados extras importam aqui.
                    if (error && error.code !== '22023') throw error;
                });
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

    const handleMarkNoShow = async (apt: any) => {
        setSavingNoShow(apt.id);
        try {
            // Marca como falta → trigger do CRM Journey Engine move o card para
            // "Recuperação" e a cadência automática de recuperação já é enfileirada.
            const { error: aptErr } = await supabase
                .from('appointments')
                .update({ status: 'noshow' })
                .eq('id', apt.id);
            if (aptErr) throw aptErr;

            showToast('success', t('timeline.toasts.noShowSuccess', { defaultValue: 'Falta registrada. Cadência de recuperação iniciada automaticamente.' }));
            refresh();
        } catch (e: any) {
            showToast('error', t('timeline.toasts.noShowError', { defaultValue: 'Erro ao registrar falta.' }));
        } finally {
            setSavingNoShow(null);
        }
    };

    const getEventIcon = (type: CrmTimelineEventType) => {
        switch (type) {
            case 'journey_created':        return <Play className="w-4 h-4 text-brand-primary" />;
            case 'appointment_created':
            case 'appointment_confirmed':   return <Calendar className="w-4 h-4 text-blue-500" />;
            case 'checked_in':               return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
            case 'appointment_completed':    return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
            case 'appointment_cancelled':    return <XCircle className="w-4 h-4 text-red-500" />;
            case 'no_show':                   return <AlertCircle className="w-4 h-4 text-orange-500" />;
            case 'message_sent':              return <MessageSquare className="w-4 h-4 text-indigo-500" />;
            case 'message_received':          return <User className="w-4 h-4 text-graphite-500" />;
            case 'stage_changed':             return <Activity className="w-4 h-4 text-purple-500" />;
            case 'automation_fired':          return <Zap className="w-4 h-4 text-amber-500" />;
            case 'note_added':                return <StickyNote className="w-4 h-4 text-graphite-500" />;
            default:                          return <Activity className="w-4 h-4 text-gray-500" />;
        }
    };

    const getEventColor = (type: CrmTimelineEventType) => {
        switch (type) {
            case 'journey_created':      return 'bg-brand-primary/10 border-brand-primary/20';
            case 'checked_in':
            case 'appointment_completed': return 'bg-emerald-50 border-emerald-100';
            case 'appointment_cancelled': return 'bg-red-50 border-red-100';
            case 'no_show':               return 'bg-orange-50 border-orange-100';
            case 'appointment_created':
            case 'appointment_confirmed': return 'bg-blue-50 border-blue-100';
            case 'message_sent':          return 'bg-indigo-50 border-indigo-100';
            case 'message_received':      return 'bg-gray-50 border-gray-100';
            case 'stage_changed':         return 'bg-purple-50 border-purple-100';
            case 'automation_fired':      return 'bg-amber-50 border-amber-100';
            default:                      return 'bg-ice-50 border-ice-100';
        }
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex justify-end z-[60] overflow-hidden">
                <div className="absolute inset-0 cursor-pointer" onClick={onClose} />

                <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                    <div className="p-6 border-b border-ice-100 flex items-center justify-between bg-ice-50/50 shrink-0">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-primary to-indigo-600 flex items-center justify-center shadow-inner">
                                <User className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-graphite-900 leading-tight">
                                    {displayName || t('timeline.unknownLead', { defaultValue: 'Lead Desconhecido' })}
                                </h2>
                                <p className="text-xs font-bold text-graphite-500 flex items-center gap-1 mt-0.5">
                                    {phoneFlag(phone)} {formatPhone(phone)}
                                </p>
                            </div>
                        </div>
                        <IconButton onClick={onClose} className="hover:bg-ice-100">
                            <X className="w-5 h-5" />
                        </IconButton>
                    </div>

                    <div className="px-6 py-3 border-b border-ice-100 bg-white flex items-center justify-between shrink-0">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-graphite-400 uppercase tracking-widest">{t('timeline.currentStage', { defaultValue: 'Fase Atual' })}</span>
                            <Badge accent="brand" size="sm" className="mt-0.5 w-fit">
                                {t(`stages.${CRM_STAGE_LABEL_KEYS[journey.stage_id as CrmStageId]}`)}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                            {journey.revenue_estimated > 0 && (
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] font-bold text-graphite-400 uppercase tracking-widest">{t('timeline.estimatedValue', { defaultValue: 'Valor Estimado' })}</span>
                                    <span className="text-sm font-black text-emerald-600">R$ {journey.revenue_estimated.toLocaleString('pt-BR')}</span>
                                </div>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => { setMergeSearch(''); setMergeTarget(null); setMergeOpen(true); }}>
                                <GitMerge className="w-4 h-4" />
                                {t('timeline.merge.action', { defaultValue: 'Mesclar' })}
                            </Button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 bg-white custom-scrollbar relative">
                        {/* Ação rápida: agendamentos passados sem resultado registrado */}
                        {pendingAppointments.length > 0 && (
                            <div className="mb-6 space-y-3">
                                {pendingAppointments.map(apt => {
                                    const isLoadingNoShow = savingNoShow === apt.id;
                                    return (
                                        <div key={apt.id} className="p-4 rounded-2xl border border-amber-200 bg-amber-50/60">
                                            <p className="text-[10px] font-black text-amber-700 uppercase tracking-wider mb-1">
                                                {apt.date} {(apt.start_time || '').slice(0, 5)}
                                            </p>
                                            <p className="text-xs font-bold text-graphite-700 mb-3">
                                                {t('timeline.outcome.label', { defaultValue: 'Registrar resultado desta consulta' })}
                                            </p>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleClickCompleted(apt)}
                                                    className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black py-2 px-3 rounded-xl transition-colors border-none cursor-pointer"
                                                >
                                                    <CheckCircle2 size={14} />
                                                    {t('timeline.outcome.attended', { defaultValue: 'Compareceu' })}
                                                </button>
                                                <button
                                                    onClick={() => handleMarkNoShow(apt)}
                                                    disabled={isLoadingNoShow}
                                                    className="flex-1 flex items-center justify-center gap-1.5 bg-orange-100 hover:bg-orange-200 text-orange-700 text-xs font-black py-2 px-3 rounded-xl transition-colors border-none cursor-pointer disabled:opacity-60"
                                                >
                                                    {isLoadingNoShow ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
                                                    {t('timeline.outcome.noShow', { defaultValue: 'Não compareceu' })}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

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
                                {events.map((event: CrmTimelineEvent) => (
                                    <div key={event.id} className="relative flex items-start justify-normal group mb-8 last:mb-0">
                                        <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-ice-50 shadow-sm shrink-0 z-10 mt-1 transition-transform group-hover:scale-110">
                                            {getEventIcon(event.type)}
                                        </div>
                                        <div className={`w-[calc(100%-3rem)] ml-4 p-4 rounded-2xl border shadow-sm transition-all duration-300 hover:shadow-md ${getEventColor(event.type)}`}>
                                            <div className="flex items-center justify-between mb-2">
                                                <h3 className="text-sm font-black text-graphite-900">{event.title}</h3>
                                                <span className="text-[10px] font-bold text-graphite-500 uppercase tracking-wider bg-white/60 px-2 py-0.5 rounded-md backdrop-blur-sm shrink-0">
                                                    {formatDate(event.date, { hour: '2-digit', minute: '2-digit', month: 'short', day: '2-digit' })}
                                                </span>
                                            </div>
                                            {event.subtitle && (
                                                <p className="text-xs text-graphite-600 font-medium leading-relaxed">{event.subtitle}</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal de Merge de Contato */}
            {mergeOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-white/20 animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-ice-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-brand-secondary/30 flex items-center justify-center">
                                    <GitMerge className="w-5 h-5 text-brand-primary" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-graphite-900">{t('timeline.merge.title', { defaultValue: 'Mesclar Contato' })}</h3>
                                    <p className="text-xs text-graphite-500 font-medium">
                                        {t('timeline.merge.subtitle', { defaultValue: 'Este card será fundido no contato selecionado.' })}
                                    </p>
                                </div>
                            </div>
                            <IconButton onClick={() => setMergeOpen(false)}>
                                <X className="w-5 h-5" />
                            </IconButton>
                        </div>

                        <div className="p-6 space-y-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite-400" />
                                <input
                                    type="text"
                                    value={mergeSearch}
                                    onChange={(e) => { setMergeSearch(e.target.value); setMergeTarget(null); }}
                                    placeholder={t('timeline.merge.searchPlaceholder', { defaultValue: 'Buscar por nome ou telefone...' })}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-9 pr-4 py-3 text-sm focus:ring-2 focus:ring-brand-primary focus:border-transparent outline-none transition-all"
                                    autoFocus
                                />
                            </div>

                            <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                                {filteredCandidates.length === 0 ? (
                                    <p className="text-xs font-bold text-graphite-400 text-center py-6">
                                        {t('timeline.merge.empty', { defaultValue: 'Nenhum contato encontrado.' })}
                                    </p>
                                ) : filteredCandidates.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => setMergeTarget(c)}
                                        className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-all cursor-pointer ${
                                            mergeTarget?.id === c.id
                                                ? 'bg-brand-secondary/20 border-brand-primary text-graphite-900'
                                                : 'bg-ice-50 border-ice-200 text-graphite-600 hover:border-ice-300'
                                        }`}
                                    >
                                        <span className="font-black block truncate">{c.label}</span>
                                        <span className="text-[10px] font-bold text-graphite-400 uppercase tracking-wider">{c.sublabel}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="p-6 bg-ice-50 rounded-b-3xl flex gap-3">
                            <Button variant="ghost" className="flex-1 justify-center" onClick={() => setMergeOpen(false)}>
                                {t('timeline.outcomeModal.cancel', { defaultValue: 'Cancelar' })}
                            </Button>
                            <Button variant="primary" className="flex-1 justify-center" disabled={!mergeTarget || merging} onClick={handleMerge}>
                                {merging ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
                                {t('timeline.merge.confirm', { defaultValue: 'Mesclar Contatos' })}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

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
