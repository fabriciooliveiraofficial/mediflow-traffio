import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    FileText, Plus, Search, Send, Check, X, Trash2, Loader2,
    Wallet, TrendingUp, Clock, ChevronRight, AlertTriangle, ArrowLeft, CreditCard,
} from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useTenantMoney } from '../hooks/useTenantMoney';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useStripeConnection } from '../hooks/useStripeConnection';
import { supabase } from '../lib/supabase';
import { PageHeader, KpiCard, Badge, EmptyState, Button } from '../components/ui';
import { SendProposalChannelModal } from '../components/channel/SendProposalChannelModal';
import { BillingRecordModal } from '../components/billing/BillingRecordModal';
import {
    ProposalService,
    type CommercialProposal,
    type ProposalWithRelations,
    type ProposalPatient,
    type ProposalStatus,
    type ItemInput,
    type ProposalChannel,
    type LostReason,
    type ProposalChannelOption,
} from '../services/proposalService';

const STATUS_LIST: ProposalStatus[] = ['draft', 'sent', 'viewed', 'approved', 'paid', 'lost'];
const STATUS_ACCENT: Record<ProposalStatus, 'neutral' | 'info' | 'success' | 'error' | 'brand'> = {
    draft: 'neutral', sent: 'info', viewed: 'info', approved: 'success', paid: 'brand', lost: 'error',
};
const LOST_REASONS: LostReason[] = ['price', 'competitor', 'no_response', 'gave_up', 'other'];

interface ProposalsPageProps {
    onSelectPatient?: (id: string) => void;
}

export function ProposalsPage({ onSelectPatient }: ProposalsPageProps) {
    const { t } = useTranslation('tenantAdmin');
    const { tenant } = useTenant();
    const { user } = useAuth();
    const { showToast } = useToast();
    const { formatCentsIn } = useTenantMoney();
    const { formatDate } = useLocaleFormat();

    const tenantId = tenant?.id;
    const userId = user?.id;

    const [loading, setLoading] = useState(true);
    const [proposals, setProposals] = useState<(CommercialProposal & { patients: ProposalPatient })[]>([]);
    const [kpis, setKpis] = useState<Awaited<ReturnType<typeof ProposalService.getKpis>> | null>(null);
    const [statusFilter, setStatusFilter] = useState<ProposalStatus | 'all'>('all');
    const [search, setSearch] = useState('');

    const [showFormModal, setShowFormModal] = useState(false);
    const [editingProposal, setEditingProposal] = useState<ProposalWithRelations | null>(null);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [detailProposal, setDetailProposal] = useState<ProposalWithRelations | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const load = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const [list, kpiData] = await Promise.all([
                ProposalService.list(tenantId, { status: statusFilter === 'all' ? undefined : statusFilter, search: search || undefined }),
                ProposalService.getKpis(tenantId),
            ]);
            setProposals(list);
            setKpis(kpiData);
        } catch (err: any) {
            showToast('error', t('proposals.toasts.loadError', { message: err.message }));
        } finally {
            setLoading(false);
        }
    }, [tenantId, statusFilter, search]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { load(); }, [load]);

    const loadDetail = useCallback(async (id: string) => {
        setDetailLoading(true);
        try {
            const p = await ProposalService.getById(id);
            setDetailProposal(p);
        } catch (err: any) {
            showToast('error', t('proposals.toasts.loadError', { message: err.message }));
            setDetailId(null);
        } finally {
            setDetailLoading(false);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { if (detailId) loadDetail(detailId); }, [detailId, loadDetail]);

    const openCreate = () => { setEditingProposal(null); setShowFormModal(true); };
    const openEdit = async (id: string) => {
        const p = await ProposalService.getById(id);
        setEditingProposal(p);
        setShowFormModal(true);
    };
    const closeForm = () => { setShowFormModal(false); setEditingProposal(null); };
    const afterSave = async () => { closeForm(); await load(); if (detailId) loadDetail(detailId); };

    const handleDelete = async (id: string) => {
        try {
            await ProposalService.delete(id);
            showToast('success', t('proposals.toasts.deleteSuccess'));
            if (detailId === id) setDetailId(null);
            await load();
        } catch (err: any) {
            showToast('error', t('proposals.toasts.deleteError', { message: err.message }));
        }
    };

    return (
        <div className="px-6 lg:px-12 py-8 space-y-6 max-w-6xl mx-auto">
            <PageHeader
                icon={FileText}
                title={t('proposals.title')}
                subtitle={t('proposals.subtitle')}
                actions={<Button onClick={openCreate}><Plus size={16} />{t('proposals.newButton')}</Button>}
            />

            {kpis && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <KpiCard label={t('proposals.kpis.open')} value={kpis.openCount} subValue={formatCentsIn(kpis.openValueCents)} icon={Clock} accent="info" />
                    <KpiCard label={t('proposals.kpis.approvedPending')} value={formatCentsIn(kpis.approvedValueCents)} icon={Wallet} accent="warning" />
                    <KpiCard label={t('proposals.kpis.paidThisMonth')} value={formatCentsIn(kpis.paidThisMonthCents)} icon={TrendingUp} accent="success" />
                    <KpiCard label={t('proposals.kpis.approvalRate')} value={`${kpis.approvalRatePct}%`} icon={Check} accent="brand" />
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <Badge
                    accent={statusFilter === 'all' ? 'brand' : 'neutral'}
                    onClick={() => setStatusFilter('all')}
                    className="cursor-pointer"
                >
                    {t('proposals.status.all')}
                </Badge>
                {STATUS_LIST.map(s => (
                    <Badge
                        key={s}
                        accent={statusFilter === s ? STATUS_ACCENT[s] : 'neutral'}
                        onClick={() => setStatusFilter(s)}
                        className="cursor-pointer"
                    >
                        {t(`proposals.status.${s}`)}
                    </Badge>
                ))}
                <div className="relative ml-auto">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t('proposals.searchPlaceholder')}
                        className="pl-9 pr-4 py-2 rounded-xl bg-ice-50 border border-ice-100 text-xs font-medium text-graphite-700 focus:outline-none focus:border-brand-primary w-56"
                    />
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-primary" size={28} /></div>
            ) : proposals.length === 0 ? (
                <EmptyState icon={FileText} label={t('proposals.emptyState')} hint={t('proposals.emptyStateHint')} />
            ) : (
                <div className="bg-white rounded-3xl shadow-float overflow-hidden divide-y divide-ice-100">
                    {proposals.map(p => (
                        <button
                            key={p.id}
                            onClick={() => setDetailId(p.id)}
                            className="w-full flex items-center gap-4 px-6 py-4 hover:bg-ice-50/60 transition-colors text-left border-0 bg-transparent cursor-pointer"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-graphite-900 truncate">{p.patients?.full_name || t('proposals.table.patientFallback')}</p>
                                <p className="text-xs text-graphite-400 truncate">{p.title}</p>
                            </div>
                            <p className="text-sm font-black text-graphite-800 tabular-nums shrink-0">
                                {formatCentsIn(p.total_cents, p.currency)}
                            </p>
                            <Badge accent={STATUS_ACCENT[p.status]} className="shrink-0">{t(`proposals.status.${p.status}`)}</Badge>
                            <p className="text-[11px] text-graphite-300 shrink-0 w-20 text-right">{formatDate(p.created_at)}</p>
                            <ChevronRight size={16} className="text-graphite-300 shrink-0" />
                        </button>
                    ))}
                </div>
            )}

            {showFormModal && (
                <ProposalFormModal
                    tenantId={tenantId!}
                    editing={editingProposal}
                    onClose={closeForm}
                    onSaved={afterSave}
                />
            )}

            {(detailId && (detailProposal || detailLoading)) && (
                <ProposalDetailDrawer
                    proposal={detailProposal}
                    loading={detailLoading}
                    tenantId={tenantId!}
                    userId={userId!}
                    tenant={tenant}
                    onClose={() => { setDetailId(null); setDetailProposal(null); }}
                    onEdit={() => detailProposal && openEdit(detailProposal.id)}
                    onDelete={() => detailProposal && handleDelete(detailProposal.id)}
                    onChanged={async () => { await load(); if (detailId) loadDetail(detailId); }}
                    onSelectPatient={onSelectPatient}
                />
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal de criação/edição (cabeçalho + itens)
// ─────────────────────────────────────────────────────────────────────────────

function ProposalFormModal({ tenantId, editing, onClose, onSaved }: {
    tenantId: string;
    editing: ProposalWithRelations | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useTranslation('tenantAdmin');
    const { showToast } = useToast();
    const { currency } = useTenantMoney();

    const [patients, setPatients] = useState<{ id: string; full_name: string }[]>([]);
    const [patientId, setPatientId] = useState(editing?.patient_id || '');
    const [title, setTitle] = useState(editing?.title || '');
    const [notes, setNotes] = useState(editing?.notes || '');
    const [validUntil, setValidUntil] = useState(editing?.valid_until || '');
    const [items, setItems] = useState<(ItemInput & { _priceInput: string })[]>(
        editing?.commercial_proposal_items?.length
            ? editing.commercial_proposal_items
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(it => ({ description: it.description, quantity: it.quantity, unit_price_cents: it.unit_price_cents, _priceInput: (it.unit_price_cents / 100).toFixed(2) }))
            : [{ description: '', quantity: 1, unit_price_cents: 0, _priceInput: '' }]
    );
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        supabase.from('patients').select('id, full_name').eq('tenant_id', tenantId).order('full_name')
            .then(({ data }) => { if (data) setPatients(data); });
    }, [tenantId]);

    const totalPreviewCents = items.reduce((sum, it) => sum + Math.round(it.quantity * it.unit_price_cents), 0);

    const updateItem = (idx: number, patch: Partial<ItemInput & { _priceInput: string }>) => {
        setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
    };
    const addItem = () => setItems(prev => [...prev, { description: '', quantity: 1, unit_price_cents: 0, _priceInput: '' }]);
    const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

    const handleSave = async () => {
        if (!patientId || !title.trim()) {
            showToast('error', t('proposals.toasts.validationError'));
            return;
        }
        const validItems: ItemInput[] = items
            .filter(it => it.description.trim() && it.unit_price_cents > 0)
            .map((it, i) => ({ description: it.description.trim(), quantity: it.quantity, unit_price_cents: it.unit_price_cents, sort_order: i }));
        if (validItems.length === 0) {
            showToast('error', t('proposals.toasts.noItemsError'));
            return;
        }

        setSaving(true);
        try {
            if (editing) {
                await ProposalService.updateHeader(editing.id, { title: title.trim(), notes: notes.trim() || null, valid_until: validUntil || null });
                await ProposalService.replaceItems(editing.id, validItems);
                showToast('success', t('proposals.toasts.updateSuccess'));
            } else {
                await ProposalService.create({ tenant_id: tenantId, patient_id: patientId, title: title.trim(), notes: notes.trim() || undefined, valid_until: validUntil || undefined, items: validItems });
                showToast('success', t('proposals.toasts.createSuccess'));
            }
            onSaved();
        } catch (err: any) {
            showToast('error', t('proposals.toasts.saveError', { message: err.message }));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && onClose()} />
            <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
                <div className="px-6 pt-5 pb-4 border-b border-ice-100 flex items-center justify-between">
                    <h3 className="text-base font-black text-graphite-900">
                        {editing ? t('proposals.modal.editTitle') : t('proposals.modal.newTitle')}
                    </h3>
                    <button onClick={() => !saving && onClose()} className="p-1.5 rounded-lg hover:bg-ice-100 text-graphite-400 border-0 bg-transparent cursor-pointer">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1.5 block">{t('proposals.modal.patientLabel')}</label>
                            <select
                                value={patientId}
                                disabled={!!editing}
                                onChange={e => setPatientId(e.target.value)}
                                className="w-full bg-ice-50 border border-ice-100 rounded-xl px-4 py-2.5 text-sm font-bold text-graphite-800 focus:outline-none focus:border-brand-primary disabled:opacity-60"
                            >
                                <option value="">{t('proposals.modal.patientPlaceholder')}</option>
                                {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1.5 block">{t('proposals.modal.validUntilLabel')}</label>
                            <input
                                type="date" value={validUntil || ''} onChange={e => setValidUntil(e.target.value)}
                                className="w-full bg-ice-50 border border-ice-100 rounded-xl px-4 py-2.5 text-sm font-bold text-graphite-800 focus:outline-none focus:border-brand-primary"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1.5 block">{t('proposals.modal.titleLabel')}</label>
                        <input
                            value={title} onChange={e => setTitle(e.target.value)}
                            placeholder={t('proposals.modal.titlePlaceholder')}
                            className="w-full bg-ice-50 border border-ice-100 rounded-xl px-4 py-2.5 text-sm font-bold text-graphite-800 focus:outline-none focus:border-brand-primary"
                        />
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{t('proposals.modal.itemsTitle')}</label>
                            <button onClick={addItem} className="flex items-center gap-1 text-xs font-black text-brand-primary border-0 bg-transparent cursor-pointer">
                                <Plus size={13} />{t('proposals.modal.addItem')}
                            </button>
                        </div>
                        <div className="space-y-2">
                            {items.map((it, idx) => (
                                <div key={idx} className="flex items-center gap-2 bg-ice-50/60 border border-ice-100 rounded-xl p-2.5">
                                    <input
                                        value={it.description}
                                        onChange={e => updateItem(idx, { description: e.target.value })}
                                        placeholder={t('proposals.modal.descriptionLabel')}
                                        className="flex-1 min-w-0 bg-white border border-ice-100 rounded-lg px-3 py-2 text-xs font-medium focus:outline-none focus:border-brand-primary"
                                    />
                                    <input
                                        type="number" min="0.01" step="0.01" value={it.quantity}
                                        onChange={e => updateItem(idx, { quantity: Math.max(0.01, parseFloat(e.target.value) || 1) })}
                                        title={t('proposals.modal.quantityLabel')}
                                        className="w-16 bg-white border border-ice-100 rounded-lg px-2 py-2 text-xs font-bold text-center focus:outline-none focus:border-brand-primary"
                                    />
                                    <input
                                        type="text" inputMode="decimal" value={it._priceInput}
                                        onChange={e => {
                                            const raw = e.target.value;
                                            const parsed = parseFloat(raw.replace(',', '.'));
                                            updateItem(idx, { _priceInput: raw, unit_price_cents: isNaN(parsed) ? 0 : Math.round(parsed * 100) });
                                        }}
                                        placeholder={`0.00 ${currency}`}
                                        title={t('proposals.modal.unitPriceLabel')}
                                        className="w-28 bg-white border border-ice-100 rounded-lg px-3 py-2 text-xs font-bold text-right focus:outline-none focus:border-brand-primary"
                                    />
                                    <button onClick={() => removeItem(idx)} disabled={items.length === 1} className="p-1.5 text-graphite-300 hover:text-accent-error border-0 bg-transparent cursor-pointer disabled:opacity-30">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1.5 block">{t('proposals.modal.notesLabel')}</label>
                        <textarea
                            value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                            className="w-full bg-ice-50 border border-ice-100 rounded-xl px-4 py-2.5 text-xs font-medium text-graphite-700 focus:outline-none focus:border-brand-primary resize-none"
                        />
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-ice-100 flex items-center justify-between">
                    <p className="text-sm font-black text-graphite-900">
                        {t('proposals.modal.totalLabel')}: {(totalPreviewCents / 100).toLocaleString(undefined, { style: 'currency', currency })}
                    </p>
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} disabled={saving} className="px-4 py-2.5 rounded-xl text-xs font-bold text-graphite-500 hover:bg-ice-100 border-0 bg-transparent cursor-pointer disabled:opacity-50">
                            {t('proposals.modal.cancel')}
                        </button>
                        <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black text-white bg-brand-primary hover:opacity-90 border-0 cursor-pointer disabled:opacity-50">
                            {saving && <Loader2 size={14} className="animate-spin" />}
                            {t('proposals.modal.save')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawer de detalhe
// ─────────────────────────────────────────────────────────────────────────────

function ProposalDetailDrawer({ proposal, loading, tenantId, userId, tenant, onClose, onEdit, onDelete, onChanged, onSelectPatient }: {
    proposal: ProposalWithRelations | null;
    loading: boolean;
    tenantId: string;
    userId: string;
    tenant: any;
    onClose: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onChanged: () => void;
    onSelectPatient?: (id: string) => void;
}) {
    const { t } = useTranslation('tenantAdmin');
    const { showToast } = useToast();
    const { formatCentsIn } = useTenantMoney();
    const { formatDateTime } = useLocaleFormat();
    const { canSendPaymentLinks } = useStripeConnection();

    const [channelOptions, setChannelOptions] = useState<ProposalChannelOption[] | null>(null);
    const [showSendModal, setShowSendModal] = useState(false);
    const [sending, setSending] = useState(false);
    const [showLostReason, setShowLostReason] = useState(false);
    const [lostReason, setLostReason] = useState<LostReason>('price');
    const [busy, setBusy] = useState(false);
    const [paidTotal, setPaidTotal] = useState(0);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [generatingLink, setGeneratingLink] = useState(false);

    const handleGeneratePaymentLink = async () => {
        if (!proposal) return;
        setGeneratingLink(true);
        try {
            const { data, error } = await supabase.functions.invoke('stripe-connect-create-payment-link', {
                body: { proposal_id: proposal.id },
            });
            if (error || !data?.url) throw new Error(error?.message || data?.error || t('proposals.detail.stripeLinkError'));
            await navigator.clipboard.writeText(data.url);
            showToast('success', t('proposals.detail.stripeLinkCopied'));
        } catch (err: any) {
            showToast('error', err.message || t('proposals.detail.stripeLinkError'));
        } finally {
            setGeneratingLink(false);
        }
    };

    useEffect(() => {
        if (proposal?.status === 'approved' || proposal?.status === 'paid') {
            ProposalService.getPaidTotal(proposal.id).then(setPaidTotal);
        }
    }, [proposal?.id, proposal?.status]);

    if (loading || !proposal) {
        return (
            <div className="fixed inset-0 z-[80] flex items-center justify-end">
                <div className="absolute inset-0 bg-black/30" onClick={onClose} />
                <div className="relative w-full max-w-md h-full bg-white shadow-2xl flex items-center justify-center">
                    <Loader2 className="animate-spin text-brand-primary" size={28} />
                </div>
            </div>
        );
    }

    const openSend = () => {
        const options = ProposalService.resolveChannelAvailability(tenant, proposal.patients);
        setChannelOptions(options);
        setShowSendModal(true);
    };

    const messagePreview = t('proposals.sendModal.messageTemplate', {
        patientName: proposal.patients?.full_name?.split(' ')[0] || '',
        clinicName: tenant?.name || '',
        title: proposal.title,
        total: formatCentsIn(proposal.total_cents, proposal.currency),
    });

    const handleConfirmSend = async (channel: ProposalChannel) => {
        setSending(true);
        try {
            await ProposalService.send(proposal.id, channel, messagePreview, { tenantId, userId });
            showToast('success', t('proposals.toasts.sentSuccess'));
            setShowSendModal(false);
            onChanged();
        } catch (err: any) {
            showToast('error', t('proposals.toasts.sendError', { message: err.message }));
        } finally {
            setSending(false);
        }
    };

    const handleApprove = async () => {
        setBusy(true);
        try {
            await ProposalService.approve(proposal.id, { tenantId, userId });
            showToast('success', t('proposals.toasts.approvedSuccess'));
            onChanged();
        } catch (err: any) {
            showToast('error', t('proposals.toasts.approveError', { message: err.message }));
        } finally {
            setBusy(false);
        }
    };

    const handleMarkLost = async () => {
        setBusy(true);
        try {
            await ProposalService.markLost(proposal.id, lostReason, { tenantId, userId });
            showToast('success', t('proposals.toasts.lostSuccess'));
            setShowLostReason(false);
            onChanged();
        } catch (err: any) {
            showToast('error', t('proposals.toasts.lostError', { message: err.message }));
        } finally {
            setBusy(false);
        }
    };

    const remainingCents = Math.max(0, proposal.total_cents - paidTotal);
    const timelineSteps: { key: string; at: string | null }[] = [
        { key: 'draft', at: proposal.created_at },
        { key: 'sent', at: proposal.sent_at },
        { key: 'viewed', at: proposal.viewed_at },
        { key: proposal.status === 'lost' ? 'lost' : 'approved', at: proposal.status === 'lost' ? proposal.lost_at : proposal.approved_at },
        ...(proposal.status === 'paid' ? [{ key: 'paid', at: proposal.paid_at }] : []),
    ];

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-end">
            <div className="absolute inset-0 bg-black/30" onClick={onClose} />
            <div className="relative w-full max-w-md h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                <div className="px-6 pt-5 pb-4 border-b border-ice-100 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <button onClick={onClose} className="flex items-center gap-1 text-xs font-bold text-graphite-400 hover:text-graphite-600 border-0 bg-transparent cursor-pointer mb-2">
                            <ArrowLeft size={13} />{t('proposals.detail.back')}
                        </button>
                        <h3 className="text-lg font-black text-graphite-900 truncate">{proposal.title}</h3>
                        <button
                            onClick={() => onSelectPatient?.(proposal.patient_id)}
                            className="text-xs font-bold text-brand-primary border-0 bg-transparent cursor-pointer p-0 mt-0.5"
                        >
                            {proposal.patients?.full_name}
                        </button>
                    </div>
                    <Badge accent={STATUS_ACCENT[proposal.status]} className="shrink-0">{t(`proposals.status.${proposal.status}`)}</Badge>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {/* Itens */}
                    <div className="space-y-1.5">
                        {proposal.commercial_proposal_items?.sort((a, b) => a.sort_order - b.sort_order).map(it => (
                            <div key={it.id} className="flex items-center justify-between text-xs">
                                <span className="text-graphite-600 truncate flex-1">{it.description} {it.quantity !== 1 && `× ${it.quantity}`}</span>
                                <span className="font-bold text-graphite-800 shrink-0 ml-2">{formatCentsIn(it.total_cents, proposal.currency)}</span>
                            </div>
                        ))}
                        <div className="flex items-center justify-between pt-2 border-t border-ice-100">
                            <span className="text-xs font-black text-graphite-900">{t('proposals.modal.totalLabel')}</span>
                            <span className="text-sm font-black text-graphite-900">{formatCentsIn(proposal.total_cents, proposal.currency)}</span>
                        </div>
                    </div>

                    {/* Timeline */}
                    <div>
                        <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-2">{t('proposals.detail.timeline')}</p>
                        <div className="space-y-1.5">
                            {timelineSteps.filter(s => s.at).map(s => (
                                <div key={s.key} className="flex items-center gap-2 text-xs">
                                    <Check size={12} className="text-accent-success shrink-0" />
                                    <span className="text-graphite-600">{t(`proposals.status.${s.key}`)}</span>
                                    <span className="text-graphite-300 ml-auto">{formatDateTime(s.at!)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Recebimentos vinculados */}
                    {(proposal.status === 'approved' || proposal.status === 'paid') && (
                        <div className="p-3 rounded-2xl bg-ice-50 border border-ice-100">
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">{t('proposals.detail.linkedPayments')}</p>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-graphite-500">{t('proposals.detail.paidSoFar')}</span>
                                <span className="font-bold text-graphite-800">{formatCentsIn(paidTotal, proposal.currency)}</span>
                            </div>
                            {remainingCents > 0 && (
                                <div className="flex items-center justify-between text-xs mt-0.5">
                                    <span className="text-graphite-500">{t('proposals.detail.remaining')}</span>
                                    <span className="font-bold text-accent-warning">{formatCentsIn(remainingCents, proposal.currency)}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {proposal.notes && (
                        <div>
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">{t('proposals.modal.notesLabel')}</p>
                            <p className="text-xs text-graphite-600 whitespace-pre-wrap">{proposal.notes}</p>
                        </div>
                    )}

                    {showLostReason && (
                        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-100 space-y-2">
                            <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest">{t('proposals.detail.lostReasonLabel')}</p>
                            <select value={lostReason} onChange={e => setLostReason(e.target.value as LostReason)} className="w-full bg-white border border-rose-200 rounded-lg px-3 py-2 text-xs font-bold">
                                {LOST_REASONS.map(r => <option key={r} value={r}>{t(`proposals.lostReasons.${r}`)}</option>)}
                            </select>
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setShowLostReason(false)} className="text-xs font-bold text-graphite-500 border-0 bg-transparent cursor-pointer">{t('proposals.modal.cancel')}</button>
                                <button onClick={handleMarkLost} disabled={busy} className="text-xs font-black text-white bg-accent-error px-3 py-1.5 rounded-lg border-0 cursor-pointer disabled:opacity-50">{t('proposals.detail.confirmLost')}</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Ações condicionais por status */}
                <div className="px-6 py-4 border-t border-ice-100 space-y-2">
                    {proposal.status === 'draft' && (
                        <div className="flex gap-2">
                            <button onClick={onEdit} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-graphite-600 bg-ice-100 border-0 cursor-pointer">{t('proposals.detail.editButton')}</button>
                            <button onClick={openSend} className="flex-[2] flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black text-white bg-brand-primary border-0 cursor-pointer">
                                <Send size={13} />{t('proposals.detail.sendButton')}
                            </button>
                            <button onClick={onDelete} className="p-2.5 rounded-xl text-accent-error bg-rose-50 border-0 cursor-pointer"><Trash2 size={14} /></button>
                        </div>
                    )}
                    {(proposal.status === 'sent' || proposal.status === 'viewed') && !showLostReason && (
                        <div className="flex gap-2">
                            {proposal.status === 'sent' && (
                                <button onClick={() => ProposalService.markViewed(proposal.id).then(onChanged)} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-graphite-600 bg-ice-100 border-0 cursor-pointer">
                                    {t('proposals.detail.markViewed')}
                                </button>
                            )}
                            <button onClick={handleApprove} disabled={busy} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black text-white bg-accent-success border-0 cursor-pointer disabled:opacity-50">
                                <Check size={13} />{t('proposals.detail.approve')}
                            </button>
                            <button onClick={() => setShowLostReason(true)} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold text-accent-error bg-rose-50 border-0 cursor-pointer">
                                <X size={13} />{t('proposals.detail.markLost')}
                            </button>
                        </div>
                    )}
                    {proposal.status === 'approved' && (
                        <div className="space-y-2">
                            <button onClick={() => setShowPaymentModal(true)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black text-white bg-brand-primary border-0 cursor-pointer">
                                <Wallet size={13} />{t('proposals.detail.registerPayment')}
                            </button>
                            {canSendPaymentLinks && (
                                <button onClick={handleGeneratePaymentLink} disabled={generatingLink} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black text-brand-primary bg-brand-primary/10 border-0 cursor-pointer disabled:opacity-50">
                                    {generatingLink ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={13} />}
                                    {t('proposals.detail.generatePaymentLink')}
                                </button>
                            )}
                        </div>
                    )}
                    {(proposal.status === 'lost' || proposal.status === 'paid') && (
                        <div className="flex items-center justify-center gap-1.5 py-1 text-xs text-graphite-400">
                            <AlertTriangle size={12} />{t('proposals.detail.readOnlyHint')}
                        </div>
                    )}
                </div>
            </div>

            {showSendModal && (
                <SendProposalChannelModal
                    message={messagePreview}
                    options={channelOptions}
                    sending={sending}
                    onConfirm={handleConfirmSend}
                    onSkip={() => setShowSendModal(false)}
                />
            )}

            {showPaymentModal && (
                <BillingRecordModal
                    tenantId={tenantId}
                    proposalId={proposal.id}
                    proposalTitle={proposal.title}
                    patientId={proposal.patient_id}
                    remainingCents={remainingCents}
                    onClose={() => setShowPaymentModal(false)}
                    onSaved={async () => { setShowPaymentModal(false); await onChanged(); }}
                />
            )}
        </div>
    );
}

