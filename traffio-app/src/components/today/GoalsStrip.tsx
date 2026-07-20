import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Target, X, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useTenant } from '../../contexts/TenantContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { useTenantMoney } from '../../hooks/useTenantMoney';
import type { MonthlyGoals } from '../../services/todayService';

interface GoalsStripProps {
    /** Agendamentos do mês corrente (fuso do tenant) */
    appointmentsCurrent: number;
    /** Taxa de comparecimento do mês, em % (0–100) */
    showRateCurrent: number;
    /** Recebido no mês corrente, em centavos (moeda operacional do tenant) */
    revenueCurrent: number;
}

function GoalBar({ label, current, target, suffix, formatValue }: {
    label: string; current: number; target: number; suffix?: string; formatValue?: (n: number) => string;
}) {
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    const fmt = formatValue || ((n: number) => `${n}${suffix || ''}`);
    return (
        <div className="flex-1 min-w-[180px]">
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{label}</p>
                <p className="text-xs font-black text-graphite-900 tabular-nums">
                    {fmt(current)} <span className="text-graphite-300 font-bold">/ {fmt(target)}</span>
                </p>
            </div>
            <div className="h-2 rounded-full bg-ice-100 overflow-hidden">
                <div
                    className={clsx('h-full rounded-full transition-all duration-700', pct >= 100 ? 'bg-accent-success' : 'bg-brand-primary')}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}

/**
 * Metas do mês — MVP em tenants.settings.monthly_goals (sem tabela nova).
 * Sem meta configurada: CTA "Definir metas" para quem pode editar config;
 * nunca exibe barras zeradas falsas (ver SPEC §5).
 */
export function GoalsStrip({ appointmentsCurrent, showRateCurrent, revenueCurrent }: GoalsStripProps) {
    const { t } = useTranslation('today');
    const { tenant, updateTenant } = useTenant();
    const { can } = usePermissions();
    const { showToast } = useToast();
    const { formatCents } = useTenantMoney();

    const goals: MonthlyGoals = tenant?.settings?.monthly_goals || {};
    const canViewFinancial = can('action:view_financial');
    const hasGoals = !!(goals.appointments || goals.show_rate || (canViewFinancial && goals.revenue));
    const canEdit = can('action:edit_config');

    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [apptTarget, setApptTarget] = useState(goals.appointments ? String(goals.appointments) : '');
    const [showRateTarget, setShowRateTarget] = useState(goals.show_rate ? String(goals.show_rate) : '');
    const [revenueTarget, setRevenueTarget] = useState(goals.revenue ? String(goals.revenue / 100) : '');

    const handleSave = async () => {
        if (!tenant) return;
        const appointments = parseInt(apptTarget, 10) || 0;
        const show_rate = Math.min(100, parseInt(showRateTarget, 10) || 0);
        const revenue = Math.round((parseFloat(revenueTarget) || 0) * 100);
        setSaving(true);
        try {
            await updateTenant({
                settings: {
                    ...(tenant.settings || {}),
                    monthly_goals: {
                        ...(tenant.settings?.monthly_goals || {}),
                        appointments: appointments || undefined,
                        show_rate: show_rate || undefined,
                        revenue: revenue || undefined,
                    },
                },
            });
            showToast('success', t('goals.saved'));
            setEditing(false);
        } catch {
            showToast('error', t('goals.saveError'));
        } finally {
            setSaving(false);
        }
    };

    if (!hasGoals && !canEdit) return null;

    return (
        <>
            <div className="bg-white border border-ice-100 rounded-3xl shadow-sm p-5">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                    <div className="flex items-center gap-2.5 shrink-0">
                        <div className="p-2.5 rounded-2xl bg-brand-primary/10 text-brand-primary">
                            <Target size={18} className="stroke-[2.5px]" />
                        </div>
                        <p className="text-sm font-black text-graphite-900">{t('goals.title')}</p>
                    </div>

                    {hasGoals ? (
                        <>
                            {!!goals.appointments && (
                                <GoalBar label={t('goals.appointments')} current={appointmentsCurrent} target={goals.appointments} />
                            )}
                            {!!goals.show_rate && (
                                <GoalBar label={t('goals.showRate')} current={showRateCurrent} target={goals.show_rate} suffix="%" />
                            )}
                            {canViewFinancial && !!goals.revenue && (
                                <GoalBar label={t('goals.revenue')} current={revenueCurrent} target={goals.revenue} formatValue={formatCents} />
                            )}
                            {canEdit && (
                                <button
                                    onClick={() => setEditing(true)}
                                    className="text-xs font-black text-brand-primary hover:underline bg-transparent border-0 cursor-pointer shrink-0"
                                >
                                    {t('goals.edit')}
                                </button>
                            )}
                        </>
                    ) : (
                        <button
                            onClick={() => setEditing(true)}
                            className="text-xs font-black text-brand-primary hover:underline bg-transparent border-0 cursor-pointer"
                        >
                            {t('goals.setup')} →
                        </button>
                    )}
                </div>
            </div>

            {editing && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && setEditing(false)} />
                    <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-start justify-between mb-5">
                            <h3 className="text-base font-black text-graphite-900">{t('goals.modalTitle')}</h3>
                            <button
                                onClick={() => setEditing(false)}
                                disabled={saving}
                                className="p-1.5 rounded-lg hover:bg-ice-50 text-graphite-400 transition-colors border-0 bg-transparent cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1.5">
                                    {t('goals.appointmentsLabel')}
                                </label>
                                <input
                                    type="number" min="0" value={apptTarget}
                                    onChange={e => setApptTarget(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-2xl bg-ice-50 border border-ice-100 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1.5">
                                    {t('goals.showRateLabel')}
                                </label>
                                <input
                                    type="number" min="0" max="100" value={showRateTarget}
                                    onChange={e => setShowRateTarget(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-2xl bg-ice-50 border border-ice-100 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1.5">
                                    {t('goals.revenueLabel')}
                                </label>
                                <input
                                    type="number" min="0" step="0.01" value={revenueTarget}
                                    onChange={e => setRevenueTarget(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-2xl bg-ice-50 border border-ice-100 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary"
                                />
                            </div>
                        </div>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-brand-primary text-white text-sm font-black hover:opacity-90 transition-opacity border-0 cursor-pointer disabled:opacity-50"
                        >
                            {saving && <Loader2 size={16} className="animate-spin" />}
                            {t('goals.save')}
                        </button>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
