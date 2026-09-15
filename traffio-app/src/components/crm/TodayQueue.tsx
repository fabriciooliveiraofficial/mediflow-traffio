import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
    MoreHorizontal, MessageSquare, Inbox, CalendarPlus, AlarmClock, Check,
    User, FileText, Loader2, Send, X, CheckCircle2, ChevronDown, AlertTriangle,
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

export type JourneyChannel = 'whatsapp' | 'instagram' | 'facebook' | 'livechat' | 'sms' | 'phone' | 'walk_in';

interface TodayQueueProps {
    journeys: CrmJourney[];
    activity: Record<string, JourneyActivity>;
    stageFilter: CrmStageId | null;
    onClearFilter: () => void;
    displayName: (j: CrmJourney) => string;
    primaryChannel: (j: CrmJourney) => JourneyChannel;
    onOpenJourney: (j: CrmJourney) => void;
    onOpenConversation: (j: CrmJourney) => void;
    onBook: (j: CrmJourney) => void;
    onProposal: (j: CrmJourney) => void;
    onPatch: (id: string, patch: Partial<CrmJourney>) => void;
    onRefresh: () => void;
}

const CHANNEL_DOT: Record<JourneyChannel, string> = {
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
    journeys, activity, stageFilter, onClearFilter, displayName, primaryChannel,
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
        if (a.lastPreview && ['message_received', 'message_sent'].includes(a.lastType)) return `“${a.lastPreview}”`;
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
        const ini = initials(name);

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
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
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
                            <span className="flex items-center gap-2 text-xs font-bold min-w-0">
                                <span className={clsx('truncate', c.group === 'now' ? 'text-accent-error' : c.group === 'today' ? 'text-accent-warning' : 'text-graphite-400')}>
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

    const header = (group: TodayGroup, count: number) => (
        <h3 className="flex items-center gap-2.5 text-xs font-black uppercase tracking-wider">
            <span className={clsx('w-2 h-2 rounded-full',
                group === 'now' ? 'bg-accent-error' : group === 'today' ? 'bg-accent-warning' : 'bg-graphite-300')} />
            <span className={group === 'now' ? 'text-accent-error' : group === 'today' ? 'text-accent-warning' : 'text-graphite-400'}>
                {t(`today.groups.${group}`)}
            </span>
            <span className="text-graphite-400 font-bold tabular-nums">{count}</span>
            <span className="flex-1 h-px bg-ice-200" />
        </h3>
    );

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

            {total === 0 ? (
                <EmptyState icon={CheckCircle2} label={t('today.empty')} className="bg-white" />
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

            {msgModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-ice-100 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="text-lg font-black text-graphite-900">{t('today.messageModal.title')}</h3>
                                <p className="text-xs text-graphite-500 font-medium truncate">{displayName(msgModal)}</p>
                            </div>
                            <IconButton onClick={() => setMsgModal(null)} aria-label={t('today.messageModal.cancel')}><X className="w-5 h-5" /></IconButton>
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
                            <Button variant="ghost" className="flex-1" onClick={() => setMsgModal(null)}>{t('today.messageModal.cancel')}</Button>
                            <Button className="flex-1" disabled={!msgText.trim() || sending} onClick={handleSend}>
                                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                {t('today.messageModal.send')}
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
