import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { PaymentRequiredModal } from '../components/billing/PaymentRequiredModal';

/**
 * Destino do cancel_url do Stripe Checkout pós-registro.
 * Reexibe o PaymentRequiredModal com os dados do tenant logado —
 * o usuário não avança ao dashboard sem forma de pagamento.
 */
export const RegisterPaymentPage = () => {
    const navigate = useNavigate();
    const { session, loading: authLoading } = useAuth();
    const { tenant, loading: tenantLoading } = useTenant();

    useEffect(() => {
        if (!authLoading && !session) navigate('/login', { replace: true });
    }, [authLoading, session, navigate]);

    if (authLoading || tenantLoading || !tenant) {
        return (
            <div className="min-h-screen bg-ice-50 flex items-center justify-center">
                <Loader2 className="animate-spin text-brand-primary" size={32} />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-ice-50">
            <PaymentRequiredModal
                planId={tenant.plan ?? 'essencial'}
                billingCycle={tenant.billing_cycle ?? 'monthly'}
                trialEndsAt={tenant.trial_ends_at}
            />
        </div>
    );
};
