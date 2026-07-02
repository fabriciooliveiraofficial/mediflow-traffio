import { useMemo, useState } from 'react';
import {
    MessageSquare, Inbox, CalendarPlus, AlarmClock, Check,
    AlertTriangle, CheckCircle2, Loader2, Send, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';
import { Badge, Button, IconButton, EmptyState } from '../ui';
import { CRM_STAGE_LABEL_KEYS, NEXT_ACTION_LABEL_KEYS, type CrmStageId } from '../../lib/crmStages';
import type { CrmJourney } from '../../pages/FollowUpBoard';

type QueueMode = 'action' | 'all';

interface WorkQueueProps {
    journeys: CrmJourney[];
    displayName: (j: CrmJourney) => string;
    displaySubtitle: (j: CrmJourney) => string;
    journeyChannels: (j: CrmJourney) => string[];
    onOpenJourney: (j: CrmJourney) => void;
    onOpenConversation: (j: CrmJourney) => void;
    onBook: (j: CrmJourney) => void;
    onPatch: (id: string, patch: Partial<CrmJourney>) => void;
    onRefresh: () => void;
}

/**
 * Fila de Trabalho — a superfície operável do CRM.
 * Cada linha responde "quem eu contato agora e por quê" e resolve a ação
 * sem sair da página: mensagem direta, conversa, agendamento, adiar, concluir.
 */
export function WorkQueue({
    journeys, displayName, displaySubtitle, journeyChannels,
    onOpenJourney, onOpenConversation, onBook, onPatch, onRefresh,
}: WorkQueueProps) {
    const { t } = useTranslation('crm');
    const { showToast } = useToast();
    const { formatDateTime } = useLocaleFormat();

    const [mode, setMode] = useState<QueueMode>('action');
    const [msgModal, setMsgModal] = useState<CrmJourney | null>(null);
    const [msgText, setMsgText] = useState('');
    const [sending, setSending] = useState(false);
    const [actingOn, setActingOn] = useState<string | null>(null);
    const [justHandled, setJustHandled] = useState<string | null>(null);

    // Destaque temporário na linha após uma ação — feedback inequívoco mesmo
    // no modo "Todos abertos", onde a linha não sai da lista
    const flashHandled = (id: string) => {
        setJustHandled(id);
        setTimeout(() => setJustHandled(prev => (prev === id ? null : prev)), 1600);
    };

    const now = Date.now();

    const rows = useMemo(() => {
        const open = journeys.filter(j => !['won', 'lost'].includes(j.stage_id));
        const needing = open.filter(j =>
            j.needs_action || (j.next_action_at && new Date(j.next_action_at).getTime() <= now)
        );
        const list = mode === 'action' ? needing : open;
        return [...list].sort((a, b) => b.priority_score - a.priority_score);
    }, [journeys, mode, now]);

    const actionCount = useMemo(() =>
        journeys.filter(j =>
            !['won', 'lost'].includes(j.stage_id)
            && (j.needs_action || (j.next_action_at && new Date(j.next_action_at).getTime() <= now))
        ).length,
    [journeys, now]);

    // "Por que este card está na fila" — a linha de contexto que elimina a
    // necessidade de abrir cada card para entender o que fazer
    const reasonFor = (j: CrmJourney): { text: string; urgent: boolean } => {
        if (j.stage_id === 'recovery' && j.no_show_count > 0) {
            return { text: t('workQueue.reason.noShowRecovery', { count: j.no_show_count }), urgent: true };
        }
        if (j.stage_id === 'recall_due') {
            return { text: t('workQueue.reason.recallDue'), urgent: false };
        }
        if (j.next_action_at) {
            const dueMs = new Date(j.next_action_at).getTime();
            if (dueMs <= now) {
                const hours = Math.max(1, Math.floor((now - dueMs) / 3600000));
                return { text: t('workQueue.reason.overdue', { hours }), urgent: true };
            }
            return {
                text: t('workQueue.reason.dueAt', {
                    action: j.next_action_type ? t(`followUp.${NEXT_ACTION_LABEL_KEYS[j.next_action_type]}`) : t('workQueue.reason.genericAction'),
                    date: formatDateTime(j.next_action_at),
                }),
                urgent: false,
            };
        }
        if (j.needs_action) {
            return { text: t('workQueue.reason.slaBreached'), urgent: true };
        }
        return { text: t('workQueue.reason.upToDate'), urgent: false };
    };

    const handleSnooze = async (j: CrmJourney) => {
        setActingOn(j.id);
        const nextAt = new Date(Date.now() + 24 * 3600000).toISOString();
        // Otimista: a linha reage no instante do clique
        onPatch(j.id, { needs_action: false, next_action_at: nextAt });
        flashHandled(j.id);

        const { error } = await supabase
            .from('crm_journeys')
            .update({ needs_action: false, next_action_at: nextAt })
            .eq('id', j.id);
        setActingOn(null);
        if (error) {
            showToast('error', error.message);
            onRefresh(); // reverte o patch otimista
        } else {
            showToast('success', t('workQueue.toasts.snoozed'));
        }
    };

    const handleDone = async (j: CrmJourney) => {
        setActingOn(j.id);
        onPatch(j.id, { needs_action: false, next_action_at: null });
        flashHandled(j.id);

        const { error } = await supabase
            .from('crm_journeys')
            .update({ needs_action: false, next_action_at: null })
            .eq('id', j.id);
        setActingOn(null);
        if (error) {
            showToast('error', error.message);
            onRefresh();
        } else {
            showToast('success', t('workQueue.toasts.done'));
        }
    };

    const handleSend = async () => {
        if (!msgModal || !msgText.trim()) return;
        setSending(true);
        try {
            const { error } = await supabase.rpc('crm_send_manual_message', {
                p_journey_id: msgModal.id,
                p_message: msgText.trim(),
            });
            if (error) throw error;
            onPatch(msgModal.id, {
                needs_action: false,
                next_action_at: new Date(Date.now() + 24 * 3600000).toISOString(),
                next_action_type: 'message',
            });
            flashHandled(msgModal.id);
            showToast('success', t('workQueue.toasts.messageSent'));
            setMsgModal(null);
            setMsgText('');
        } catch (e: any) {
            showToast('error', e.message || t('workQueue.toasts.messageError'));
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Modo da fila */}
            <div className="flex items-center justify-between">
                <div className="flex bg-ice-100 p-1 rounded-xl border border-ice-200">
                    {([
                        { key: 'action', label: t('workQueue.modes.needsAction'), count: actionCount },
                        { key: 'all', label: t('workQueue.modes.allOpen'), count: null },
                    ] as { key: QueueMode; label: string; count: number | null }[]).map(m => (
                        <button
                            key={m.key}
                            onClick={() => setMode(m.key)}
                            className={`flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                                mode === m.key ? 'bg-white text-brand-primary shadow-sm' : 'text-graphite-500 hover:text-graphite-800'
                            }`}
                        >
                            {m.label}
                            {m.count !== null && m.count > 0 && <Badge accent="warning" size="sm">{m.count}</Badge>}
                        </button>
                    ))}
                </div>
            </div>

            {/* Fila */}
            {rows.length === 0 ? (
                <div className="bg-white rounded-2xl border border-ice-100 shadow-float py-16">
                    <EmptyState
                        icon={CheckCircle2}
                        label={mode === 'action' ? t('workQueue.emptyAction') : t('workQueue.emptyAll')}
                    />
                </div>
            ) : (
                <div className="space-y-2.5">
                    {rows.map(j => {
                        const reason = reasonFor(j);
                        const channels = journeyChannels(j);
                        const busy = actingOn === j.id;

                        return (
                            <div
                                key={j.id}
                                className={`group bg-white rounded-2xl border shadow-float p-4 flex items-center gap-4 transition-all duration-500 hover:border-brand-primary/40 ${
                                    justHandled === j.id
                                        ? 'border-accent-success ring-2 ring-accent-success/30 bg-accent-success/5'
                                        : reason.urgent ? 'border-amber-200' : 'border-ice-100'
                                }`}
                            >
                                {/* Score */}
                                <div className="shrink-0 w-12 text-center">
                                    <span className={`text-lg font-black tracking-tight ${
                                        j.priority_score >= 60 ? 'text-accent-error' : j.priority_score >= 30 ? 'text-accent-warning' : 'text-graphite-400'
                                    }`}>
                                        {j.priority_score}
                                    </span>
                                    <p className="text-[8px] font-black text-graphite-300 uppercase tracking-widest">{t('workQueue.scoreLabel')}</p>
                                </div>

                                {/* Identidade */}
                                <button
                                    onClick={() => onOpenJourney(j)}
                                    className="min-w-0 flex-1 text-left cursor-pointer"
                                >
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-black text-graphite-900 truncate">{displayName(j)}</span>
                                        <Badge accent="brand" size="sm">{t(`stages.${CRM_STAGE_LABEL_KEYS[j.stage_id as CrmStageId]}`)}</Badge>
                                        {channels.filter(c => channels.length > 1 || !['whatsapp', 'phone', 'sms'].includes(c)).map(c => (
                                            <Badge key={c} accent="info" size="sm">{t(`followUp.channelChip.${c}`, { defaultValue: c })}</Badge>
                                        ))}
                                        {j.no_show_count > 0 && (
                                            <Badge accent="error" size="sm"><AlertTriangle className="w-3 h-3" />{j.no_show_count}</Badge>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1">
                                        <span className={`text-xs font-bold ${reason.urgent ? 'text-amber-600' : 'text-graphite-500'}`}>
                                            {reason.text}
                                        </span>
                                        <span className="text-[10px] font-bold text-graphite-400 uppercase tracking-wider">{displaySubtitle(j)}</span>
                                        {j.next_appointment_at && (
                                            <span className="text-[10px] font-bold text-graphite-400">
                                                {t('workQueue.nextAppointment', { date: formatDateTime(j.next_appointment_at) })}
                                            </span>
                                        )}
                                    </div>
                                </button>

                                {/* Ações inline */}
                                <div className="shrink-0 flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                    <IconButton
                                        title={t('workQueue.actions.message')}
                                        onClick={() => { setMsgText(''); setMsgModal(j); }}
                                    >
                                        <MessageSquare className="w-4 h-4" />
                                    </IconButton>
                                    <IconButton
                                        title={t('workQueue.actions.conversation')}
                                        onClick={() => onOpenConversation(j)}
                                        disabled={!j.session_id}
                                        className={!j.session_id ? 'opacity-30 cursor-not-allowed' : ''}
                                    >
                                        <Inbox className="w-4 h-4" />
                                    </IconButton>
                                    <IconButton title={t('workQueue.actions.book')} onClick={() => onBook(j)}>
                                        <CalendarPlus className="w-4 h-4" />
                                    </IconButton>
                                    <IconButton title={t('workQueue.actions.snooze')} onClick={() => handleSnooze(j)} disabled={busy}>
                                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlarmClock className="w-4 h-4" />}
                                    </IconButton>
                                    <IconButton title={t('workQueue.actions.done')} onClick={() => handleDone(j)} disabled={busy}>
                                        <Check className="w-4 h-4" />
                                    </IconButton>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal de mensagem rápida */}
            {msgModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-white/20 animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-ice-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-brand-secondary/30 flex items-center justify-center">
                                    <MessageSquare className="w-5 h-5 text-brand-primary" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-graphite-900">{t('workQueue.messageModal.title')}</h3>
                                    <p className="text-xs text-graphite-500 font-medium truncate max-w-[240px]">{displayName(msgModal)}</p>
                                </div>
                            </div>
                            <IconButton onClick={() => setMsgModal(null)}><X className="w-5 h-5" /></IconButton>
                        </div>
                        <div className="p-6">
                            <textarea
                                value={msgText}
                                onChange={(e) => setMsgText(e.target.value)}
                                rows={4}
                                autoFocus
                                placeholder={t('workQueue.messageModal.placeholder')}
                                className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-primary focus:border-transparent outline-none transition-all resize-none"
                            />
                            <p className="text-[11px] font-medium text-graphite-400 mt-2">
                                {t('workQueue.messageModal.hint')}
                            </p>
                        </div>
                        <div className="p-6 bg-ice-50 rounded-b-3xl flex gap-3">
                            <Button variant="ghost" className="flex-1 justify-center" onClick={() => setMsgModal(null)}>
                                {t('followUp.saleModal.cancel')}
                            </Button>
                            <Button variant="primary" className="flex-1 justify-center" disabled={!msgText.trim() || sending} onClick={handleSend}>
                                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                {t('workQueue.messageModal.send')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
