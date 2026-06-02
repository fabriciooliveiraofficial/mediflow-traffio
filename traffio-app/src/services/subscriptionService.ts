import { supabase } from '../lib/supabase';
import type { PlanId, SubscriptionStatus, BillingCycle } from '../config/planConfig';

export interface TenantSubscription {
    plan: PlanId;
    subscription_status: SubscriptionStatus;
    billing_cycle: BillingCycle;
    subscription_started_at: string | null;
    subscription_renews_at: string | null;
    trial_ends_at: string | null;
    subscription_external_id: string | null;
}

export interface TenantInvoice {
    id: string;
    tenant_id: string;
    plan_id: PlanId;
    billing_cycle: BillingCycle;
    amount: number;
    status: 'pending' | 'paid' | 'failed' | 'refunded';
    due_date: string | null;
    paid_at: string | null;
    external_invoice_id: string | null;
    created_at: string;
}

export const subscriptionService = {
    async get(tenantId: string): Promise<TenantSubscription | null> {
        const { data, error } = await supabase
            .from('tenants')
            .select(
                'plan, subscription_status, billing_cycle, subscription_started_at, subscription_renews_at, trial_ends_at, subscription_external_id'
            )
            .eq('id', tenantId)
            .single();

        if (error) {
            console.error('subscriptionService.get error:', error);
            return null;
        }

        return data as TenantSubscription;
    },

    async update(
        tenantId: string,
        updates: Partial<TenantSubscription>
    ): Promise<void> {
        const { error } = await supabase
            .from('tenants')
            .update(updates)
            .eq('id', tenantId);

        if (error) throw error;
    },

    async activate(
        tenantId: string,
        plan: PlanId,
        billingCycle: BillingCycle,
        externalId?: string
    ): Promise<void> {
        const now = new Date();
        const renewsAt = new Date(now);
        if (billingCycle === 'annual') {
            renewsAt.setFullYear(renewsAt.getFullYear() + 1);
        } else {
            renewsAt.setMonth(renewsAt.getMonth() + 1);
        }

        await subscriptionService.update(tenantId, {
            plan,
            subscription_status: 'active',
            billing_cycle: billingCycle,
            subscription_started_at: now.toISOString(),
            subscription_renews_at: renewsAt.toISOString(),
            trial_ends_at: null,
            subscription_external_id: externalId ?? null,
        });
    },

    async listInvoices(tenantId: string): Promise<TenantInvoice[]> {
        const { data, error } = await supabase
            .from('tenant_invoices')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('subscriptionService.listInvoices error:', error);
            return [];
        }

        return (data ?? []) as TenantInvoice[];
    },

    /** Retorna true se o tenant está em trial expirado */
    isTrialExpired(subscription: TenantSubscription): boolean {
        if (subscription.subscription_status !== 'trial') return false;
        if (!subscription.trial_ends_at) return false;
        return new Date(subscription.trial_ends_at) < new Date();
    },

    /** Retorna dias restantes de trial (negativo se expirado) */
    trialDaysLeft(subscription: TenantSubscription): number {
        if (!subscription.trial_ends_at) return 0;
        const diff = new Date(subscription.trial_ends_at).getTime() - Date.now();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    },
};
