/**
 * useStripeConnection — estado e ações da conexão Stripe Connect do tenant
 * (recebimento de pacientes; distinto da assinatura da plataforma).
 *
 * Regra de produto: funcionalidades de link de pagamento só aparecem quando
 * `canSendPaymentLinks` é true — caso contrário a opção não existe na UI
 * (sem botão desabilitado, sem upsell).
 */
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';

export type StripeConnectStatus = 'not_connected' | 'onboarding' | 'active' | 'disabled';

export function useStripeConnection() {
    const { tenant, refresh } = useTenant();
    const [busy, setBusy] = useState(false);

    const status: StripeConnectStatus = tenant?.stripe_connect_status ?? 'not_connected';
    const hasAccount = !!tenant?.stripe_account_id;
    const chargesEnabled = !!tenant?.stripe_charges_enabled;
    const canSendPaymentLinks = hasAccount && chargesEnabled;

    /** Inicia (ou retoma) o onboarding — redireciona para o Account Link da Stripe. */
    const startOnboarding = async () => {
        setBusy(true);
        try {
            const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
                body: { action: 'start' },
            });
            if (error || !data?.url) throw new Error(error?.message || 'Falha ao iniciar onboarding');
            window.location.href = data.url;
        } finally {
            setBusy(false);
        }
    };

    /** Reconsulta a Stripe e atualiza os flags do tenant (retorno do onboarding). */
    const sync = async () => {
        setBusy(true);
        try {
            const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
                body: { action: 'sync' },
            });
            if (error) throw new Error(error.message);
            await refresh(undefined, false);
            return data as { status: StripeConnectStatus; charges_enabled: boolean; default_currency: string | null };
        } finally {
            setBusy(false);
        }
    };

    /** Remove o vínculo local com a conta Stripe (a conta continua existindo na Stripe). */
    const disconnect = async () => {
        setBusy(true);
        try {
            const { error } = await supabase.functions.invoke('stripe-connect-onboard', {
                body: { action: 'disconnect' },
            });
            if (error) throw new Error(error.message);
            await refresh(undefined, false);
        } finally {
            setBusy(false);
        }
    };

    return { status, hasAccount, chargesEnabled, canSendPaymentLinks, busy, startOnboarding, sync, disconnect };
}
