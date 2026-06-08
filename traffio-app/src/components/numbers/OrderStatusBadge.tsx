import React from 'react';
import { Clock, FileUp, Search, CheckCircle, XCircle, CheckCheck } from 'lucide-react';

type OrderStatus = 'pending_docs' | 'docs_submitted' | 'under_review' | 'approved' | 'rejected' | 'completed' | 'cancelled';

const STATUS_CONFIG: Record<OrderStatus, {
  label: string;
  icon:  React.ReactNode;
  className: string;
}> = {
  pending_docs: {
    label: 'Aguardando documentos',
    icon:  <Clock size={11} />,
    className: 'bg-graphite-100 text-graphite-500',
  },
  docs_submitted: {
    label: 'Documentos enviados',
    icon:  <FileUp size={11} />,
    className: 'bg-blue-50 text-blue-600',
  },
  under_review: {
    label: 'Em análise',
    icon:  <Search size={11} />,
    className: 'bg-yellow-50 text-yellow-600',
  },
  approved: {
    label: 'Aprovado',
    icon:  <CheckCircle size={11} />,
    className: 'bg-green-50 text-green-600',
  },
  rejected: {
    label: 'Rejeitado',
    icon:  <XCircle size={11} />,
    className: 'bg-red-50 text-red-500',
  },
  completed: {
    label: 'Ativo',
    icon:  <CheckCheck size={11} />,
    className: 'bg-green-100 text-green-700',
  },
  cancelled: {
    label: 'Cancelado',
    icon:  <XCircle size={11} />,
    className: 'bg-graphite-100 text-graphite-400',
  },
};

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

export function OrderStatusBadge({ status, size = 'sm' }: Props) {
  const config = STATUS_CONFIG[status as OrderStatus] ?? {
    label: status,
    icon:  <Clock size={11} />,
    className: 'bg-graphite-100 text-graphite-400',
  };

  return (
    <span className={`
      inline-flex items-center gap-1 rounded-full font-bold
      ${size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'}
      ${config.className}
    `}>
      {config.icon}
      {config.label}
    </span>
  );
}
