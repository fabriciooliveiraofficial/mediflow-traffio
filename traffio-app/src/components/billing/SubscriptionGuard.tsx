import { AlertTriangle, CreditCard, Settings as SettingsIcon, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTenant } from '../../contexts/TenantContext';
import { usePlan } from '../../hooks/usePlan';
import { PaymentRequiredModal } from './PaymentRequiredModal';

interface SubscriptionGuardProps {
    children: React.ReactNode;
}

// Telas acessíveis mesmo com assinatura bloqueada (pagar/cancelar)
const ALLOWED_WHEN_BLOCKED = ['billing', 'settings'];

/**
 * Gate de assinatura das rotas autenticadas do tenant:
 *  - trial sem cartão        → PaymentRequiredModal (bloqueia TUDO)
 *  - trial expirado/suspensa → tela "Reative sua assinatura" (permite billing/settings)
 *  - cancelada               → idem, com CTA de reativação
 *  - ativa ou trial c/cartão → acesso liberado
 * Rotas master (/master/*) e portal do paciente (/portal/*) ficam fora.
 */
export const SubscriptionGuard = ({ children }: SubscriptionGuardProps) => {
    const { t } = useTranslation('billing');
    const { tenant, loading } = useTenant();
    const { isTrialExpired } = usePlan();
    const location = useLocation();
    const navigate = useNavigate();
    const activeScreen = location.pathname.split('/')[2] || 'today';

    // Sem tenant carregado (loading, super_admin etc.) → não bloqueia aqui
    if (loading || !tenant) return <>{children}</>;

    const status = tenant.subscription_status ?? 'trial';

    // ── 1. Trial sem cartão: modal não-fechável, bloqueia tudo ──────────────
    // admin_granted_trial = super_admin concedeu teste estendido sem exigir cartão
    if (status === 'trial' && !tenant.card_on_file && !tenant.admin_granted_trial && !isTrialExpired) {
        return (
            <PaymentRequiredModal
                planId={tenant.plan ?? 'essencial'}
                billingCycle={tenant.billing_cycle ?? 'monthly'}
                trialEndsAt={tenant.trial_ends_at}
            />
        );
    }

    // ── 2. Trial expirado / suspensa / cancelada: só billing e settings ─────
    const isBlocked = isTrialExpired || status === 'suspended' || status === 'canceled';

    if (isBlocked && !ALLOWED_WHEN_BLOCKED.includes(activeScreen)) {
        const copy = status === 'canceled'
            ? {
                icon: <XCircle size={32} />,
                title: t('subscriptionGuard.canceled.title'),
                message: t('subscriptionGuard.canceled.message'),
                cta: t('subscriptionGuard.canceled.cta'),
            }
            : status === 'suspended'
            ? {
                icon: <AlertTriangle size={32} />,
                title: t('subscriptionGuard.suspended.title'),
                message: t('subscriptionGuard.suspended.message'),
                cta: t('subscriptionGuard.suspended.cta'),
            }
            : {
                icon: <AlertTriangle size={32} />,
                title: t('subscriptionGuard.trialExpired.title'),
                message: t('subscriptionGuard.trialExpired.message'),
                cta: t('subscriptionGuard.trialExpired.cta'),
            };

        return (
            <div className="min-h-full flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-white rounded-[32px] shadow-xl p-8 md:p-10 border border-ice-100 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-50 text-amber-500 rounded-2xl mb-5">
                        {copy.icon}
                    </div>
                    <h2 className="text-2xl font-black text-graphite-900 mb-3">{copy.title}</h2>
                    <p className="text-sm text-graphite-500 font-medium leading-relaxed mb-8">{copy.message}</p>

                    <button
                        onClick={() => navigate('/dashboard/billing')}
                        className="w-full bg-brand-primary text-white py-4 rounded-xl font-bold shadow-lg shadow-brand-primary/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 border-none cursor-pointer mb-3"
                    >
                        <CreditCard size={18} />
                        {copy.cta}
                    </button>
                    <button
                        onClick={() => navigate('/dashboard/settings')}
                        className="w-full bg-ice-100 text-graphite-700 py-3.5 rounded-xl font-bold hover:bg-ice-200 transition-all flex items-center justify-center gap-2 border-none cursor-pointer"
                    >
                        <SettingsIcon size={16} />
                        {t('subscriptionGuard.goToSettings')}
                    </button>
                </div>
            </div>
        );
    }

    // ── 3. Ativa ou trial válido com cartão ─────────────────────────────────
    return <>{children}</>;
};
