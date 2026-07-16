import { supabase } from '../lib/supabase';

export interface BillingRecord {
    id: string;
    tenant_id: string;
    patient_id: string;
    appointment_id?: string;
    amount_cents: number;
    /** ISO 4217 — snapshot da moeda do tenant na criação (trigger no banco preenche se omitido). */
    currency?: string;
    status: 'pending' | 'paid' | 'overdue' | 'canceled' | 'refunded';
    payment_method?: string;
    asaas_billing_id?: string;
    stripe_checkout_session_id?: string;
    stripe_payment_intent_id?: string;
    payment_link_url?: string;
    receipt_number?: number;
    installment_no?: number;
    installment_count?: number;
    /** Vincula este recebimento a um orçamento (commercial_proposals) — ver ProposalService. */
    proposal_id?: string;
    due_date: string;
    paid_at?: string;
    notes?: string;
    created_at: string;
}

interface CreateBillingPayload {
    tenant_id: string;
    patient_id: string;
    appointment_id?: string;
    amount_cents: number;
    due_date: string;
    payment_method?: string;
    notes?: string;
}

interface AsaasConfig {
    api_key: string;
    sandbox: boolean;
}

const ASAAS_BASE = {
    sandbox: 'https://sandbox.asaas.com/api/v3',
    production: 'https://api.asaas.com/api/v3',
};

async function getAsaasConfig(tenantId: string): Promise<AsaasConfig | null> {
    const { data } = await supabase
        .from('tenants')
        .select('asaas_api_key')
        .eq('id', tenantId)
        .single();

    if (!data?.asaas_api_key) return null;

    return {
        api_key: data.asaas_api_key,
        sandbox: data.asaas_api_key.startsWith('$aact_') === false, // sandbox keys start with different prefix
    };
}

export const BillingService = {

    async list(tenantId: string, filters?: { status?: string; from?: string; to?: string }) {
        let query = supabase
            .from('billing_records')
            .select('*, patients(full_name, email, phone)')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (filters?.status) query = query.eq('status', filters.status);
        if (filters?.from) query = query.gte('due_date', filters.from);
        if (filters?.to) query = query.lte('due_date', filters.to);

        const { data, error } = await query;
        if (error) throw error;
        return data as (BillingRecord & { patients: { full_name: string; email: string; phone: string } })[];
    },

    async create(payload: CreateBillingPayload): Promise<BillingRecord> {
        const { data, error } = await supabase
            .from('billing_records')
            .insert([{
                ...payload,
                status: 'pending',
            }])
            .select()
            .single();

        if (error) throw error;
        return data as BillingRecord;
    },

    async update(id: string, updates: Partial<BillingRecord>): Promise<BillingRecord> {
        const { data, error } = await supabase
            .from('billing_records')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data as BillingRecord;
    },

    async markPaid(id: string, paymentMethod: string = 'cash') {
        return this.update(id, {
            status: 'paid',
            payment_method: paymentMethod,
            paid_at: new Date().toISOString(),
        });
    },

    async cancel(id: string) {
        return this.update(id, { status: 'canceled' });
    },

    async delete(id: string) {
        const { error } = await supabase.from('billing_records').delete().eq('id', id);
        if (error) throw error;
    },

    async getSummary(tenantId: string) {
        const { data: billing } = await supabase
            .from('billing_records')
            .select('amount_cents, status, due_date')
            .eq('tenant_id', tenantId);

        if (!billing) return { total: 0, paid: 0, pending: 0, overdue: 0 };

        const today = new Date().toISOString().slice(0, 10);
        return {
            total: billing.reduce((sum, b) => sum + b.amount_cents, 0),
            paid: billing.filter(b => b.status === 'paid').reduce((sum, b) => sum + b.amount_cents, 0),
            pending: billing.filter(b => b.status === 'pending').reduce((sum, b) => sum + b.amount_cents, 0),
            overdue: billing.filter(b => b.status === 'pending' && b.due_date && b.due_date < today).reduce((sum, b) => sum + b.amount_cents, 0),
        };
    },

    // ---- Asaas Integration (LEGADO — em remoção; ver plano Financeiro/Stripe Connect) ----

    async createAsaasCharge(tenantId: string, billingId: string, customerAsaasId: string) {
        const config = await getAsaasConfig(tenantId);
        if (!config) throw new Error('Asaas não configurado para este tenant.');

        const { data: billing } = await supabase
            .from('billing_records')
            .select('*')
            .eq('id', billingId)
            .single();

        if (!billing) throw new Error('Cobrança não encontrada.');

        const baseUrl = config.sandbox ? ASAAS_BASE.sandbox : ASAAS_BASE.production;

        const response = await fetch(`${baseUrl}/payments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'access_token': config.api_key,
            },
            body: JSON.stringify({
                customer: customerAsaasId,
                billingType: 'UNDEFINED', // Let customer choose
                value: billing.amount_cents / 100,
                dueDate: billing.due_date,
                description: billing.notes || 'Cobrança Traffio',
                externalReference: billingId,
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.errors?.[0]?.description || 'Erro ao criar cobrança no Asaas');
        }

        await this.update(billingId, { asaas_billing_id: result.id });

        return result;
    },

    async processWebhook(event: string, paymentId: string) {
        if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) return;

        const { data: billing } = await supabase
            .from('billing_records')
            .select('id')
            .eq('asaas_billing_id', paymentId)
            .single();

        if (billing) {
            await this.update(billing.id, {
                status: 'paid',
                paid_at: new Date().toISOString(),
            });
        }
    },

    async getDetailedAnalytics(tenantId: string) {
        const [billingRes, proposalsRes] = await Promise.all([
            supabase.from('billing_records').select('payment_method, amount_cents').eq('tenant_id', tenantId),
            supabase.from('financing_proposals').select('status, amount').eq('tenant_id', tenantId)
        ]);

        const billing = billingRes.data || [];
        const proposals = proposalsRes.data || [];

        // Mix Distribution
        const mix = {
            pix: billing.filter(b => b.payment_method === 'pix').reduce((s, b) => s + b.amount_cents, 0),
            card: billing.filter(b => ['credit_card', 'card_machine', 'stripe'].includes(b.payment_method || '')).reduce((s, b) => s + b.amount_cents, 0),
            financing: proposals.filter(p => p.status === 'signed').reduce((s, p) => s + (p.amount * 100), 0),
            others: billing.filter(b => !['pix', 'credit_card', 'card_machine', 'stripe'].includes(b.payment_method || '')).reduce((s, b) => s + b.amount_cents, 0)
        };

        const totalProposals = proposals.length;
        const approvedProposals = proposals.filter(p => ['approved', 'signed'].includes(p.status)).length;
        const approvalRate = totalProposals > 0 ? (approvedProposals / totalProposals) * 100 : 0;

        return {
            mix,
            approvalRate,
            totalFinancingVolume: mix.financing,
            activeProposals: proposals.filter(p => p.status === 'pending').length
        };
    }
};
