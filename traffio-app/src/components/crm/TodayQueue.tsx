import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
    MoreHorizontal, MessageSquare, Inbox, CalendarPlus, AlarmClock, Check,
    User, FileText, Loader2, Send, X, CheckCircle2, ChevronDown, AlertTriangle,
    Archive, Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';
import { Badge, Button, IconButton, EmptyState } from '../ui';
import { CRM_STAGE_LABEL_KEYS, type CrmStageId } from '../../lib/crmStages';
import {
    classifyJourney, compareWithinGroup, shortElapsed,
    type JourneyActivity, type PrimaryAction, type TodayClassification, type TodayGroup,
} from '../../lib/followUpToday';
import type { CrmJourney } from '../../pages/FollowUpBoard';

/** Contato parado há mais que isso (sem consulta marcada) entra no aviso de limpeza. */
const STALE_DAYS = 30;
const BULK_LIMIT = 50;

export type JourneyChannel = 'whatsapp' | 'instagram' | 'facebook' | 'livechat' | 'sms' | 'phone' | 'walk_in';

interface TodayQueueProps {
    journeys: CrmJourney[];
    activity: Record<string, JourneyActivity>;
    stageFilter: CrmStageId | null;
    onClearFilter: () => void;
    displayName: (j: CrmJourney) => string;
    hasRealName: (j: CrmJourney) => boolean;
    primaryChannel: (j: CrmJourney) => JourneyChannel;
    onOpenJourney: (j: CrmJourney) => void;
    onOpenConversation: (j: CrmJourney) => void;
    onBook: (j: CrmJourney) => void;
    onProposal: (j: CrmJourney) => void;
    onPatch: (id: string, patch: Partial<CrmJourney>) => void;
    onRefresh: () => void;
}

export const CHANNEL_DOT: Record<JourneyChannel, string> = {
    whatsapp: 'bg-emerald-500',
    instagram: 'bg-pink-500',
    facebook: 'bg-blue-600',
    livechat: 'bg-indigo-500',
    sms: 'bg-amber-600',
    phone: 'bg-amber-600',
    walk_in: 'bg-stone-500',
};

const ACTION_ICON: Record<PrimaryAction, typeof MessageSquare> = {
    reply: MessageSquare,
    reschedule: CalendarPlus,
    proposal: FileText,
    confirm: Check,
    review: AlertTriangle,
    open: User,
};

function initials(name: string): string {
    const parts = name.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/**
 * Lista "Hoje" do Follow-up: quem precisa de você agora, em três grupos com nome
 * de tarefa. Cada linha tem uma frase do que a pessoa pediu, há quanto tempo
 * espera e um único botão com texto; o resto fica no menu "⋯".
 */
export function TodayQueue({
    journeys, activity, stageFilter, onClearFilter, displayName, hasRealName, primaryChannel,
    onOpenJourney, onOpenConversation, onBook, onProposal, onPatch, onRefresh,
}: TodayQueueProps) {
    const { t } = useTranslation('crm');
    const { showToast } = useToast();
    const { formatDateTime } = useLocaleFormat();

    const [showOk, setShowOk] = useState(false);
    const [menuFor, setMenuFor] = useState<string | null>(null);
    const [msgModal, setMsgModal] = useState<CrmJourney | null>(null);
    const [msgText, setMsgText] = useState('');
    const [sending, setSending] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [justHandled, setJustHandled] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkMessage, setBulkMessage] = useState(false);
    const [archiveConfirm, setArchiveConfirm] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [cleanupDismissed, setCleanupDismissed] = useState(false);

    const nowMs = Date.now();

    const groups = useMemo(() => {
        const open = journeys.filter(j => !['won', 'lost'].includes(j.stage_id))
            .filter(j => !stageFilter || j.stage_id === stageFilter);
        const buckets: Record<TodayGroup, { j: CrmJourney; c: TodayClassification }[]> = { now: [], today: [], ok: [] };
        for (const j of open) {
            const c = classifyJourney(j, activity[j.id], nowMs);
            buckets[c.group].push({ j, c });
        }
        (Object.keys(buckets) as TodayGroup[]).forEach(g => buckets[g].sort(compareWithinGroup));
        return buckets;
        // nowMs muda a cada render; recalcular só quando os dados mudam é suficiente
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [journeys, activity, stageFilter]);

    // Aviso de limpeza: contatos sem nenhuma conversa há 30+ dias e sem consulta marcada.
    // Só sugere — nada é arquivado sem confirmação (decisão aprovada em 15/09/2026).
    const staleIds = useMemo(() => {
        const limit = Date.now() - STALE_DAYS * 86_400_000;
        return journeys
            .filter(j => ['new_lead', 'in_contact', 'recall_due'].includes(j.stage_id))
            .filter(j => !j.next_appointment_at || new Date(j.next_appointment_at).getTime() < Date.now())
            .filter(j => new Date(activity[j.id]?.lastAt || j.last_event_at).getTime() < limit)
            .map(j => j.id);
    }, [journeys, activity]);

    // Seleção só vale para contatos visíveis (some quando saem da lista)
    useEffect(() => {
        const visible = new Set(journeys.map(j => j.id));
        setSelected(prev => {
            const next = new Set([...prev].filter(id => visible.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [journeys]);

    const toggleSelect = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const selectMany = (ids: string[]) => setSelected(prev => {
        const all = ids.every(id => prev.has(id));
        const next = new Set(prev);
        ids.forEach(id => (all ? next.delete(id) : next.add(id)));
        return next;
    });

    const selectedJourneys = journeys.filter(j => selected.has(j.id)).slice(0, BULK_LIMIT);
    const anySelected = selected.size > 0;

    const runBulk = async (label: string, fn: (j: CrmJourney) => Promise<{ error: any }>) => {
        setBulkBusy(true);
        let ok = 0;
        for (const j of selectedJourneys) {
            const { error } = await fn(j);
            if (!error) ok++;
        }
        setBulkBusy(false);
        setSelected(new Set());
        onRefresh();
        showToast(ok === selectedJourneys.length ? 'success' : 'warning',
            t('today.bulk.result', { action: label, ok, total: selectedJourneys.length }));
    };

    const bulkSnooze = () => {
        const nextAt = new Date(Date.now() + 24 * 3600_000).toISOString();
        return runBulk(t('today.bulk.snooze'), async (j) =>
            supabase.from('crm_journeys').update({ needs_action: false, next_action_at: nextAt }).eq('id', j.id));
    };

    const bulkDone = () => runBulk(t('today.bulk.done'), async (j) =>
        supabase.from('crm_journeys').update({ needs_action: false, next_action_at: null }).eq('id', j.id));

    const bulkArchive = async () => {
        setArchiveConfirm(false);
        await runBulk(t('today.bulk.archive'), async (j) =>
            supabase.rpc('crm_move_stage', { p_journey_id: j.id, p_to_stage: 'lost', p_actor: 'user', p_reason: 'no_response' }));
    };

    const flash = (id: string) => {
        setJustHandled(id);
        setTimeout(() => setJustHandled(prev => (prev === id ? null : prev)), 1600);
    };

    const handleSnooze = async (j: CrmJourney) => {
        setBusyId(j.id);
        const nextAt = new Date(Date.now() + 24 * 3600_000).toISOString();
        onPatch(j.id, { needs_action: false, next_action_at: nextAt });
        flash(j.id);
        const { error } = await supabase.from('crm_journeys').update({ needs_action: false, next_action_at: nextAt }).eq('id', j.id);
        setBusyId(null);
        if (error) { showToast('error', error.message); onRefresh(); } else { showToast('success', t('today.toasts.snoozed')); }
    };

    const handleDone = async (j: CrmJourney) => {
        setBusyId(j.id);
        onPatch(j.id, { needs_action: false, next_action_at: null });
        flash(j.id);
        const { error } = await supabase.from('crm_journeys').update({ needs_action: false, next_action_at: null }).eq('id', j.id);
        setBusyId(null);
        if (error) { showToast('error', error.message); onRefresh(); } else { showToast('success', t('today.toasts.done')); }
    };

    const handleSend = async () => {
        if (bulkMessage) {
            if (!msgText.trim()) return;
            const text = msgText.trim();
            setBulkMessage(false);
            setMsgText('');
            await runBulk(t('today.bulk.message'), async (j) =>
                supabase.rpc('crm_send_manual_message', { p_journey_id: j.id, p_message: text }));
            return;
        }
        if (!msgModal || !msgText.trim()) return;
        setSending(true);
        try {
            const { data, error } = await supabase.rpc('crm_send_manual_message', {
                p_journey_id: msgModal.id,
                p_message: msgText.trim(),
            });
            if (error) throw error;
            const res = data as { scheduled_at: string; delayed: boolean; timezone: string; window_start: string; window_end: string } | null;
            onPatch(msgModal.id, {
                needs_action: false,
                next_action_at: new Date((res?.scheduled_at ? new Date(res.scheduled_at).getTime() : Date.now()) + 24 * 3600_000).toISOString(),
                next_action_type: 'message',
            });
            flash(msgModal.id);
            if (res?.delayed) {
                const when = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: res.timezone })
                    .format(new Date(res.scheduled_at));
                showToast('warning', t('today.toasts.messageDelayed', { start: res.window_start, end: res.window_end, time: when }));
            } else {
                showToast('success', t('today.toasts.messageSent'));
            }
            setMsgModal(null);
            setMsgText('');
        } catch (e: any) {
            showToast('error', e.message || t('today.toasts.messageError'));
        } finally {
            setSending(false);
        }
    };

    const openMessage = (j: CrmJourney) => { setMsgText(''); setMsgModal(j); };

    const runPrimary = (j: CrmJourney, action: PrimaryAction) => {
        switch (action) {
            case 'reply':
            case 'confirm':
                return j.session_id ? onOpenConversation(j) : openMessage(j);
            case 'reschedule':
                return onBook(j);
            case 'proposal':
                return onProposal(j);
            case 'review':
            case 'open':
                return onOpenJourney(j);
        }
    };

    const reasonText = (c: TodayClassification) => {
        const r = c.reason;
        return t(`today.reason.${r.key}`, {
            time: shortElapsed(r.since, nowMs),
            date: r.at ? formatDateTime(r.at) : '',
        });
    };

    const snippetFor = (j: CrmJourney): string | null => {
        const a = activity[j.id];
        if (!a?.lastType) return null;
        if (a.lastPreview && ['message_received', 'message_sent'].includes(a.lastType)) {
            return `“${a.lastPreview.trim().replace(/^["“”']+|["“”']+$/g, '')}”`;
        }
        const label = t(`today.lastEvent.${a.lastType}`, { defaultValue: '' });
        if (!label) return null;
        return a.lastPreview ? `${label} · ${a.lastPreview}` : label;
    };

    const total = groups.now.length + groups.today.length + groups.ok.length;

    const renderRow = ({ j, c }: { j: CrmJourney; c: TodayClassification }) => {
        const name = displayName(j);
        const channel = primaryChannel(j);
        const ActionIcon = ACTION_ICON[c.action];
        const snippet = snippetFor(j);
        const busy = busyId === j.id;
        const ini = hasRealName(j) ? initials(name) : '';

        return (
            <li
                key={j.id}
                className={clsx(
                    'relative bg-white rounded-2xl border shadow-sm transition-all duration-500',
                    justHandled === j.id ? 'border-accent-success ring-2 ring-accent-success/20'
                        : c.group === 'now' ? 'border-ice-100 border-l-4 border-l-accent-error'
                        : c.group === 'today' ? 'border-ice-100 border-l-4 border-l-accent-warning'
                        : 'border-ice-100',
                )}
            >
                <div className="group flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                    <label
                        className={clsx(
                            'shrink-0 flex items-center justify-center w-6 h-6 -ml-1 cursor-pointer transition-opacity',
                            anySelected || selected.has(j.id) ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100',
                        )}
                    >
                        <input
                            type="checkbox"
                            checked={selected.has(j.id)}
                            onChange={() => toggleSelect(j.id)}
                            aria-label={t('today.bulk.selectOne', { name })}
                            className="w-4 h-4 rounded accent-brand-primary cursor-pointer"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={() => onOpenJourney(j)}
                        className="flex items-center gap-3.5 min-w-0 flex-1 basis-64 text-left bg-transparent border-none cursor-pointer p-0"
                    >
                        <span className="relative shrink-0 w-10 h-10 rounded-full bg-ice-100 flex items-center justify-center text-xs font-black text-graphite-500">
                            {ini || <User className="w-4 h-4 text-graphite-400" />}
                            <span
                                className={clsx('absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 rounded-full border-2 border-white', CHANNEL_DOT[channel])}
                                title={t(`today.channel.${channel}`)}
                            />
                        </span>
                        <span className="min-w-0 flex flex-col gap-0.5">
                            <span className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-black text-graphite-900 truncate">{name}</span>
                                {j.next_appointment_status === 'confirmed' && (
                                    <Badge accent="success" size="sm" className="shrink-0">{t('today.badges.confirmed')}</Badge>
                                )}
                                {j.no_show_count > 0 && (
                                    <Badge accent="error" size="sm" className="shrink-0">{t('today.badges.noShows', { count: j.no_show_count })}</Badge>
                                )}
                            </span>
                            {snippet && <span className="text-[13px] text-graphite-500 truncate">{snippet}</span>}
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-bold min-w-0">
                                <span className={clsx('sm:truncate', c.group === 'now' ? 'text-accent-error' : c.group === 'today' ? 'text-accent-warning' : 'text-graphite-400')}>
                                    {reasonText(c)}
                                </span>
                                <span className="text-graphite-300" aria-hidden="true">·</span>
                                <span className="text-graphite-400 font-medium shrink-0">{t(`stages.${CRM_STAGE_LABEL_KEYS[j.stage_id as CrmStageId]}`)}</span>
                            </span>
                        </span>
                    </button>

                    <div className="flex items-center gap-2 shrink-0 ml-auto">
                        <Button
                            size="sm"
                            variant={c.group === 'ok' ? 'ghost' : 'primary'}
                            onClick={() => runPrimary(j, c.action)}
                            className="hover:scale-100"
                        >
                            <ActionIcon className="w-3.5 h-3.5" />
                            {t(`today.actions.${c.action}`)}
                        </Button>
                        <RowMenu
                            open={menuFor === j.id}
                            onToggle={() => setMenuFor(prev => (prev === j.id ? null : j.id))}
                            onClose={() => setMenuFor(null)}
                            label={t('today.menu.label', { name })}
                            items={[
                                ...(j.session_id ? [{ key: 'conversation', icon: Inbox, label: t('today.menu.conversation'), run: () => onOpenConversation(j) }] : []),
                                { key: 'message', icon: Send, label: t('today.menu.message'), run: () => openMessage(j) },
                                { key: 'book', icon: CalendarPlus, label: t('today.menu.book'), run: () => onBook(j) },
                                ...(c.group !== 'ok' ? [
                                    { key: 'snooze', icon: AlarmClock, label: t('today.menu.snooze'), run: () => handleSnooze(j), disabled: busy },
                                    { key: 'done', icon: CheckCircle2, label: t('today.menu.done'), run: () => handleDone(j), disabled: busy },
                                ] : []),
                                { key: 'open', icon: User, label: t('today.menu.open'), run: () => onOpenJourney(j) },
                            ]}
                        />
                    </div>
                </div>
            </li>
        );
    };

    const header = (group: TodayGroup, count: number) => {
        const ids = groups[group].map(x => x.j.id);
        const allOn = ids.length > 0 && ids.every(id => selected.has(id));
        return (
            <div className="flex items-center gap-2.5">
                <h3 className="flex items-center gap-2.5 text-xs font-black uppercase tracking-wider m-0">
                    <span className={clsx('w-2 h-2 rounded-full',
                        group === 'now' ? 'bg-accent-error' : group === 'today' ? 'bg-accent-warning' : 'bg-graphite-300')} />
                    <span className={group === 'now' ? 'text-accent-error' : group === 'today' ? 'text-accent-warning' : 'text-graphite-400'}>
                        {t(`today.groups.${group}`)}
                    </span>
                    <span className="text-graphite-400 font-bold tabular-nums">{count}</span>
                </h3>
                <span className="flex-1 h-px bg-ice-200" />
                <button
                    type="button"
                    onClick={() => selectMany(ids)}
                    className="text-[11px] font-bold text-graphite-500 hover:text-brand-primary bg-transparent border-none cursor-pointer"
                >
                    {allOn ? t('today.bulk.unselectGroup') : t('today.bulk.selectGroup')}
                </button>
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-6">
            {stageFilter && (
                <div className="flex items-center gap-2 text-xs font-bold text-graphite-500">
                    {t('today.filteredBy', { stage: t(`stages.${CRM_STAGE_LABEL_KEYS[stageFilter]}`) })}
                    <button type="button" onClick={onClearFilter} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-ice-100 border border-ice-200/60 text-graphite-600 hover:bg-ice-200 cursor-pointer">
                        <X className="w-3 h-3" /> {t('today.clearFilter')}
                    </button>
                </div>
            )}

            {!cleanupDismissed && staleIds.length >= 3 && !stageFilter && (
                <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl bg-accent-warning/10 border border-accent-warning/20">
                    <Sparkles className="w-5 h-5 text-accent-warning shrink-0" />
                    <p className="flex-1 basis-60 text-sm font-bold text-graphite-800 m-0">
                        {t('today.cleanup.message', { count: staleIds.length, days: STALE_DAYS })}
                        <span className="block text-xs font-medium text-graphite-500 mt-0.5">{t('today.cleanup.hint')}</span>
                    </p>
                    <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setCleanupDismissed(true)}>{t('today.cleanup.dismiss')}</Button>
                        <Button size="sm" className="hover:scale-100" onClick={() => setSelected(new Set(staleIds.slice(0, BULK_LIMIT)))}>
                            {t('today.cleanup.select', { count: Math.min(staleIds.length, BULK_LIMIT) })}
                        </Button>
                    </div>
                </div>
            )}

            {anySelected && (
                <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-graphite-900 text-white shadow-2xl">
                    <span className="text-sm font-black px-2">
                        {t('today.bulk.selected', { count: selected.size })}
                        {selected.size > BULK_LIMIT && <span className="font-medium text-white/60"> · {t('today.bulk.limit', { max: BULK_LIMIT })}</span>}
                    </span>
                    <span className="flex-1" />
                    {bulkBusy ? (
                        <span className="flex items-center gap-2 text-sm font-bold px-3"><Loader2 className="w-4 h-4 animate-spin" /> {t('today.bulk.working')}</span>
                    ) : (
                        <>
                            <button type="button" onClick={() => { setMsgText(''); setBulkMessage(true); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 border-none text-white cursor-pointer"><Send className="w-3.5 h-3.5" />{t('today.bulk.message')}</button>
                            <button type="button" onClick={bulkSnooze} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 border-none text-white cursor-pointer"><AlarmClock className="w-3.5 h-3.5" />{t('today.bulk.snooze')}</button>
                            <button type="button" onClick={bulkDone} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 border-none text-white cursor-pointer"><CheckCircle2 className="w-3.5 h-3.5" />{t('today.bulk.done')}</button>
                            <button type="button" onClick={() => setArchiveConfirm(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-accent-error hover:bg-accent-error/90 border-none text-white cursor-pointer"><Archive className="w-3.5 h-3.5" />{t('today.bulk.archive')}</button>
                            <button type="button" onClick={() => setSelected(new Set())} aria-label={t('today.bulk.clear')} className="flex items-center justify-center w-8 h-8 rounded-xl bg-transparent hover:bg-white/10 border-none text-white cursor-pointer"><X className="w-4 h-4" /></button>
                        </>
                    )}
                </div>
            )}

            {total === 0 ? (
                <EmptyState
                    icon={CheckCircle2}
                    label={stageFilter ? t('today.emptyFiltered', { stage: t(`stages.${CRM_STAGE_LABEL_KEYS[stageFilter]}`) }) : t('today.empty')}
                    className="bg-white"
                />
            ) : (
                <>
                    {groups.now.length === 0 && groups.today.length === 0 && (
                        <div className="flex items-center gap-3 p-5 rounded-2xl bg-accent-success/10 text-accent-success text-sm font-bold">
                            <CheckCircle2 className="w-5 h-5 shrink-0" /> {t('today.allClear')}
                        </div>
                    )}

                    {groups.now.length > 0 && (
                        <section className="flex flex-col gap-3">
                            {header('now', groups.now.length)}
                            <ul className="flex flex-col gap-2.5 list-none p-0 m-0">{groups.now.map(renderRow)}</ul>
                        </section>
                    )}

                    {groups.today.length > 0 && (
                        <section className="flex flex-col gap-3">
                            {header('today', groups.today.length)}
                            <ul className="flex flex-col gap-2.5 list-none p-0 m-0">{groups.today.map(renderRow)}</ul>
                        </section>
                    )}

                    {groups.ok.length > 0 && (
                        <section className="flex flex-col gap-3">
                            <button
                                type="button"
                                onClick={() => setShowOk(v => !v)}
                                aria-expanded={showOk}
                                className="bg-transparent border-none p-0 cursor-pointer text-left"
                            >
                                <h3 className="flex items-center gap-2.5 text-xs font-black uppercase tracking-wider">
                                    <span className="w-2 h-2 rounded-full bg-graphite-300" />
                                    <span className="text-graphite-400">{t('today.groups.ok')}</span>
                                    <span className="text-graphite-400 font-bold tabular-nums">{groups.ok.length}</span>
                                    <span className="flex-1 h-px bg-ice-200" />
                                    <span className="inline-flex items-center gap-1 text-graphite-500 normal-case tracking-normal font-bold">
                                        {showOk ? t('today.hide') : t('today.show')}
                                        <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', showOk && 'rotate-180')} />
                                    </span>
                                </h3>
                            </button>
                            {showOk && <ul className="flex flex-col gap-2.5 list-none p-0 m-0">{groups.ok.map(renderRow)}</ul>}
                        </section>
                    )}
                </>
            )}

            {(msgModal || bulkMessage) && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-ice-100 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="text-lg font-black text-graphite-900">{t('today.messageModal.title')}</h3>
                                <p className="text-xs text-graphite-500 font-medium truncate">
                                    {bulkMessage ? t('today.bulk.recipients', { count: selectedJourneys.length }) : msgModal && displayName(msgModal)}
                                </p>
                            </div>
                            <IconButton onClick={() => { setMsgModal(null); setBulkMessage(false); }} aria-label={t('today.messageModal.cancel')}><X className="w-5 h-5" /></IconButton>
                        </div>
                        <div className="p-6">
                            <label htmlFor="today-quick-message" className="sr-only">{t('today.messageModal.title')}</label>
                            <textarea
                                id="today-quick-message"
                                value={msgText}
                                onChange={(e) => setMsgText(e.target.value)}
                                rows={4}
                                autoFocus
                                placeholder={t('today.messageModal.placeholder')}
                                className="w-full bg-ice-50 border border-ice-100 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-primary focus:border-transparent outline-none transition-all resize-none"
                            />
                            <p className="text-[11px] font-medium text-graphite-400 mt-2">{t('today.messageModal.hint')}</p>
                        </div>
                        <div className="p-6 bg-ice-50 rounded-b-3xl flex gap-3">
                            <Button variant="ghost" className="flex-1" onClick={() => { setMsgModal(null); setBulkMessage(false); }}>{t('today.messageModal.cancel')}</Button>
                            <Button className="flex-1" disabled={!msgText.trim() || sending} onClick={handleSend}>
                                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                {t('today.messageModal.send')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            {archiveConfirm && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="alertdialog" aria-modal="true" aria-labelledby="archive-title">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="p-6 flex flex-col gap-2">
                            <h3 id="archive-title" className="text-lg font-black text-graphite-900 m-0">{t('today.bulk.archiveTitle', { count: selectedJourneys.length })}</h3>
                            <p className="text-sm text-graphite-500 m-0">{t('today.bulk.archiveBody')}</p>
                        </div>
                        <div className="p-6 bg-ice-50 rounded-b-3xl flex gap-3">
                            <Button variant="ghost" className="flex-1" onClick={() => setArchiveConfirm(false)}>{t('today.messageModal.cancel')}</Button>
                            <Button variant="danger" className="flex-1 hover:scale-100" onClick={bulkArchive}>
                                <Archive className="w-4 h-4" /> {t('today.bulk.archiveConfirm', { count: selectedJourneys.length })}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface MenuItem {
    key: string;
    icon: typeof MessageSquare;
    label: string;
    run: () => void;
    disabled?: boolean;
}

function RowMenu({ open, onToggle, onClose, label, items }: {
    open: boolean; onToggle: () => void; onClose: () => void; label: string; items: MenuItem[];
}) {
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open, onClose]);

    return (
        <div ref={ref} className="relative">
            <IconButton size="sm" onClick={onToggle} aria-haspopup="menu" aria-expanded={open} aria-label={label}>
                <MoreHorizontal className="w-4 h-4" />
            </IconButton>
            {open && (
                <div role="menu" className="absolute right-0 top-full mt-2 z-30 w-56 bg-white rounded-2xl border border-ice-100 shadow-2xl p-1.5">
                    {items.map(item => (
                        <button
                            key={item.key}
                            type="button"
                            role="menuitem"
                            disabled={item.disabled}
                            onClick={() => { onClose(); item.run(); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold text-graphite-700 hover:bg-ice-50 bg-transparent border-none cursor-pointer text-left disabled:opacity-50"
                        >
                            <item.icon className="w-4 h-4 text-graphite-400" />
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
