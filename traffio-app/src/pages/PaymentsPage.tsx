/**
 * PaymentsPage — conexão de pagamentos online do tenant (Stripe-only).
 *
 * Decisão de produto: a plataforma integra um único gateway online (Stripe,
 * via Stripe Connect Standard) porque opera globalmente. Todos os demais
 * meios (maquininha, dinheiro, transferência, financiamento local) são
 * registrados manualmente no Financeiro — aqui o tenant apenas configura
 * quais aceita. Links de pagamento só existem com charges_enabled.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    CreditCard,
    Shield,
    Check,
    ExternalLink,
    Banknote,
    Landmark,
    HandCoins,
    FileText,
    Wallet,
    CircleDollarSign,
    RefreshCw,
    Unlink,
    ArrowRight,
    AlertTriangle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';
import { useStripeConnection } from '../hooks/useStripeConnection';
import { useTenantMoney } from '../hooks/useTenantMoney';

// Métodos manuais padrão do caixa. `label` custom por tenant cobre variações
// locais ("Yape", "Maquininha Stone", "Transferencia Bancolombia"...).
const MANUAL_METHODS = [
    { id: 'cash', icon: Banknote },
    { id: 'card_machine', icon: CreditCard },
    { id: 'bank_transfer', icon: Landmark },
    { id: 'insurance', icon: Shield },
    { id: 'financing', icon: HandCoins },
    { id: 'check', icon: FileText },
    { id: 'other', icon: Wallet },
] as const;

type ManualMethodId = typeof MANUAL_METHODS[number]['id'];

interface AcceptedMethod {
    id: ManualMethodId;
    enabled: boolean;
    label: string | null;
}

const DEFAULT_ENABLED: ManualMethodId[] = ['cash', 'card_machine', 'bank_transfer'];

export const PaymentsPage = () => {
    const { t } = useTranslation('billing');
    const { showToast } = useToast();
    const { tenant, refresh } = useTenant();
    const stripe = useStripeConnection();
    const { currency } = useTenantMoney();
    const [searchParams, setSearchParams] = useSearchParams();
    const [savingMethods, setSavingMethods] = useState(false);

    const acceptedMethods: AcceptedMethod[] = useMemo(() => {
        const saved: AcceptedMethod[] = tenant?.payment_config?.accepted_methods ?? [];
        return MANUAL_METHODS.map(m => {
            const found = saved.find(s => s.id === m.id);
            return found ?? { id: m.id, enabled: DEFAULT_ENABLED.includes(m.id), label: null };
        });
    }, [tenant?.payment_config]);

    // Retorno do onboarding Stripe (?stripe_connect=return|refresh) → sincronizar
    useEffect(() => {
        const flag = searchParams.get('stripe_connect');
        if (!flag) return;

        const params = new URLSearchParams(window.location.search);
        params.delete('stripe_connect');
        params.delete('screen');
        setSearchParams(params, { replace: true });

        stripe.sync()
            .then((res) => {
                if (res?.charges_enabled) {
                    showToast('success', t('paymentsPage.stripe.toasts.connected'));
                } else {
                    showToast('info', t('paymentsPage.stripe.toasts.onboardingIncomplete'));
                }
            })
            .catch(() => showToast('error', t('paymentsPage.stripe.toasts.syncError')));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleConnect = async () => {
        try {
            await stripe.startOnboarding();
        } catch {
            showToast('error', t('paymentsPage.stripe.toasts.startError'));
        }
    };

    const handleSync = async () => {
        try {
            await stripe.sync();
            showToast('success', t('paymentsPage.stripe.toasts.synced'));
        } catch {
            showToast('error', t('paymentsPage.stripe.toasts.syncError'));
        }
    };

    const handleDisconnect = async () => {
        if (!confirm(t('paymentsPage.stripe.confirmDisconnect'))) return;
        try {
            await stripe.disconnect();
            showToast('success', t('paymentsPage.stripe.toasts.disconnected'));
        } catch {
            showToast('error', t('paymentsPage.stripe.toasts.disconnectError'));
        }
    };

    const saveMethods = async (methods: AcceptedMethod[]) => {
        if (!tenant) return;
        setSavingMethods(true);
        try {
            const { error } = await supabase
                .from('tenants')
                .update({ payment_config: { ...(tenant.payment_config ?? {}), accepted_methods: methods } })
                .eq('id', tenant.id);
            if (error) throw error;
            await refresh(undefined, false);
        } catch {
            showToast('error', t('paymentsPage.manualMethods.saveError'));
        } finally {
            setSavingMethods(false);
        }
    };

    const toggleMethod = (id: ManualMethodId) => {
        saveMethods(acceptedMethods.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m));
    };

    const setMethodLabel = (id: ManualMethodId, label: string) => {
        saveMethods(acceptedMethods.map(m => m.id === id ? { ...m, label: label.trim() || null } : m));
    };

    const statusBadge = {
        not_connected: { cls: 'text-graphite-400 bg-ice-100', dot: 'bg-graphite-300' },
        onboarding:    { cls: 'text-amber-500 bg-amber-50', dot: 'bg-amber-500 animate-pulse' },
        active:        { cls: 'text-emerald-600 bg-emerald-50', dot: 'bg-emerald-600' },
        disabled:      { cls: 'text-rose-500 bg-rose-50', dot: 'bg-rose-500' },
    }[stripe.status];

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black text-graphite-900 tracking-tight">{t('paymentsPage.header.title')}</h1>
                    <p className="text-graphite-500 font-medium">{t('paymentsPage.header.subtitle')}</p>
                </div>
                <div className="flex items-center gap-2 bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-full text-xs font-bold ring-1 ring-emerald-100">
                    <Shield size={14} />
                    <span>{t('paymentsPage.header.secureBadge')}</span>
                </div>
            </div>

            {/* Stripe Connect Card */}
            <div className={`bg-white border-2 rounded-[32px] p-8 space-y-6 relative overflow-hidden transition-all ${stripe.chargesEnabled ? 'border-[#635BFF] shadow-xl shadow-[#635BFF]/10' : 'border-transparent shadow-float'}`}>
                <div className={`absolute top-0 left-0 w-full h-1.5 ${stripe.chargesEnabled ? 'bg-[#635BFF]' : 'bg-[#635BFF]/10'}`} />

                <div className="flex justify-between items-start">
                    <div className={`p-4 rounded-2xl ${stripe.chargesEnabled ? 'bg-[#635BFF] text-white shadow-lg shadow-[#635BFF]/20' : 'bg-[#635BFF]/10 text-[#635BFF]'}`}>
                        <CircleDollarSign size={32} />
                    </div>
                    <span className={`flex items-center gap-1.5 font-black uppercase text-[10px] px-2.5 py-1 rounded-md ${statusBadge.cls}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
                        {t(`paymentsPage.stripe.status.${stripe.status}`)}
                    </span>
                </div>

                <div className="space-y-1">
                    <h4 className="text-xl font-black text-graphite-900">{t('paymentsPage.stripe.title')}</h4>
                    <p className="text-sm text-graphite-500 leading-relaxed font-medium">
                        {t('paymentsPage.stripe.description', { currency })}
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    {(t('paymentsPage.stripe.features', { returnObjects: true }) as string[]).map((f) => (
                        <span key={f} className="text-[10px] font-bold text-[#635BFF] bg-[#635BFF]/10 px-2.5 py-1 rounded-full">{f}</span>
                    ))}
                </div>

                {/* Ações conforme estado */}
                <div className="pt-4 border-t border-ice-50 space-y-3">
                    {stripe.status === 'not_connected' && (
                        <button
                            onClick={handleConnect}
                            disabled={stripe.busy}
                            className="w-full py-3.5 rounded-2xl font-black bg-[#635BFF] text-white shadow-lg shadow-[#635BFF]/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 border-none cursor-pointer disabled:opacity-60"
                        >
                            <ArrowRight size={18} />
                            {stripe.busy ? t('paymentsPage.stripe.redirecting') : t('paymentsPage.stripe.connectButton')}
                        </button>
                    )}

                    {stripe.status === 'onboarding' && (
                        <>
                            <div className="flex items-start gap-3 p-4 bg-amber-50/70 rounded-2xl">
                                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-graphite-600 font-medium leading-relaxed">{t('paymentsPage.stripe.onboardingNote')}</p>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={handleConnect}
                                    disabled={stripe.busy}
                                    className="flex-[2] py-3.5 rounded-2xl font-black bg-[#635BFF] text-white shadow-lg shadow-[#635BFF]/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 border-none cursor-pointer disabled:opacity-60"
                                >
                                    <ArrowRight size={18} />
                                    {t('paymentsPage.stripe.resumeButton')}
                                </button>
                                <button
                                    onClick={handleSync}
                                    disabled={stripe.busy}
                                    className="flex-1 py-3.5 rounded-2xl font-bold text-graphite-600 bg-ice-50 hover:bg-ice-100 transition-colors flex items-center justify-center gap-2 border-none cursor-pointer disabled:opacity-60"
                                >
                                    <RefreshCw size={16} className={stripe.busy ? 'animate-spin' : ''} />
                                    {t('paymentsPage.stripe.checkStatusButton')}
                                </button>
                            </div>
                        </>
                    )}

                    {stripe.status === 'active' && (
                        <div className="flex flex-col sm:flex-row gap-3">
                            <a
                                href="https://dashboard.stripe.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-[2] py-3.5 rounded-2xl font-black bg-[#635BFF] text-white shadow-lg shadow-[#635BFF]/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 no-underline"
                            >
                                <ExternalLink size={16} />
                                {t('paymentsPage.stripe.dashboardButton')}
                            </a>
                            <button
                                onClick={handleSync}
                                disabled={stripe.busy}
                                className="flex-1 py-3.5 rounded-2xl font-bold text-graphite-600 bg-ice-50 hover:bg-ice-100 transition-colors flex items-center justify-center gap-2 border-none cursor-pointer disabled:opacity-60"
                            >
                                <RefreshCw size={16} className={stripe.busy ? 'animate-spin' : ''} />
                                {t('paymentsPage.stripe.checkStatusButton')}
                            </button>
                            <button
                                onClick={handleDisconnect}
                                disabled={stripe.busy}
                                className="py-3.5 px-4 rounded-2xl font-bold text-rose-400 bg-rose-50 hover:bg-rose-100 transition-colors flex items-center justify-center gap-2 border-none cursor-pointer disabled:opacity-60"
                                title={t('paymentsPage.stripe.disconnectButton')}
                            >
                                <Unlink size={16} />
                            </button>
                        </div>
                    )}

                    {stripe.status === 'disabled' && (
                        <>
                            <div className="flex items-start gap-3 p-4 bg-rose-50/70 rounded-2xl">
                                <AlertTriangle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-graphite-600 font-medium leading-relaxed">{t('paymentsPage.stripe.disabledNote')}</p>
                            </div>
                            <div className="flex gap-3">
                                <a
                                    href="https://dashboard.stripe.com"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-[2] py-3.5 rounded-2xl font-black bg-[#635BFF] text-white shadow-lg shadow-[#635BFF]/20 transition-all flex items-center justify-center gap-2 no-underline"
                                >
                                    <ExternalLink size={16} />
                                    {t('paymentsPage.stripe.dashboardButton')}
                                </a>
                                <button
                                    onClick={handleSync}
                                    disabled={stripe.busy}
                                    className="flex-1 py-3.5 rounded-2xl font-bold text-graphite-600 bg-ice-50 hover:bg-ice-100 transition-colors flex items-center justify-center gap-2 border-none cursor-pointer disabled:opacity-60"
                                >
                                    <RefreshCw size={16} className={stripe.busy ? 'animate-spin' : ''} />
                                    {t('paymentsPage.stripe.checkStatusButton')}
                                </button>
                            </div>
                        </>
                    )}

                    <p className="text-[10px] text-center text-graphite-400 font-bold">
                        {stripe.chargesEnabled
                            ? t('paymentsPage.stripe.activeFootnote')
                            : t('paymentsPage.stripe.inactiveFootnote')}
                    </p>
                </div>
            </div>

            {/* Métodos manuais do caixa */}
            <div className="bg-white rounded-[32px] shadow-float p-8 space-y-6">
                <div>
                    <h4 className="text-xl font-black text-graphite-900">{t('paymentsPage.manualMethods.title')}</h4>
                    <p className="text-sm text-graphite-500 font-medium leading-relaxed">
                        {t('paymentsPage.manualMethods.subtitle')}
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {MANUAL_METHODS.map(({ id, icon: Icon }) => {
                        const method = acceptedMethods.find(m => m.id === id)!;
                        return (
                            <div
                                key={id}
                                className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all ${method.enabled ? 'border-brand-primary/30 bg-brand-primary/[0.03]' : 'border-ice-100 bg-ice-50/40'}`}
                            >
                                <button
                                    onClick={() => toggleMethod(id)}
                                    disabled={savingMethods}
                                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border-none cursor-pointer transition-colors ${method.enabled ? 'bg-brand-primary text-white' : 'bg-ice-100 text-graphite-300'}`}
                                    title={t(`paymentsPage.manualMethods.methods.${id}`)}
                                >
                                    {method.enabled ? <Check size={18} /> : <Icon size={18} />}
                                </button>
                                <div className="min-w-0 flex-1">
                                    <p className={`text-sm font-bold ${method.enabled ? 'text-graphite-900' : 'text-graphite-400'}`}>
                                        {t(`paymentsPage.manualMethods.methods.${id}`)}
                                    </p>
                                    {method.enabled && (
                                        <input
                                            type="text"
                                            defaultValue={method.label ?? ''}
                                            placeholder={t('paymentsPage.manualMethods.labelPlaceholder')}
                                            onBlur={(e) => {
                                                if ((e.target.value.trim() || null) !== method.label) setMethodLabel(id, e.target.value);
                                            }}
                                            className="w-full mt-1 bg-transparent border-none text-xs text-graphite-500 font-medium focus:outline-none placeholder:text-graphite-300 p-0"
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <p className="text-[10px] text-graphite-400 font-bold">
                    {t('paymentsPage.manualMethods.footnote')}
                </p>
            </div>
        </div>
    );
};
