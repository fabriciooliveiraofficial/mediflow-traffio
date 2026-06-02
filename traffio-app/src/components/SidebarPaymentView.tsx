import React, { useState, useEffect } from 'react';
import { ChevronLeft, Loader2, Copy, Check, Send, CreditCard, DollarSign } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { BillingService } from '../services/billingService';
import type { BillingRecord } from '../services/billingService';
import { clsx } from 'clsx';

interface SidebarPaymentViewProps {
  onBack: () => void;
  patientId: string;
  patientName: string;
  onSendLink: (text: string) => Promise<void>;
}

const METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'credit_card', label: 'Cartão' },
  { value: 'boleto', label: 'Boleto' },
];

export function SidebarPaymentView({ onBack, patientId, patientName, onSendLink }: SidebarPaymentViewProps) {
  const { tenant } = useTenant();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [recentBillings, setRecentBillings] = useState<(BillingRecord & { patients?: any })[]>([]);
  const [copied, setCopied] = useState(false);

  // Form
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState('pix');

  // Result
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [billingId, setBillingId] = useState<string | null>(null);

  useEffect(() => {
    loadRecentBillings();
  }, [patientId]);

  const loadRecentBillings = async () => {
    setLoadingRecent(true);
    try {
      const { data } = await supabase
        .from('billing_records')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(5);
      setRecentBillings(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingRecent(false);
    }
  };

  const handleGenerate = async () => {
    if (!tenant?.id || !amount) return;
    const cents = Math.round(parseFloat(amount.replace(',', '.')) * 100);
    if (cents <= 0 || isNaN(cents)) {
      showToast('error', 'Valor inválido');
      return;
    }

    setLoading(true);
    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      const billing = await BillingService.create({
        tenant_id: tenant.id,
        patient_id: patientId,
        amount_cents: cents,
        due_date: dueDate.toISOString().split('T')[0],
        method: method,
        notes: description || `Cobrança - ${patientName}`,
      });

      setBillingId(billing.id);

      // Try Asaas charge if patient has asaas_customer_id
      const { data: patientData } = await supabase
        .from('patients')
        .select('asaas_customer_id')
        .eq('id', patientId)
        .single();

      if (patientData?.asaas_customer_id) {
        try {
          const charge = await BillingService.createAsaasCharge(tenant.id, billing.id, patientData.asaas_customer_id);
          setPaymentLink(charge.invoiceUrl || charge.bankSlipUrl || null);
        } catch (asaasErr: any) {
          console.warn('Asaas charge failed, using fallback:', asaasErr.message);
          setPaymentLink(`${window.location.origin}/pay/${billing.id}`);
        }
      } else {
        setPaymentLink(`${window.location.origin}/pay/${billing.id}`);
      }

      showToast('success', 'Cobrança criada!');
      loadRecentBillings();
    } catch (err: any) {
      showToast('error', err.message || 'Erro ao gerar cobrança');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!paymentLink) return;
    navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast('success', 'Link copiado!');
  };

  const handleSendInChat = async () => {
    if (!paymentLink) return;
    const firstName = patientName.split(' ')[0];
    const formattedAmount = parseFloat(amount.replace(',', '.')).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    await onSendLink(`Olá ${firstName}! 😊 Segue o link de pagamento no valor de ${formattedAmount}: ${paymentLink}\n\nVocê pode pagar por PIX, cartão ou boleto. Qualquer dúvida estou aqui! 💙`);
    showToast('success', 'Link enviado no chat!');
  };

  const handleNewCharge = () => {
    setPaymentLink(null);
    setBillingId(null);
    setAmount('');
    setDescription('');
    setCopied(false);
  };

  const statusLabel = (s: string) => {
    const map: Record<string, { label: string; color: string }> = {
      pending: { label: 'Pendente', color: 'text-amber-600 bg-amber-50' },
      paid: { label: 'Pago', color: 'text-green-600 bg-green-50' },
      overdue: { label: 'Vencido', color: 'text-red-600 bg-red-50' },
      canceled: { label: 'Cancelado', color: 'text-gray-500 bg-gray-100' },
    };
    return map[s] || { label: s, color: 'text-gray-500 bg-gray-100' };
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-green-600">
        <button onClick={onBack} className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-white">
          <p className="text-xs font-bold opacity-80 uppercase tracking-tighter">Pagamento</p>
          <p className="text-sm font-bold truncate max-w-[180px]">{patientName}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {paymentLink ? (
          /* Result view */
          <div className="p-4 space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center space-y-3">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600">
                <Check size={28} />
              </div>
              <p className="text-sm font-bold text-green-800">Cobrança Gerada!</p>
              <div className="bg-white border border-green-200 rounded-xl p-2.5 flex items-center gap-2">
                <span className="text-[10px] text-gray-500 truncate flex-1">{paymentLink}</span>
                <button onClick={handleCopy} className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors shrink-0">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            <button
              onClick={handleSendInChat}
              className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-all shadow-md shadow-green-500/20"
            >
              <Send size={16} /> Enviar no Chat
            </button>

            <button
              onClick={handleNewCharge}
              className="w-full bg-gray-100 text-gray-700 rounded-xl py-2.5 text-sm font-bold hover:bg-gray-200 transition-all"
            >
              Nova Cobrança
            </button>
          </div>
        ) : (
          /* Form view */
          <div className="p-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">Valor (R$)</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="150,00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">Descrição (opcional)</label>
              <input
                type="text"
                placeholder="Ex: Consulta de avaliação"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">Método</label>
              <div className="flex p-1 bg-gray-100 rounded-xl">
                {METHODS.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    className={clsx('flex-1 py-1.5 text-xs font-bold rounded-lg transition-all',
                      method === m.value ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500'
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Recent billings */}
            {recentBillings.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Cobranças Recentes</p>
                {loadingRecent ? (
                  <Loader2 className="animate-spin text-gray-400 w-4 h-4 mx-auto" />
                ) : (
                  recentBillings.map(b => {
                    const st = statusLabel(b.status);
                    return (
                      <div key={b.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-700">
                            {(b.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </p>
                          <p className="text-[10px] text-gray-400">{new Date(b.created_at).toLocaleDateString('pt-BR')}</p>
                        </div>
                        <span className={clsx('text-[9px] font-bold px-2 py-0.5 rounded-full', st.color)}>{st.label}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer - Generate button */}
      {!paymentLink && (
        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={handleGenerate}
            disabled={loading || !amount}
            className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-all shadow-md shadow-green-500/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CreditCard size={16} /> Gerar Link de Pagamento</>}
          </button>
        </div>
      )}
    </div>
  );
}
