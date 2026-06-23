import { useState } from 'react';
import { Shield, Check, AlertTriangle, Clock, Loader2, CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTenant } from '../contexts/TenantContext';
import { usePlan } from '../hooks/usePlan';
import { useToast } from '../contexts/ToastContext';
import { useTenantCurrency } from '../hooks/useTenantCurrency';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { supabase } from '../lib/supabase';
import {
    PLANS,
    PLAN_ORDER,
    WHATSAPP_EXTRA_NUMBER_PRICE,
    formatPrice,
    isPlanUpgrade,
    type PlanId,
    type BillingCycle,
} from '../config/planConfig';
import { getIntlLocale } from '../lib/i18n';

export const BillingPage = () => {
    const { t, i18n } = useTranslation('billing');
    const { tenant, refresh } = useTenant();
    const { planId, isTrialActive, isTrialExpired, trialDaysLeft } = usePlan();
    const { showToast, showConfirm } = useToast();
    const { formatDual, rateFetchedAt } = useTenantCurrency();
    const { formatDateTime } = useLocaleFormat();
    const [billingCycle, setBillingCycle] = useState<BillingCycle>(
        tenant?.billing_cycle ?? 'monthly'
    );
    const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
    const [loadingPortal, setLoadingPortal] = useState(false);
    const [scheduledChange, setScheduledChange] = useState<{ planName: string; date: string } | null>(null);

    // Abre o Stripe Billing Portal — atualizar cartão, ver faturas e CANCELAR
    async function handleManageBilling() {
        setLoadingPortal(true);
        try {
            const res = await supabase.functions.invoke('stripe-create-portal', {
                body: { return_url: window.location.href },
            });
            if (res.error) throw new Error(res.error.message);
            if (!res.data?.url) throw new Error(res.data?.error ?? t('billingPage.toasts.portalOpenError'));
            window.location.href = res.data.url;
        } catch (err: any) {
            console.error('Portal error:', err);
            showToast('error', t('billingPage.toasts.manageBillingError', { message: err.message }));
            setLoadingPortal(false);
        }
    }

    // Fluxo de checkout (contas ainda sem assinatura no Stripe)
    async function startCheckout(targetPlanId: PlanId) {
        const res = await supabase.functions.invoke('stripe-create-checkout', {
            body: {
                plan_id:       targetPlanId,
                billing_cycle: billingCycle,
                success_url:   `${window.location.origin}/billing?checkout=success`,
                cancel_url:    `${window.location.origin}/billing`,
            },
        });
        if (res.error) throw new Error(res.error.message);

        const { url, redirect_to_sales } = res.data;
        if (redirect_to_sales) {
            window.location.href = 'mailto:contato@traffio.com.br?subject=Plano Rede';
            return;
        }
        if (url) window.location.href = url;
    }

    // Troca flexível de plano respeitando o ciclo já pago:
    // upgrade = imediato com proração · downgrade = agendado p/ fim do período
    async function handleChangePlan(targetPlanId: PlanId) {
        if (targetPlanId === 'rede') {
            window.location.href = 'mailto:contato@traffio.com.br?subject=Plano Rede';
            return;
        }

        const isUpgrade = isPlanUpgrade(planId, targetPlanId)
            || (targetPlanId === planId && tenant?.billing_cycle === 'monthly' && billingCycle === 'annual');
        const isTrialing = tenant?.subscription_status === 'trial';

        // Confirmação antes de mudanças com efeito financeiro
        if (!isTrialing) {
            const renewsAt = tenant?.subscription_renews_at
                ? new Date(tenant.subscription_renews_at).toLocaleDateString(getIntlLocale(i18n.language))
                : t('billingPage.confirm.nextRenewalFallback');
            const cycleLabel = billingCycle === 'annual' ? t('billingPage.confirm.cycleAnnual') : t('billingPage.confirm.cycleMonthly');
            const targetPlanName = t(`plans.${targetPlanId}.name`);
            const msg = isUpgrade
                ? t('billingPage.confirm.upgradeMessage', { plan: targetPlanName, cycle: cycleLabel })
                : t('billingPage.confirm.downgradeMessage', { plan: targetPlanName, cycle: cycleLabel, renewsAt });
            const ok = await showConfirm(msg);
            if (!ok) return;
        }

        setLoadingPlan(targetPlanId);
        try {
            const res = await supabase.functions.invoke('stripe-change-plan', {
                body: { plan_id: targetPlanId, billing_cycle: billingCycle },
            });
            if (res.error) throw new Error(res.error.message);

            const data = res.data ?? {};
            if (data.error) throw new Error(data.error);

            if (data.redirect_to_sales) {
                window.location.href = 'mailto:contato@traffio.com.br?subject=Plano Rede';
                return;
            }

            // Sem assinatura no Stripe ainda → checkout normal
            if (data.needs_checkout) {
                await startCheckout(targetPlanId);
                return;
            }

            if (data.changed === 'immediate') {
                showToast('success', data.trial
                    ? t('billingPage.toasts.planChangedImmediateTrial', { plan: targetPlanName })
                    : t('billingPage.toasts.planChangedImmediate', { plan: targetPlanName }));
                await refresh(undefined, false);
            } else if (data.changed === 'scheduled') {
                const date = data.effective_at
                    ? new Date(data.effective_at).toLocaleDateString(getIntlLocale(i18n.language))
                    : t('billingPage.confirm.nextRenewalFallback');
                setScheduledChange({ planName: targetPlanName, date });
                showToast('success', t('billingPage.toasts.planChangeScheduled', { plan: targetPlanName, date }));
            }

        } catch (err: any) {
            console.error('Change plan error:', err);
            showToast('error', t('billingPage.toasts.changePlanError', { message: err.message }));
        } finally {
            setLoadingPlan(null);
        }
    }

    const currentPlan = PLANS[planId];
    const status = tenant?.subscription_status ?? 'trial';

    const renewsAt = tenant?.subscription_renews_at
        ? new Date(tenant.subscription_renews_at).toLocaleDateString('pt-BR')
        : null;
    const trialEndsAt = tenant?.trial_ends_at
        ? new Date(tenant.trial_ends_at).toLocaleDateString('pt-BR')
        : null;

    function statusLabel() {
        if (status === 'trial' && !isTrialExpired) return t('billingPage.status.trial');
        if (isTrialExpired) return t('billingPage.status.trialExpired');
        if (status === 'active') return t('billingPage.status.active');
        if (status === 'suspended') return t('billingPage.status.suspended');
        if (status === 'canceled') return t('billingPage.status.canceled');
        return status;
    }

    function statusBadge() {
        if (isTrialExpired || status === 'suspended' || status === 'canceled') {
            return 'bg-red-50 text-red-600 ring-red-100';
        }
        if (status === 'trial') return 'bg-amber-50 text-amber-600 ring-amber-100';
        return 'bg-emerald-50 text-emerald-600 ring-emerald-100';
    }

    function statusDot() {
        if (isTrialExpired || status === 'suspended' || status === 'canceled') return 'bg-red-500';
        if (status === 'trial') return 'bg-amber-500';
        return 'bg-emerald-500 animate-pulse';
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
            <div>
                <h1 className="text-3xl font-black text-graphite-900 tracking-tight">{t('billingPage.pageTitle')}</h1>
                <p className="text-graphite-500 font-medium">{t('billingPage.pageSubtitle')}</p>
            </div>

            {/* Alerta de trial expirado */}
            {isTrialExpired && (
                <div className="flex items-start gap-3 p-5 bg-red-50 rounded-2xl border border-red-100">
                    <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-black text-red-700">{t('billingPage.trialExpiredAlert.title')}</p>
                        <p className="text-sm text-red-600 font-medium mt-0.5">
                            {t('billingPage.trialExpiredAlert.message')}
                        </p>
                    </div>
                </div>
            )}

            {/* Alerta de trial ativo */}
            {isTrialActive && (
                <div className="flex items-start gap-3 p-5 bg-amber-50 rounded-2xl border border-amber-100">
                    <Clock size={20} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-700 font-medium">
                        {t('billingPage.trialActiveAlert.prefix')}{' '}
                        <span className="font-black">
                            {trialDaysLeft > 0 ? t('billingPage.trialActiveAlert.daysLeft', { count: trialDaysLeft }) : t('billingPage.trialActiveAlert.expiresToday')}.
                        </span>{' '}
                        {trialEndsAt && t('billingPage.trialActiveAlert.endsAtSuffix', { date: trialEndsAt })}
                    </p>
                </div>
            )}

            {/* Banner do plano ativo */}
            <div className="bg-brand-primary/5 border border-brand-primary/20 rounded-[32px] p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-brand-primary rounded-2xl flex items-center justify-center shadow-lg shadow-brand-primary/20">
                        <currentPlan.icon size={28} className="text-white" />
                    </div>
                    <div>
                        <p className="text-xs font-black text-brand-primary uppercase tracking-widest mb-1">{t('billingPage.activePlanBanner.label')}</p>
                        <h2 className="text-2xl font-black text-graphite-900">{t(`plans.${planId}.name`)}</h2>
                        <p className="text-sm text-graphite-500 font-medium">
                            {status === 'active' && renewsAt
                                ? t('billingPage.activePlanBanner.renewsAt', {
                                      date: renewsAt,
                                      price: formatPrice(
                                          billingCycle === 'annual'
                                              ? currentPlan.annualMonthlyPrice
                                              : currentPlan.monthlyPrice
                                      ),
                                  })
                                : status === 'trial' && trialEndsAt
                                ? t('billingPage.activePlanBanner.trialUntil', { date: trialEndsAt })
                                : t(`plans.${planId}.description`)}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className={`flex items-center gap-1.5 font-black text-xs px-3 py-1.5 rounded-full ring-1 ${statusBadge()}`}>
                        <div className={`w-2 h-2 rounded-full ${statusDot()}`}></div>
                        {statusLabel()}
                    </span>
                    <button
                        onClick={handleManageBilling}
                        disabled={loadingPortal}
                        className="px-5 py-2.5 rounded-xl border border-ice-200 text-graphite-600 text-sm font-bold hover:bg-ice-50 transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                        title={t('billingPage.activePlanBanner.manageBillingTitle')}
                    >
                        {loadingPortal && <Loader2 size={14} className="animate-spin" />}
                        {t('billingPage.activePlanBanner.manageBilling')}
                    </button>
                </div>
            </div>

            {/* Banner de mudança de plano agendada */}
            {scheduledChange && (
                <div className="flex items-start gap-3 p-5 bg-indigo-50 rounded-2xl border border-indigo-100">
                    <CalendarClock size={20} className="text-indigo-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-indigo-700 font-medium">
                        {t('billingPage.scheduledChangeBanner.prefix')}{' '}
                        <span className="font-black">{scheduledChange.planName}</span> {t('billingPage.scheduledChangeBanner.middle')}{' '}
                        <span className="font-black">{scheduledChange.date}</span>. {t('billingPage.scheduledChangeBanner.suffix')}
                    </p>
                </div>
            )}

            {/* Toggle ciclo de cobrança */}
            <div className="flex justify-center">
                <div className="inline-flex items-center bg-ice-100 rounded-2xl p-1 gap-1">
                    <button
                        onClick={() => setBillingCycle('monthly')}
                        className={`px-5 py-2 rounded-xl text-sm font-black transition-all ${
                            billingCycle === 'monthly'
                                ? 'bg-white text-graphite-900 shadow-sm'
                                : 'text-graphite-500 hover:text-graphite-700'
                        }`}
                    >
                        {t('billingPage.cycleToggle.monthly')}
                    </button>
                    <button
                        onClick={() => setBillingCycle('annual')}
                        className={`px-5 py-2 rounded-xl text-sm font-black transition-all flex items-center gap-2 ${
                            billingCycle === 'annual'
                                ? 'bg-white text-graphite-900 shadow-sm'
                                : 'text-graphite-500 hover:text-graphite-700'
                        }`}
                    >
                        {t('billingPage.cycleToggle.annual')}
                        <span className="text-[10px] font-black bg-emerald-500 text-white px-2 py-0.5 rounded-full">
                            {t('billingPage.cycleToggle.discountBadge')}
                        </span>
                    </button>
                </div>
            </div>

            {/* Grid de planos */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {PLAN_ORDER.map((id: PlanId) => {
                    const plan = PLANS[id];
                    const Icon = plan.icon;
                    const isCurrentPlan = id === planId;
                    // "Plano atual" só quando plano E ciclo coincidem — assim o
                    // cliente pode migrar mensal↔anual dentro do mesmo plano
                    const isCurrent = isCurrentPlan && billingCycle === (tenant?.billing_cycle ?? 'monthly');
                    const isUpgrade = isPlanUpgrade(planId, id);
                    const price = billingCycle === 'annual'
                        ? plan.annualMonthlyPrice
                        : plan.monthlyPrice;
                    const ctaLabel = isCurrent
                        ? t('billingPage.cta.currentPlan')
                        : id === 'rede'
                        ? t('billingPage.cta.talkToSales')
                        : isCurrentPlan
                        ? billingCycle === 'annual' ? t('billingPage.cta.switchToAnnual') : t('billingPage.cta.switchToMonthly')
                        : isUpgrade
                        ? t('billingPage.cta.upgrade')
                        : t('billingPage.cta.changePlan');

                    return (
                        <div
                            key={id}
                            className={`relative bg-white rounded-[32px] p-8 border-2 transition-all flex flex-col ${
                                isCurrent
                                    ? 'border-brand-primary shadow-xl shadow-brand-primary/10'
                                    : 'border-ice-100 hover:border-ice-200 hover:shadow-lg'
                            }`}
                        >
                            {isCurrent && (
                                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-brand-primary text-white text-[10px] font-black px-4 py-1 rounded-full uppercase tracking-widest whitespace-nowrap">
                                    {t('billingPage.planCard.currentBadge')}
                                </div>
                            )}

                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 ${plan.badgeClass}`}>
                                <Icon size={24} />
                            </div>

                            <h3 className="text-xl font-black text-graphite-900 mb-1">{t(`plans.${id}.name`)}</h3>
                            <p className="text-xs text-graphite-400 font-medium mb-4 leading-relaxed">{t(`plans.${id}.description`)}</p>

                            <div className="mb-1">
                                {(() => {
                                    const d = formatDual(price);
                                    return (
                                        <span className="text-3xl font-black text-graphite-900">
                                            {d.primary}
                                            {d.secondary && (
                                                <span
                                                    className="block text-xs font-medium text-graphite-400 mt-0.5"
                                                    title={rateFetchedAt ? `Cotação de ${formatDateTime(rateFetchedAt)}` : undefined}
                                                >
                                                    ({d.secondary})
                                                </span>
                                            )}
                                        </span>
                                    );
                                })()}
                                <span className="text-graphite-400 font-medium text-sm">{t('billingPage.planCard.perMonth')}</span>
                            </div>
                            {billingCycle === 'annual' && (
                                <p className="text-xs text-emerald-600 font-black mb-4">
                                    {t('billingPage.planCard.billedAnnually', { price: formatPrice(price * 12) })}
                                </p>
                            )}
                            {billingCycle === 'monthly' && <div className="mb-4" />}

                            <ul className="space-y-3 flex-1 mb-8">
                                {(t(`plans.${id}.features`, { returnObjects: true }) as string[]).map((feature) => (
                                    <li key={feature} className="flex items-start gap-2.5">
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${plan.badgeClass}`}>
                                            <Check size={12} />
                                        </div>
                                        <span className="text-sm text-graphite-600 font-medium">{feature}</span>
                                    </li>
                                ))}
                                {id !== 'essencial' && (
                                    <li className="flex items-start gap-2.5">
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${plan.badgeClass}`}>
                                            <Check size={12} />
                                        </div>
                                        <span className="text-sm text-graphite-400 font-medium">
                                            {t('billingPage.planCard.extraWhatsappNumber', { price: formatPrice(WHATSAPP_EXTRA_NUMBER_PRICE) })}
                                        </span>
                                    </li>
                                )}
                            </ul>

                            <button
                                disabled={isCurrent || loadingPlan === id}
                                onClick={() => !isCurrent && handleChangePlan(id)}
                                className={`w-full py-3.5 rounded-2xl font-black text-sm transition-all border-none cursor-pointer flex items-center justify-center gap-2 ${
                                    isCurrent
                                        ? 'bg-ice-100 text-graphite-400 cursor-default'
                                        : isUpgrade || isCurrentPlan
                                        ? id === 'clinica'
                                            ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98]'
                                            : 'bg-graphite-900 text-white hover:scale-[1.02] active:scale-[0.98]'
                                        : 'bg-ice-200 text-graphite-600 hover:bg-ice-300'
                                }`}
                            >
                                {loadingPlan === id && (
                                    <Loader2 size={15} className="animate-spin" />
                                )}
                                {ctaLabel}
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Nota de segurança */}
            <div className="flex items-center gap-3 p-5 bg-ice-50 rounded-2xl border border-ice-100">
                <Shield size={20} className="text-brand-primary shrink-0" />
                <p className="text-sm text-graphite-500 font-medium">
                    {t('billingPage.securityNote')}
                </p>
            </div>
        </div>
    );
};
