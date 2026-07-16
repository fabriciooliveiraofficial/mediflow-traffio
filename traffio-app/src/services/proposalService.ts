/**
 * ProposalService — módulo Orçamentos (commercial_proposals).
 *
 * Pipeline comercial: draft → sent → viewed → approved → paid/lost.
 * Sincroniza automaticamente o funil de CRM via crm_move_stage() — nunca
 * UPDATE direto em crm_journeys. Falha do CRM é sempre best-effort: nunca
 * bloqueia uma ação comercial (enviar/aprovar/perder).
 *
 * total_cents (proposta e itens) são mantidos por trigger/generated column no
 * banco — nunca escrever esses campos diretamente pela aplicação.
 */
import { supabase } from '../lib/supabase';
import { BillingService } from './billingService';

export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'approved' | 'lost' | 'paid';
export type ProposalChannel = 'whatsapp' | 'sms' | 'email';
export type LostReason = 'price' | 'competitor' | 'no_response' | 'gave_up' | 'other';

export interface CommercialProposalItem {
    id: string;
    proposal_id: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
    /** Coluna GENERATED do banco — somente leitura. */
    total_cents: number;
    sort_order: number;
}

export interface CommercialProposal {
    id: string;
    tenant_id: string;
    patient_id: string;
    title: string;
    notes: string | null;
    valid_until: string | null;
    status: ProposalStatus;
    currency: string;
    /** Cache mantido por trigger a partir dos itens — somente leitura. */
    total_cents: number;
    sent_at: string | null;
    viewed_at: string | null;
    approved_at: string | null;
    lost_at: string | null;
    lost_reason: LostReason | null;
    paid_at: string | null;
    crm_journey_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface ProposalPatient {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
}

export type ProposalWithRelations = CommercialProposal & {
    patients: ProposalPatient;
    commercial_proposal_items: CommercialProposalItem[];
};

export interface ItemInput {
    description: string;
    quantity: number;
    unit_price_cents: number;
    sort_order?: number;
}

export interface CreateProposalPayload {
    tenant_id: string;
    patient_id: string;
    title: string;
    notes?: string;
    valid_until?: string;
    items: ItemInput[];
}

export interface ProposalChannelOption {
    id: ProposalChannel;
    available: boolean;
    reasonKey?: string;
}

const LIST_SELECT = '*, patients(id, full_name, phone, email)';
const DETAIL_SELECT = '*, patients(id, full_name, phone, email), commercial_proposal_items(*)';

function cleanPhone(raw?: string | null): string {
    return (raw || '').replace(/\D/g, '');
}

export const ProposalService = {
    async list(tenantId: string, filters?: { status?: ProposalStatus; patientId?: string; search?: string }) {
        let query = supabase
            .from('commercial_proposals')
            .select(LIST_SELECT)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (filters?.status) query = query.eq('status', filters.status);
        if (filters?.patientId) query = query.eq('patient_id', filters.patientId);

        const { data, error } = await query;
        if (error) throw error;

        let rows = (data || []) as (CommercialProposal & { patients: ProposalPatient })[];
        if (filters?.search?.trim()) {
            const term = filters.search.trim().toLowerCase();
            rows = rows.filter(r =>
                r.title.toLowerCase().includes(term) ||
                r.patients?.full_name?.toLowerCase().includes(term));
        }
        return rows;
    },

    async getById(id: string): Promise<ProposalWithRelations> {
        const { data, error } = await supabase
            .from('commercial_proposals')
            .select(DETAIL_SELECT)
            .eq('id', id)
            .single();
        if (error) throw error;
        return data as ProposalWithRelations;
    },

    /** Cria orçamento + itens atomicamente via RPC (transação única no banco). */
    async create(payload: CreateProposalPayload): Promise<CommercialProposal> {
        const { data, error } = await supabase.rpc('commercial_proposals_create', {
            p_tenant_id: payload.tenant_id,
            p_patient_id: payload.patient_id,
            p_title: payload.title,
            p_notes: payload.notes || null,
            p_valid_until: payload.valid_until || null,
            p_items: payload.items.map((it, i) => ({ ...it, sort_order: it.sort_order ?? i })),
        });
        if (error) throw error;
        return data as CommercialProposal;
    },

    async updateHeader(id: string, updates: Partial<Pick<CommercialProposal, 'title' | 'notes' | 'valid_until'>>): Promise<CommercialProposal> {
        const { data, error } = await supabase
            .from('commercial_proposals')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data as CommercialProposal;
    },

    /** Substitui a lista de itens (delete + insert). Só chamar com a proposta em 'draft'. */
    async replaceItems(proposalId: string, items: ItemInput[]): Promise<void> {
        const { error: delError } = await supabase
            .from('commercial_proposal_items')
            .delete()
            .eq('proposal_id', proposalId);
        if (delError) throw delError;

        if (items.length === 0) return;
        const { error: insError } = await supabase
            .from('commercial_proposal_items')
            .insert(items.map((it, i) => ({
                proposal_id: proposalId,
                description: it.description,
                quantity: it.quantity,
                unit_price_cents: it.unit_price_cents,
                sort_order: it.sort_order ?? i,
            })));
        if (insError) throw insError;
    },

    /** Só permitido em 'draft' — a UI deve esconder o botão fora desse status. */
    async delete(id: string): Promise<void> {
        const { error } = await supabase.from('commercial_proposals').delete().eq('id', id).eq('status', 'draft');
        if (error) throw error;
    },

    // ── Funil de CRM (best-effort — nunca bloqueia o pipeline comercial) ────────

    async _ensureJourney(tenantId: string, patientId: string, phone?: string | null): Promise<string | null> {
        try {
            const { data, error } = await supabase.rpc('crm_ensure_journey', {
                p_tenant_id: tenantId,
                p_patient_id: patientId,
                p_lead_phone: phone || null,
                p_session_id: null,
                p_origin: 'manual',
            });
            if (error) throw error;
            return data as string;
        } catch (e) {
            console.error('[ProposalService] crm_ensure_journey falhou (best-effort):', e);
            return null;
        }
    },

    async _moveCrmStage(journeyId: string | null, toStage: 'proposal' | 'won' | 'lost', reason?: string): Promise<void> {
        if (!journeyId) return;
        try {
            const { error } = await supabase.rpc('crm_move_stage', {
                p_journey_id: journeyId,
                p_to_stage: toStage,
                p_actor: 'user',
                p_reason: reason || null,
            });
            if (error) throw error;
        } catch (e) {
            console.error(`[ProposalService] crm_move_stage(${toStage}) falhou (best-effort):`, e);
        }
    },

    // ── Disponibilidade de canal (por paciente, sem depender de uma sessão selecionada) ──

    resolveChannelAvailability(tenant: { sms_enabled?: boolean; telnyx_enabled?: boolean } | null, patient: ProposalPatient): ProposalChannelOption[] {
        const phone = cleanPhone(patient.phone);
        const smsEnabled = !!(tenant?.sms_enabled || tenant?.telnyx_enabled);
        return [
            { id: 'whatsapp', available: !!phone, reasonKey: 'proposals.sendModal.reasons.noPhone' },
            { id: 'sms', available: smsEnabled && !!phone, reasonKey: !smsEnabled ? 'proposals.sendModal.reasons.smsDisabled' : 'proposals.sendModal.reasons.noPhone' },
            { id: 'email', available: !!patient.email?.trim(), reasonKey: 'proposals.sendModal.reasons.noEmail' },
        ];
    },

    /** Busca qualquer sessão existente do paciente, em qualquer canal (para o caminho de e-mail). */
    async _findAnySessionForPatient(tenantId: string, patientId: string, phone: string): Promise<string | null> {
        const orParts: string[] = [`patient_id.eq.${patientId}`];
        if (phone) orParts.push(`patient_phone.eq.${phone}`, `patient_phone.eq."+${phone}"`);
        const { data } = await supabase
            .from('conversation_sessions')
            .select('id')
            .eq('tenant_id', tenantId)
            .or(orParts.join(','))
            .order('updated_at', { ascending: false })
            .limit(1);
        return data?.[0]?.id ?? null;
    },

    /** Mesmo payload de resolveTargetSession() em send-human-message/index.ts — sessão sintética telefone-based. */
    async _createSyntheticSession(tenantId: string, patientId: string, phone: string, userId: string): Promise<string> {
        const { data, error } = await supabase
            .from('conversation_sessions')
            .insert({
                tenant_id: tenantId,
                patient_id: patientId,
                patient_phone: phone,
                channel: 'whatsapp',
                current_state: 'HUMAN_ACTIVE',
                omnichannel_status: 'human_active',
                human_handoff: true,
                assigned_to_user_id: userId,
                context: {},
            })
            .select('id')
            .single();
        if (error) throw error;
        return data.id;
    },

    /**
     * Envia o orçamento ao paciente por um canal, marca status='sent' e move o
     * funil de CRM para 'proposal' (best-effort).
     */
    async send(proposalId: string, channel: ProposalChannel, message: string, ctx: { tenantId: string; userId: string }): Promise<void> {
        const proposal = await this.getById(proposalId);
        const patient = proposal.patients;
        const phone = cleanPhone(patient.phone);

        const { data: { session: authSession } } = await supabase.auth.getSession();
        const invoke = async (body: Record<string, unknown>) => {
            const res = await supabase.functions.invoke('send-human-message', {
                body: { tenant_id: ctx.tenantId, user_id: ctx.userId, text: message, ...body },
                headers: { Authorization: `Bearer ${authSession?.access_token}` },
            });
            if (res.error || res.data?.error) throw new Error(res.error?.message || res.data?.error);
        };

        if (channel === 'whatsapp' || channel === 'sms') {
            if (!phone) throw new Error('Paciente sem telefone cadastrado.');
            await invoke({ patient_phone: phone, target_channel: channel });
        } else {
            // E-mail exige session_id na edge function — busca ou cria uma sessão.
            let sessionId = await this._findAnySessionForPatient(ctx.tenantId, patient.id, phone);
            if (!sessionId) {
                if (!phone) {
                    throw new Error('Paciente sem telefone e sem conversa iniciada — não é possível enviar por e-mail (limitação conhecida).');
                }
                sessionId = await this._createSyntheticSession(ctx.tenantId, patient.id, phone, ctx.userId);
            }
            await invoke({ session_id: sessionId, target_channel: 'email' });
        }

        const journeyId = proposal.crm_journey_id ?? await this._ensureJourney(ctx.tenantId, patient.id, phone || null);
        await this._moveCrmStage(journeyId, 'proposal', 'Orçamento enviado');

        const { error } = await supabase
            .from('commercial_proposals')
            .update({ status: 'sent', sent_at: new Date().toISOString(), crm_journey_id: journeyId })
            .eq('id', proposalId);
        if (error) throw error;
    },

    async markViewed(id: string): Promise<CommercialProposal> {
        const { data, error } = await supabase
            .from('commercial_proposals')
            .update({ status: 'viewed', viewed_at: new Date().toISOString() })
            .eq('id', id)
            .in('status', ['sent', 'viewed'])
            .select()
            .single();
        if (error) throw error;
        if (!data) throw new Error('Este orçamento já foi atualizado por outra pessoa — recarregue e tente novamente.');
        return data as CommercialProposal;
    },

    /** Guarda otimista: só aplica se o status ainda permitir aprovação (evita corrida com "marcar perdido"). */
    async approve(id: string, _ctx: { tenantId: string; userId: string }): Promise<CommercialProposal> {
        const { data, error } = await supabase
            .from('commercial_proposals')
            .update({ status: 'approved', approved_at: new Date().toISOString() })
            .eq('id', id)
            .in('status', ['sent', 'viewed'])
            .select()
            .single();
        if (error) throw error;
        if (!data) throw new Error('Este orçamento já foi atualizado por outra pessoa — recarregue e tente novamente.');

        const proposal = data as CommercialProposal;
        await this._moveCrmStage(proposal.crm_journey_id, 'won', 'Orçamento aprovado');
        return proposal;
    },

    async markLost(id: string, reason: LostReason, _ctx: { tenantId: string; userId: string }): Promise<CommercialProposal> {
        const { data, error } = await supabase
            .from('commercial_proposals')
            .update({ status: 'lost', lost_at: new Date().toISOString(), lost_reason: reason })
            .eq('id', id)
            .not('status', 'in', '("approved","paid","lost")')
            .select()
            .single();
        if (error) throw error;
        if (!data) throw new Error('Este orçamento já foi atualizado por outra pessoa — recarregue e tente novamente.');

        const proposal = data as CommercialProposal;
        await this._moveCrmStage(proposal.crm_journey_id, 'lost', reason);
        return proposal;
    },

    // ── Integração com Financeiro (livro-caixa) ─────────────────────────────────

    /** Cria o recebimento e já vincula ao orçamento numa chamada. */
    async registerPayment(proposalId: string, payload: { tenant_id: string; patient_id: string; amount_cents: number; due_date: string; payment_method?: string; notes?: string }) {
        const record = await BillingService.create(payload);
        await BillingService.update(record.id, { proposal_id: proposalId });
        await this.syncPaidStatus(proposalId);
        return record;
    },

    async getPaidTotal(proposalId: string): Promise<number> {
        const { data } = await supabase
            .from('billing_records')
            .select('amount_cents')
            .eq('proposal_id', proposalId)
            .eq('status', 'paid');
        return (data || []).reduce((sum, r) => sum + r.amount_cents, 0);
    },

    /** Se a soma dos recebimentos pagos vinculados bate (ou supera) o total, marca a proposta como 'paid'. */
    async syncPaidStatus(proposalId: string): Promise<void> {
        const proposal = await this.getById(proposalId);
        if (proposal.status !== 'approved') return; // só reconcilia orçamentos já aprovados

        const paidTotal = await this.getPaidTotal(proposalId);
        if (paidTotal >= proposal.total_cents) {
            await supabase
                .from('commercial_proposals')
                .update({ status: 'paid', paid_at: new Date().toISOString() })
                .eq('id', proposalId)
                .eq('status', 'approved');
        }
    },

    // ── KPIs para a listagem ─────────────────────────────────────────────────────

    async getKpis(tenantId: string): Promise<{
        openCount: number; openValueCents: number;
        approvedValueCents: number;
        paidThisMonthCents: number;
        approvalRatePct: number;
    }> {
        const { data } = await supabase
            .from('commercial_proposals')
            .select('status, total_cents, paid_at')
            .eq('tenant_id', tenantId);
        const rows = data || [];

        const open = rows.filter(r => ['draft', 'sent', 'viewed'].includes(r.status));
        const approved = rows.filter(r => r.status === 'approved');
        const approvedOrLost = rows.filter(r => ['approved', 'paid', 'lost'].includes(r.status));

        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const paidThisMonth = rows.filter(r => r.status === 'paid' && r.paid_at && new Date(r.paid_at) >= monthStart);

        return {
            openCount: open.length,
            openValueCents: open.reduce((s, r) => s + r.total_cents, 0),
            approvedValueCents: approved.reduce((s, r) => s + r.total_cents, 0),
            paidThisMonthCents: paidThisMonth.reduce((s, r) => s + r.total_cents, 0),
            approvalRatePct: approvedOrLost.length > 0
                ? Math.round((approvedOrLost.filter(r => r.status !== 'lost').length / approvedOrLost.length) * 100)
                : 0,
        };
    },
};
