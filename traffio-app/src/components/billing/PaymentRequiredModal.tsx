import { useState } from 'react';
import { CreditCard, Loader2, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PLANS, formatPrice, type PlanId, type BillingCycle } from '../../config/planConfig';

interface PaymentRequiredModalProps {
    planId: PlanId;
    billingCycle: BillingCycle;
    /** ISO date — fim do trial (default: hoje + 14 dias) */
    trialEndsAt?: string | null;
}

/**
 * Modal NÃO-FECHÁVEL exibido após o registro (e pelo SubscriptionGuard
 * para contas sem cartão). O usuário só avança adicionando uma forma
 * de pagamento via Stripe Checkout — nada é cobrado durante o trial.
 */
export const PaymentRequiredModal = ({ planId, billingCycle, trialEndsAt }: PaymentRequiredModalProps) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const plan = PLANS[planId];
    const PlanIcon = plan.icon;
    const price = billingCycle === 'annual' ? plan.annualMonthlyPrice : plan.monthlyPrice;

    const trialEndDate = trialEndsAt
        ? new Date(trialEndsAt)
        : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const trialEndLabel = trialEndDate.toLocaleDateString('pt-BR');

    const handleAddPayment = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

            const res = await supabase.functions.invoke('stripe-create-checkout', {
                body: {
                    plan_id:       planId,
                    billing_cycle: billingCycle,
                    success_url:   `${window.location.origin}/dashboard?welcome=1`,
                    cancel_url:    `${window.location.origin}/register/payment`,
                },
            });

            if (res.error) throw new Error(res.error.message);

            const { url, redirect_to_sales } = res.data;
            if (redirect_to_sales) {
                window.location.href = 'mailto:contato@traffio.com.br?subject=Plano Rede';
                return;
            }
            if (!url) throw new Error('Não foi possível iniciar o checkout. Tente novamente.');
            localStorage.removeItem('traffio_tenant');
            window.location.href = url;
        } catch (err: any) {
            console.error('[PaymentRequiredModal] checkout error:', err);
            setError(err.message || 'Erro ao iniciar o checkout. Tente novamente.');
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-graphite-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-[32px] shadow-2xl p-8 md:p-10 border border-ice-100 animate-in fade-in zoom-in duration-300">
                <div className="text-center mb-6">
                    <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-primary/10 text-brand-primary rounded-2xl mb-4">
                        <CreditCard size={28} />
                    </div>
                    <h2 className="text-2xl font-black text-graphite-900 mb-2">Falta só um passo!</h2>
                    <p className="text-sm text-graphite-500 font-medium">
                        Adicione uma forma de pagamento para liberar seus 14 dias grátis.
                    </p>
                </div>

                {/* Resumo do plano */}
                <div className="mb-6 p-4 rounded-2xl border border-ice-200 bg-ice-50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${plan.badgeClass}`}>
                            <PlanIcon size={20} />
                        </div>
                        <div>
                            <p className="text-sm font-black text-graphite-900">{plan.name} · {billingCycle === 'annual' ? 'Anual' : 'Mensal'}</p>
                            <p className="text-[11px] font-bold text-graphite-400">cobrado a partir de {trialEndLabel}</p>
                        </div>
                    </div>
                    <p className="text-lg font-black text-graphite-900 shrink-0">{formatPrice(price)}<span className="text-xs font-medium text-graphite-400">/mês</span></p>
                </div>

                {/* Garantias do trial */}
                <ul className="space-y-3 mb-6">
                    {[
                        '14 dias grátis para testar — nada será cobrado hoje',
                        'Cancele a qualquer momento na página Assinatura → Gerenciar Faturamento, sem custo',
                        'Sua assinatura só é cobrada após o fim dos 14 dias de trial',
                    ].map(item => (
                        <li key={item} className="flex items-start gap-2.5">
                            <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                            <span className="text-sm font-medium text-graphite-600">{item}</span>
                        </li>
                    ))}
                </ul>

                {error && (
                    <div className="mb-4 bg-rose-50 text-rose-600 p-3 rounded-xl flex items-start gap-2 text-sm font-medium">
                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                )}

                <button
                    onClick={handleAddPayment}
                    disabled={loading}
                    className="w-full bg-brand-primary text-white py-4 rounded-xl font-bold shadow-lg shadow-brand-primary/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed border-none cursor-pointer"
                >
                    {loading ? <Loader2 className="animate-spin" size={20} /> : (
                        <>
                            <CreditCard size={18} />
                            Adicionar forma de pagamento
                        </>
                    )}
                </button>

                <p className="mt-4 text-center text-[11px] text-graphite-400 font-medium flex items-center justify-center gap-1">
                    <ShieldCheck size={12} className="text-emerald-500" />
                    Pagamento processado com segurança pela Stripe
                </p>
            </div>
        </div>
    );
};
