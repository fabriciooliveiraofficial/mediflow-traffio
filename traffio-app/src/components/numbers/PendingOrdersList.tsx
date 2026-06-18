import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Phone, FileText, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { OrderStatusBadge } from './OrderStatusBadge';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';

interface Order {
  id:               string;
  phone_number:     string;
  country_code:     string;
  status:           string;
  rejection_reason: string | null;
  submitted_at:     string | null;
  created_at:       string;
  number_order_documents: { id: string; document_type: string; status: string }[];
}

interface Props {
  tenantId:     string;
  onResubmit:   (orderId: string, phoneNumber: string) => void;
  refreshKey?:  number;
}

export function PendingOrdersList({ tenantId, onResubmit, refreshKey }: Props) {
  const { formatDate } = useLocaleFormat();
  const [orders,  setOrders]  = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telnyx-number-orders?action=list_orders`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const json = await res.json();
      if (json.data) setOrders(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Realtime: ouvir aprovações e rejeições
  useEffect(() => {
    const channel = supabase
      .channel(`orders:${tenantId}`)
      .on('broadcast', { event: 'number_order_completed' }, () => load())
      .on('broadcast', { event: 'number_order_rejected'  }, () => load())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenantId, load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-graphite-300">
        <RefreshCw size={14} className="animate-spin" />
        <span className="text-xs">Carregando pedidos...</span>
      </div>
    );
  }

  if (orders.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-black text-graphite-500 uppercase tracking-wide">Pedidos em andamento</p>
      {orders.map((order) => (
        <div key={order.id} className="p-3 bg-ice-50 border border-ice-200 rounded-2xl space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-black text-graphite-800 font-mono">{order.phone_number}</p>
              <p className="text-[11px] text-graphite-400 mt-0.5">
                {order.country_code} · Criado em {formatDate(order.created_at)}
              </p>
            </div>
            <OrderStatusBadge status={order.status} />
          </div>

          {order.status === 'rejected' && order.rejection_reason && (
            <div className="flex items-start gap-1.5 p-2 bg-red-50 border border-red-100 rounded-xl">
              <AlertCircle size={12} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-red-600">{order.rejection_reason}</p>
            </div>
          )}

          {order.number_order_documents?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {order.number_order_documents.map((doc) => (
                <span key={doc.id} className="px-2 py-0.5 bg-white border border-ice-200 rounded-full text-[10px] text-graphite-500">
                  {doc.document_type.replace('_', ' ')}
                  {doc.status === 'approved' ? ' ✓' : doc.status === 'rejected' ? ' ✗' : ''}
                </span>
              ))}
            </div>
          )}

          {['pending_docs', 'rejected'].includes(order.status) && (
            <button
              onClick={() => onResubmit(order.id, order.phone_number)}
              className="flex items-center gap-1.5 text-xs text-brand-primary font-bold hover:underline border-none cursor-pointer bg-transparent p-0"
            >
              <FileText size={12} />
              {order.status === 'rejected' ? 'Reenviar documentos' : 'Completar documentos'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
