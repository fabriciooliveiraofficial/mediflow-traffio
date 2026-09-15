import { useEffect, useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, ShoppingBag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useTenant } from '../../contexts/TenantContext';
import { useToast } from '../../contexts/ToastContext';
import { AI_PACKAGES, formatPrice, type AiPackage } from '../../config/planConfig';
import { getIntlLocale } from '../../lib/i18n';

/**
 * Uso da franquia de conversas de IA + compra de pacotes
 * (docs/PLANO_MONETIZACAO_IA_2026-09.md). A verdade vem da RPC ai_budget_status:
 * franquia do plano/trial, consumo do mês (custo real ÷ unidade), créditos de
 * pacotes e se a IA está pausada (e por quê).
 */
interface AiBudgetStatus {
    allowed: boolean;
    reason: 'ok' | 'quota_exhausted' | 'daily_cap' | 'subscription_inactive';
    included_units: number;
    used_units: number;
    credit_units: number;
    remaining_units: number;
    spent_month_brl: number;
    spent_today_brl: number;
    daily_cap_brl: number;
    unit_brl: number;
    period_start: string;
}

export const AiUsageCard = () => {
    const { t, i18n } = useTranslation('billing');
    const { tenant } = useTenant();
    const { showToast } = useToast();
    const [status, setStatus] = useState<AiBudgetStatus | null>(null);
    const [packages, setPackages] = useState<AiPackage[]>(AI_PACKAGES);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [buying, setBuying] = useState<string | null>(null);

    useEffect(() => {
        if (!tenant?.id) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            const [budget, pkgs] = await Promise.all([
                supabase.rpc('ai_budget_status', { p_tenant: tenant.id }),
                supabase.from('ai_packages').select('id, units, price_brl').eq('is_active', true).order('sort_order'),
            ]);
            if (cancelled) return;
            if (budget.error || !budget.data) {
                console.error('ai_budget_status error:', budget.error);
                setLoadError(true);
            } else {
                setStatus(budget.data as AiBudgetStatus);
            }
            // Preço exibido acompanha o banco (fonte da cobrança); AI_PACKAGES é só fallback
            if (pkgs.data?.length) {
                setPackages(pkgs.data.map(p => ({ id: p.id, units: p.units, priceBrl: Number(p.price_brl) })));
            }
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [tenant?.id]);

    async function buyPackage(packageId: string) {
        setBuying(packageId);
        try {
            const res = await supabase.functions.invoke('stripe-create-ai-package-checkout', {
                body: {
                    package_id:  packageId,
                    success_url: `${window.location.origin}/billing?ai_package=success`,
                    cancel_url:  `${window.location.origin}/billing`,
                },
            });
            if (res.error) throw new Error(res.error.message);
            if (res.data?.error) throw new Error(res.data.error);
            if (res.data?.url) window.location.href = res.data.url;
        } catch (err: any) {
            console.error('AI package checkout error:', err);
            showToast('error', t('billingPage.aiUsage.purchaseError', { message: err.message }));
            setBuying(null);
        }
    }

    const included  = status?.included_units ?? 0;
    const used      = status?.used_units ?? 0;
    const credits   = status?.credit_units ?? 0;
    const remaining = status?.remaining_units ?? 0;
    const usedPct   = included > 0 ? Math.min(100, (used / included) * 100) : 0;
    const isTrial   = tenant?.subscription_status === 'trial';
    const pausedReason = status && !status.allowed ? status.reason : null;

    const nextReset = (() => {
        if (!status?.period_start) return null;
        const d = new Date(status.period_start);
        d.setUTCMonth(d.getUTCMonth() + 1);
        return d.toLocaleDateString(getIntlLocale(i18n.language), { day: '2-digit', month: 'short' });
    })();

    return (
        <section className="bg-white rounded-3xl shadow-sm border border-ice-100 p-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                        <Sparkles size={22} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-graphite-900">{t('billingPage.aiUsage.title')}</h2>
                        <p className="text-sm text-graphite-500 font-medium mt-1 max-w-xl leading-relaxed">
                            {t('billingPage.aiUsage.subtitle')}
                        </p>
                    </div>
                </div>
                {!loading && status && (
                    <div className="md:text-right shrink-0">
                        <p className="text-4xl font-black text-graphite-900 leading-none">{Math.floor(remaining)}</p>
                        <p className="text-xs font-bold text-graphite-400 mt-1.5">
                            {t('billingPage.aiUsage.remaining', { count: Math.floor(remaining) })}
                        </p>
                    </div>
                )}
            </div>

            {loading && (
                <div className="flex items-center gap-2 text-sm text-graphite-400 font-medium">
                    <Loader2 size={16} className="animate-spin" /> …
                </div>
            )}
            {!loading && loadError && (
                <p className="text-sm text-red-600 font-medium">{t('billingPage.aiUsage.loadError')}</p>
            )}

            {!loading && status && (
                <>
                    {pausedReason && (
                        <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-2xl">
                            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-sm text-amber-800 font-medium">
                                {t(`billingPage.aiUsage.paused.${pausedReason}`)}
                            </p>
                        </div>
                    )}

                    {included > 0 ? (
                        <div className="space-y-2">
                            <div className="h-2.5 w-full bg-ice-100 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${usedPct >= 100 ? 'bg-amber-500' : 'bg-brand-primary'}`}
                                    style={{ width: `${usedPct}%` }}
                                />
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs font-bold text-graphite-500">
                                <span>
                                    {t('billingPage.aiUsage.used', { used: used.toFixed(1), total: included })}
                                    {' · '}
                                    <span className="text-graphite-400">
                                        {t(isTrial ? 'billingPage.aiUsage.includedTrial' : 'billingPage.aiUsage.included', { count: included })}
                                    </span>
                                </span>
                                <span className="text-graphite-400">
                                    {credits > 0 && <>{t('billingPage.aiUsage.credits', { count: credits.toFixed(1) })} · </>}
                                    {nextReset && t('billingPage.aiUsage.resets', { date: nextReset })}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-graphite-500 font-medium">
                            {credits > 0
                                ? t('billingPage.aiUsage.credits', { count: credits.toFixed(1) })
                                : t('billingPage.aiUsage.noneIncluded')}
                        </p>
                    )}
                </>
            )}

            <div>
                <p className="text-xs font-black text-graphite-400 uppercase tracking-widest mb-3">
                    {t('billingPage.aiUsage.packagesTitle')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {packages.map(pkg => (
                        <div key={pkg.id} className="bg-ice-50 border border-ice-100 rounded-2xl p-5 flex flex-col">
                            <p className="text-sm font-black text-graphite-900">{t('billingPage.aiUsage.packageUnits', { count: pkg.units })}</p>
                            <p className="text-2xl font-black text-graphite-900 mt-1">{formatPrice(pkg.priceBrl)}</p>
                            <p className="text-xs text-graphite-400 font-medium mb-4">
                                {t('billingPage.aiUsage.packagePerUnit', { price: formatPrice(pkg.priceBrl / pkg.units) })}
                            </p>
                            <button
                                onClick={() => buyPackage(pkg.id)}
                                disabled={buying !== null}
                                className="mt-auto w-full py-2.5 rounded-xl bg-graphite-900 text-white text-sm font-black flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer border-none"
                            >
                                {buying === pkg.id ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBag size={14} />}
                                {t('billingPage.aiUsage.buy')}
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};
