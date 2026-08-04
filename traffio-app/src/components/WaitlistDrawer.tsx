import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Clock, Loader2, Trash2, Bell, RotateCcw, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '../lib/i18n';
import { formatPhone } from '../lib/formatPhone';
import { weekdayLabel, waitingSinceParts } from '../lib/waitlistFormat';
import { useToast } from '../contexts/ToastContext';
import { waitlistService } from '../services/waitlistService';
import type { WaitlistEntry } from '../services/waitlistService';
import { clsx } from 'clsx';
import { useTenant } from '../contexts/TenantContext';
import { type CountryCode } from '../lib/i18n/countryFormats';

interface WaitlistDrawerProps {
    open: boolean;
    onClose: () => void;
    tenantId: string | null;
    onCountChange?: (count: number) => void;
}

export function WaitlistDrawer({ open, onClose, tenantId, onCountChange }: WaitlistDrawerProps) {
    const { t, i18n } = useTranslation('agenda');
    const { showToast, showConfirm } = useToast();
    const { tenant } = useTenant();
    const locale = getIntlLocale(i18n.language);

    const [loading, setLoading] = useState(false);
    const [entries, setEntries] = useState<WaitlistEntry[]>([]);
    const [doctorFilter, setDoctorFilter] = useState<string>('all');

    const load = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const list = await waitlistService.listByTenant(tenantId);
            setEntries(list);
            onCountChange?.(list.length);
        } catch (err) {
            console.error('[WaitlistDrawer] load error:', err);
        } finally {
            setLoading(false);
        }
    }, [tenantId, onCountChange]);

    useEffect(() => {
        if (open) load();
    }, [open, load]);

    // Carrega o contador do botão mesmo com o drawer fechado
    useEffect(() => { load(); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

    const doctorOptions = useMemo(() => {
        const map = new Map<string, string>();
        entries.forEach(e => {
            if (e.doctor_id) map.set(e.doctor_id, e.doctors?.full_name || '—');
        });
        return Array.from(map.entries());
    }, [entries]);

    const filtered = doctorFilter === 'all'
        ? entries
        : entries.filter(e => e.doctor_id === doctorFilter);

    // Posição na fila calculada por médico, considerando apenas quem ainda espera
    const queuePosition = (entry: WaitlistEntry): number | null => {
        if (entry.status !== 'waiting') return null;
        const queue = entries.filter(e => e.doctor_id === entry.doctor_id && e.status === 'waiting');
        return queue.findIndex(e => e.id === entry.id) + 1;
    };

    const waitingLabel = (createdAt: string) => {
        const { unit, count } = waitingSinceParts(createdAt);
        if (unit === 'now') return t('waitlistDrawer.waiting.justNow');
        if (unit === 'hours') return t('waitlistDrawer.waiting.hours', { count });
        return t('waitlistDrawer.waiting.days', { count });
    };

    const handleRemove = async (entry: WaitlistEntry) => {
        const ok = await showConfirm(t('waitlistDrawer.removeConfirm', { name: entry.patients?.full_name || '' }));
        if (!ok) return;
        try {
            await waitlistService.remove(entry.id);
            const next = entries.filter(e => e.id !== entry.id);
            setEntries(next);
            onCountChange?.(next.length);
            showToast('success', t('waitlistDrawer.toasts.removed'));
        } catch (err: any) {
            showToast('error', t('waitlistDrawer.toasts.error', { message: err.message }));
        }
    };

    const handleRequeue = async (entry: WaitlistEntry) => {
        try {
            await waitlistService.updateStatus(entry.id, 'waiting');
            setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'waiting' } : e));
            showToast('success', t('waitlistDrawer.toasts.requeued'));
        } catch (err: any) {
            showToast('error', t('waitlistDrawer.toasts.error', { message: err.message }));
        }
    };

    return (
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-graphite-900/30 backdrop-blur-sm"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                        transition={{ type: 'tween', duration: 0.25 }}
                        className="relative w-full max-w-md h-full bg-white rounded-l-3xl shadow-2xl flex flex-col overflow-hidden"
                    >
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-ice-100 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-brand-primary flex items-center justify-center text-white shadow-md shadow-brand-primary/20">
                                    <Clock className="w-4.5 h-4.5" />
                                </div>
                                <div>
                                    <p className="text-sm font-black text-graphite-900">{t('waitlistDrawer.title')}</p>
                                    <p className="text-[11px] text-graphite-400 font-medium">{t('waitlistDrawer.subtitle', { count: entries.length })}</p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-ice-100 text-graphite-400 hover:text-graphite-700 transition-colors border-none bg-transparent cursor-pointer">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Doctor filter */}
                        {doctorOptions.length > 1 && (
                            <div className="px-4 py-2.5 border-b border-ice-100 flex gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                                <button
                                    onClick={() => setDoctorFilter('all')}
                                    className={clsx('px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all border cursor-pointer',
                                        doctorFilter === 'all' ? 'bg-brand-primary text-white border-brand-primary' : 'bg-white text-graphite-500 border-ice-200 hover:border-ice-300')}
                                >
                                    {t('waitlistDrawer.filterAll')}
                                </button>
                                {doctorOptions.map(([id, name]) => (
                                    <button
                                        key={id}
                                        onClick={() => setDoctorFilter(id)}
                                        className={clsx('px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all border cursor-pointer',
                                            doctorFilter === id ? 'bg-brand-primary text-white border-brand-primary' : 'bg-white text-graphite-500 border-ice-200 hover:border-ice-300')}
                                    >
                                        {name.split(' ').slice(0, 2).join(' ')}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* List */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-ice-50/50">
                            {loading ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-6 h-6 text-brand-primary animate-spin" />
                                </div>
                            ) : filtered.length === 0 ? (
                                <div className="text-center py-12">
                                    <Clock className="w-12 h-12 mx-auto text-graphite-200 mb-3" />
                                    <p className="text-sm font-bold text-graphite-400">{t('waitlistDrawer.empty')}</p>
                                    <p className="text-xs text-graphite-300 mt-1 max-w-[260px] mx-auto">{t('waitlistDrawer.emptyHint')}</p>
                                </div>
                            ) : (
                                filtered.map(entry => {
                                    const pos = queuePosition(entry);
                                    return (
                                        <div key={entry.id} className="bg-white border border-ice-100 rounded-2xl p-3.5 shadow-sm hover:border-brand-primary/30 transition-colors">
                                            <div className="flex items-start gap-3">
                                                <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-black',
                                                    entry.status === 'notified' ? 'bg-amber-100 text-amber-600' : 'bg-brand-primary/10 text-brand-primary')}>
                                                    {entry.status === 'notified' ? <Bell size={14} /> : (pos ?? <User size={14} />)}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <p className="text-sm font-bold text-graphite-900 truncate">{entry.patients?.full_name || '—'}</p>
                                                        <span className="text-[10px] font-bold text-graphite-300 whitespace-nowrap shrink-0">{waitingLabel(entry.created_at)}</span>
                                                    </div>
                                                    <p className="text-[11px] text-graphite-400 font-medium">{formatPhone(entry.patients?.phone || '', tenant?.country as CountryCode)}</p>
                                                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                                        <span className="inline-flex items-center gap-1.5 bg-ice-50 text-graphite-700 px-2 py-0.5 rounded-md text-[10px] font-bold">
                                                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: entry.doctors?.color || '#1152d4' }} />
                                                            {entry.doctors?.full_name || t('waitlistDrawer.anyDoctor')}
                                                        </span>
                                                        <span className="bg-ice-50 text-graphite-500 px-2 py-0.5 rounded-md text-[10px] font-medium capitalize">
                                                            {entry.preferred_days?.length
                                                                ? entry.preferred_days.map(d => weekdayLabel(d, locale)).join(', ')
                                                                : t('waitlistDrawer.anyDay')}
                                                            {(entry.preferred_time_start || entry.preferred_time_end) &&
                                                                ` · ${(entry.preferred_time_start || '').substring(0, 5)}–${(entry.preferred_time_end || '').substring(0, 5)}`}
                                                        </span>
                                                        {entry.status === 'notified' && (
                                                            <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-md text-[10px] font-bold">
                                                                <Bell size={10} /> {t('waitlistDrawer.status.notified')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-1 shrink-0">
                                                    {entry.status === 'notified' && (
                                                        <button
                                                            onClick={() => handleRequeue(entry)}
                                                            className="p-1.5 rounded-lg text-graphite-300 hover:text-brand-primary hover:bg-brand-primary/10 transition-colors border-none bg-transparent cursor-pointer"
                                                            title={t('waitlistDrawer.requeueTitle')}
                                                        >
                                                            <RotateCcw size={14} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleRemove(entry)}
                                                        className="p-1.5 rounded-lg text-graphite-300 hover:text-red-600 hover:bg-red-50 transition-colors border-none bg-transparent cursor-pointer"
                                                        title={t('waitlistDrawer.removeTitle')}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Footer hint */}
                        <div className="px-4 py-3 border-t border-ice-100 bg-ice-50/50 shrink-0">
                            <p className="text-[10px] text-graphite-400 leading-relaxed">{t('waitlistDrawer.footerHint')}</p>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
