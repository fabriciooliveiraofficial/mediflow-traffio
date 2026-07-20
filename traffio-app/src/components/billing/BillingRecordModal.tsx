import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, DollarSign } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { useTenantMoney } from '../../hooks/useTenantMoney';
import { getTenantTodayString } from '../../lib/timezoneUtils';
import { BillingService } from '../../services/billingService';
import { ProposalService } from '../../services/proposalService';

const PAYMENT_METHODS = ['pix', 'cash', 'card_machine', 'credit_card', 'bank_transfer', 'boleto', 'other'] as const;

interface BillingRecordModalProps {
    tenantId: string;
    timezone?: string;
    /** Presente quando aberto a partir de um orçamento aprovado — trava paciente/valor e já registra como pago. */
    proposalId?: string;
    proposalTitle?: string;
    patientId?: string;
    remainingCents?: number;
    onClose: () => void;
    onSaved: () => void;
}

/**
 * Modal único de registro de recebimento/cobrança — unifica o antigo
 * RegisterPaymentModal (ProposalsPage) e NewBillingModal (FinancialDashboard).
 * Modo "recibo" (proposalId presente): paciente fixo, valor pré-preenchido com
 * o restante do orçamento, já registra como pago (ver ProposalService.registerPayment).
 * Modo "cobrança avulsa" (sem proposalId): paciente por seletor, nasce pendente.
 */
export function BillingRecordModal({
    tenantId, timezone, proposalId, proposalTitle, patientId, remainingCents, onClose, onSaved,
}: BillingRecordModalProps) {
    const { t } = useTranslation('tenantAdmin');
    const { showToast } = useToast();
    const { currency } = useTenantMoney();

    const isReceipt = !!proposalId;
    const [patients, setPatients] = useState<{ id: string; full_name: string }[]>([]);
    const [selectedPatientId, setSelectedPatientId] = useState(patientId || '');
    const [amountInput, setAmountInput] = useState(remainingCents != null ? (remainingCents / 100).toFixed(2) : '');
    const [dueDate, setDueDate] = useState(getTenantTodayString(timezone));
    const [method, setMethod] = useState<typeof PAYMENT_METHODS[number]>('pix');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isReceipt) return;
        supabase.from('patients').select('id, full_name').order('full_name').then(({ data }) => {
            if (data) setPatients(data);
        });
    }, [isReceipt]);

    const canSave = !!amountInput && (isReceipt || !!selectedPatientId);

    const handleSave = async () => {
        const amountCents = Math.round(parseFloat(amountInput.replace(',', '.')) * 100);
        if (!amountCents || amountCents <= 0 || (!isReceipt && !selectedPatientId)) {
            showToast('error', t('billingRecordModal.validationError'));
            return;
        }
        setSaving(true);
        try {
            if (isReceipt) {
                await ProposalService.registerPayment(proposalId!, {
                    tenant_id: tenantId,
                    patient_id: patientId!,
                    amount_cents: amountCents,
                    due_date: dueDate,
                    payment_method: method,
                    notes: t('billingRecordModal.paymentNoteTemplate', { title: proposalTitle || '' }),
                });
            } else {
                await BillingService.create({
                    tenant_id: tenantId,
                    patient_id: selectedPatientId,
                    amount_cents: amountCents,
                    due_date: dueDate,
                    payment_method: method,
                    notes,
                });
            }
            onSaved();
        } catch {
            showToast('error', t('billingRecordModal.createError'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]" onClick={() => !saving && onClose()} />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-white pointer-events-auto w-full max-w-md rounded-3xl shadow-float overflow-hidden border-none">
                    <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50">
                        <h3 className="text-xl font-black text-graphite-900 flex items-center gap-2">
                            <DollarSign className="text-brand-primary" size={24} />
                            {t(isReceipt ? 'billingRecordModal.titleReceipt' : 'billingRecordModal.titleNew')}
                        </h3>
                        <button onClick={onClose} disabled={saving} className="w-10 h-10 rounded-xl bg-white border border-ice-100 flex items-center justify-center text-graphite-400 hover:text-brand-primary transition-all cursor-pointer disabled:opacity-50">
                            <X size={20} />
                        </button>
                    </div>
                    <div className="p-8 space-y-5">
                        {!isReceipt && (
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{t('billingRecordModal.patientLabel')}</label>
                                <select value={selectedPatientId} onChange={e => setSelectedPatientId(e.target.value)} className="w-full bg-ice-50 border-none shadow-float rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 cursor-pointer focus:outline-none">
                                    <option value="">{t('billingRecordModal.selectPlaceholder')}</option>
                                    {patients.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                                </select>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{t('billingRecordModal.amountLabel')} ({currency})</label>
                                <input
                                    type="text" inputMode="decimal" value={amountInput} onChange={e => setAmountInput(e.target.value)}
                                    className="w-full bg-ice-50 border-none shadow-float rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">
                                    {t(isReceipt ? 'billingRecordModal.paymentDateLabel' : 'billingRecordModal.dueDateLabel')}
                                </label>
                                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full bg-ice-50 border-none shadow-float rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none" />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{t('billingRecordModal.methodLabel')}</label>
                            <select value={method} onChange={e => setMethod(e.target.value as typeof PAYMENT_METHODS[number])} className="w-full bg-ice-50 border-none shadow-float rounded-xl px-4 py-3 text-sm font-bold text-graphite-900 cursor-pointer focus:outline-none">
                                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{t(`billingRecordModal.methods.${m}`)}</option>)}
                            </select>
                        </div>
                        {!isReceipt && (
                            <div>
                                <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{t('billingRecordModal.notesLabel')}</label>
                                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full bg-ice-50 border-none shadow-float rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none resize-none" />
                            </div>
                        )}
                        <div className="flex gap-3 pt-2">
                            <button onClick={onClose} disabled={saving} className="flex-1 py-3.5 rounded-2xl font-bold text-graphite-700 hover:bg-ice-50 border border-ice-100 transition-all cursor-pointer disabled:opacity-50">{t('billingRecordModal.cancelButton')}</button>
                            <button onClick={handleSave} disabled={saving || !canSave} className="flex-[2] bg-brand-primary text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 border-none cursor-pointer">
                                {saving && <Loader2 size={16} className="animate-spin" />}
                                {t('billingRecordModal.saveButton')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
