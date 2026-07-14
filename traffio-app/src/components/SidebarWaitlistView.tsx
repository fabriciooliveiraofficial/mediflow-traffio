import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, Loader2, Clock, Trash2, Plus, Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { getIntlLocale } from '../lib/i18n';
import { weekdayLabel, waitingSinceParts } from '../lib/waitlistFormat';
import { smartSchedulingService } from '../services/smartSchedulingService';
import { waitlistService } from '../services/waitlistService';
import type { WaitlistEntry } from '../services/waitlistService';
import { clsx } from 'clsx';

interface SidebarWaitlistViewProps {
    onBack: () => void;
    patientId: string;
    patientName: string;
    onChanged?: () => void;
}

function waitingSince(createdAt: string, t: (key: string, opts?: any) => string): string {
    const { unit, count } = waitingSinceParts(createdAt);
    if (unit === 'now') return t('sidebarWaitlistView.waiting.justNow');
    if (unit === 'hours') return t('sidebarWaitlistView.waiting.hours', { count });
    return t('sidebarWaitlistView.waiting.days', { count });
}

export function SidebarWaitlistView({ onBack, patientId, patientName, onChanged }: SidebarWaitlistViewProps) {
    const { t, i18n } = useTranslation('communications');
    const { tenant } = useTenant();
    const { showToast } = useToast();
    const locale = getIntlLocale(i18n.language);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [entries, setEntries] = useState<WaitlistEntry[]>([]);
    const [doctors, setDoctors] = useState<any[]>([]);

    // Form
    const [doctorId, setDoctorId] = useState('');
    const [days, setDays] = useState<number[]>([]);
    const [timeStart, setTimeStart] = useState('');
    const [timeEnd, setTimeEnd] = useState('');

    const load = useCallback(async () => {
        if (!tenant?.id) return;
        setLoading(true);
        try {
            const [list, docs] = await Promise.all([
                waitlistService.listByPatient(tenant.id, patientId),
                smartSchedulingService.getActiveDoctors(tenant.id)
            ]);
            setEntries(list);
            setDoctors(docs);
        } catch (err) {
            console.error('[SidebarWaitlistView] load error:', err);
        } finally {
            setLoading(false);
        }
    }, [tenant?.id, patientId]);

    useEffect(() => { load(); }, [load]);

    const toggleDay = (d: number) => {
        setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
    };

    const handleAdd = async () => {
        if (!tenant?.id || !doctorId) return;
        setSaving(true);
        try {
            await waitlistService.add({
                tenant_id: tenant.id,
                patient_id: patientId,
                doctor_id: doctorId,
                preferred_days: days,
                preferred_time_start: timeStart || null,
                preferred_time_end: timeEnd || null
            });
            showToast('success', t('sidebarWaitlistView.toasts.added'));
            setDoctorId('');
            setDays([]);
            setTimeStart('');
            setTimeEnd('');
            await load();
            onChanged?.();
        } catch (err: any) {
            if (err.message === 'DUPLICATE_WAITLIST_ENTRY') {
                showToast('error', t('sidebarWaitlistView.toasts.duplicate'));
            } else {
                showToast('error', t('sidebarWaitlistView.toasts.addError', { message: err.message }));
            }
        } finally {
            setSaving(false);
        }
    };

    const handleRemove = async (id: string) => {
        try {
            await waitlistService.remove(id);
            showToast('success', t('sidebarWaitlistView.toasts.removed'));
            setEntries(prev => prev.filter(e => e.id !== id));
            onChanged?.();
        } catch (err: any) {
            showToast('error', t('sidebarWaitlistView.toasts.removeError', { message: err.message }));
        }
    };

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header */}
            <div className="px-4 py-3 border-b border-ice-100 flex items-center gap-3 bg-brand-primary">
                <button onClick={onBack} className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white border-none bg-transparent cursor-pointer">
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-white">
                    <p className="text-xs font-bold opacity-80 uppercase tracking-tighter">{t('sidebarWaitlistView.headerLabel')}</p>
                    <p className="text-sm font-bold truncate max-w-[180px]">{patientName}</p>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center py-10">
                        <Loader2 className="w-6 h-6 text-brand-primary animate-spin" />
                    </div>
                ) : (
                    <div className="p-4 space-y-5">
                        {/* Current entries */}
                        <div>
                            <p className="text-[11px] font-bold text-graphite-500 uppercase tracking-wider mb-2">{t('sidebarWaitlistView.currentTitle')}</p>
                            {entries.length === 0 ? (
                                <p className="text-xs text-graphite-400 italic">{t('sidebarWaitlistView.empty')}</p>
                            ) : (
                                <div className="space-y-2">
                                    {entries.map(entry => (
                                        <div key={entry.id} className="bg-ice-50 border border-ice-100 rounded-2xl p-3 text-xs">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="font-bold text-graphite-900 truncate">
                                                        {entry.doctors?.full_name || t('sidebarWaitlistView.anyDoctor')}
                                                    </p>
                                                    <p className="text-graphite-500 mt-0.5 capitalize">
                                                        {entry.preferred_days?.length
                                                            ? entry.preferred_days.map(d => weekdayLabel(d, locale)).join(', ')
                                                            : t('sidebarWaitlistView.anyDay')}
                                                        {(entry.preferred_time_start || entry.preferred_time_end) &&
                                                            ` · ${(entry.preferred_time_start || '').substring(0, 5)}–${(entry.preferred_time_end || '').substring(0, 5)}`}
                                                    </p>
                                                    <div className="flex items-center gap-1.5 mt-1.5">
                                                        {entry.status === 'notified' ? (
                                                            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md font-bold text-[10px]">
                                                                <Bell size={10} /> {t('sidebarWaitlistView.status.notified')}
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 bg-brand-primary/10 text-brand-primary px-1.5 py-0.5 rounded-md font-bold text-[10px]">
                                                                <Clock size={10} /> {t('sidebarWaitlistView.status.waiting')}
                                                            </span>
                                                        )}
                                                        <span className="text-graphite-400 text-[10px]">{waitingSince(entry.created_at, t)}</span>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleRemove(entry.id)}
                                                    className="p-1.5 rounded-lg text-graphite-300 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0 border-none bg-transparent cursor-pointer"
                                                    title={t('sidebarWaitlistView.removeTitle')}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Add form */}
                        <div className="border-t border-ice-100 pt-4 space-y-3">
                            <p className="text-[11px] font-bold text-graphite-500 uppercase tracking-wider">{t('sidebarWaitlistView.addTitle')}</p>

                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-graphite-500 uppercase tracking-wider ml-1">{t('sidebarWaitlistView.form.doctorLabel')}</label>
                                <select
                                    value={doctorId}
                                    onChange={e => setDoctorId(e.target.value)}
                                    className="w-full bg-ice-50 border border-ice-100 rounded-xl px-3 py-2.5 text-sm text-graphite-900 focus:outline-none focus:bg-white focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                                >
                                    <option value="">{t('sidebarWaitlistView.form.doctorPlaceholder')}</option>
                                    {doctors.map(d => (
                                        <option key={d.id} value={d.id}>{d.full_name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-graphite-500 uppercase tracking-wider ml-1">{t('sidebarWaitlistView.form.daysLabel')}</label>
                                <div className="flex gap-1">
                                    {[0, 1, 2, 3, 4, 5, 6].map(d => (
                                        <button
                                            key={d}
                                            onClick={() => toggleDay(d)}
                                            className={clsx(
                                                'flex-1 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all border cursor-pointer',
                                                days.includes(d)
                                                    ? 'bg-brand-primary text-white border-brand-primary'
                                                    : 'bg-white text-graphite-500 border-ice-200 hover:border-ice-300'
                                            )}
                                        >
                                            {weekdayLabel(d, locale)}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[10px] text-graphite-400 ml-1">{t('sidebarWaitlistView.form.daysHint')}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-bold text-graphite-500 uppercase tracking-wider ml-1">{t('sidebarWaitlistView.form.timeStartLabel')}</label>
                                    <input
                                        type="time"
                                        value={timeStart}
                                        onChange={e => setTimeStart(e.target.value)}
                                        className="w-full bg-ice-50 border border-ice-100 rounded-xl px-3 py-2 text-sm text-graphite-900 focus:outline-none focus:bg-white focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-bold text-graphite-500 uppercase tracking-wider ml-1">{t('sidebarWaitlistView.form.timeEndLabel')}</label>
                                    <input
                                        type="time"
                                        value={timeEnd}
                                        onChange={e => setTimeEnd(e.target.value)}
                                        className="w-full bg-ice-50 border border-ice-100 rounded-xl px-3 py-2 text-sm text-graphite-900 focus:outline-none focus:bg-white focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                                    />
                                </div>
                            </div>

                            <button
                                onClick={handleAdd}
                                disabled={!doctorId || saving}
                                className="w-full bg-brand-primary text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-md shadow-brand-primary/20 disabled:opacity-50 disabled:cursor-not-allowed border-none cursor-pointer"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                {t('sidebarWaitlistView.form.submit')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
