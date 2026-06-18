import React, { useState, useEffect } from 'react';
import { ChevronLeft, Loader2, Calendar, Clock, MapPin, User, MoreVertical, XCircle, Send, Bell, CreditCard, ArrowRightLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { clsx } from 'clsx';

interface Appointment {
  id: string;
  date: string;
  start_time: string;
  status: string;
  doctors?: { full_name: string };
  appointment_types?: { name: string };
  locations?: { name: string };
  billing_records?: Array<{ status: string }>;
}

interface SidebarAppointmentsViewProps {
  onBack: () => void;
  patientId: string;
  patientName: string;
  patientPhone: string;
  onSendMessage: (text: string) => Promise<void>;
  onReschedule: (appt: any) => void;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Agendado', color: 'bg-blue-100 text-blue-700' },
  confirmed: { label: 'Confirmado', color: 'bg-green-100 text-green-700' },
  completed: { label: 'Concluído', color: 'bg-gray-100 text-gray-600' },
  canceled: { label: 'Cancelado', color: 'bg-red-100 text-red-600' },
  no_show: { label: 'Faltou', color: 'bg-amber-100 text-amber-700' },
  in_progress: { label: 'Em andamento', color: 'bg-purple-100 text-purple-700' },
};

export function SidebarAppointmentsView({ onBack, patientId, patientName, patientPhone, onSendMessage, onReschedule }: SidebarAppointmentsViewProps) {
  const { tenant } = useTenant();
  const { showToast } = useToast();
  const { formatDate, formatSlot } = useLocaleFormat();
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [canceling, setCanceling] = useState<string | null>(null);

  useEffect(() => {
    loadAppointments();
  }, [patientId]);

  const loadAppointments = async () => {
    setLoading(true);
    // Be explicit with the joins to avoid ambiguity that might cause REST 400
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id, 
        date, 
        start_time, 
        status, 
        doctors(full_name), 
        appointment_types(name), 
        locations(name), 
        billing_records(status)
      `)
      .eq('patient_id', patientId)
      .order('date', { ascending: true });

    if (error) {
      console.error('Error loading appointments:', error);
      // Fallback without billing_records subquery if it causes errors
      const { data: fallbackData } = await supabase
        .from('appointments')
        .select(`
          id, 
          date, 
          start_time, 
          status, 
          doctors(full_name), 
          appointment_types(name), 
          locations(name)
        `)
        .eq('patient_id', patientId)
        .order('date', { ascending: true });
      setAppointments(fallbackData || []);
    } else {
      setAppointments(data || []);
    }
    setLoading(false);
  };

  const today = new Date().toISOString().split('T')[0];
  const upcoming = appointments.filter(a => a.date >= today && !['canceled', 'completed', 'no_show'].includes(a.status));
  const history = appointments.filter(a => a.date < today || ['canceled', 'completed', 'no_show'].includes(a.status));
  const list = tab === 'upcoming' ? upcoming : history.slice(-10).reverse();

  const handleCancel = async (appt: Appointment) => {
    if (!confirm(`Cancelar consulta de ${formatDate(appt.date)}?`)) return;
    setCanceling(appt.id);
    try {
      const { error } = await supabase.rpc('rpc_cancel_appointment_by_patient', {
        p_appointment_id: appt.id,
        p_patient_phone: patientPhone,
        p_reason: 'Cancelado pelo atendente via inbox'
      });
      if (error) throw error;
      showToast('success', 'Consulta cancelada');
      loadAppointments();
    } catch (err: any) {
      showToast('error', err.message || 'Erro ao cancelar');
    } finally {
      setCanceling(null);
      setActionMenu(null);
    }
  };

  const handleSendCheckin = async (appt: Appointment) => {
    const baseUrl = window.location.origin;
    const link = `${baseUrl}/checkin?apt=${appt.id}`;
    const firstName = patientName.split(' ')[0];
    const dateStr = formatDate(appt.date);
    await onSendMessage(`Olá ${firstName}! 😊 Aqui está o link para a sua sala de espera virtual da consulta do dia ${dateStr}: ${link}`);
    showToast('success', 'Link de check-in enviado!');
    setActionMenu(null);
  };

  const handleSendReminder = async (appt: Appointment) => {
    const firstName = patientName.split(' ')[0];
    const dateStr = formatDate(appt.date);
    const time = formatSlot(appt.start_time);
    const doctor = appt.doctors?.full_name || 'seu profissional';
    await onSendMessage(`Olá ${firstName}! 😊 Lembrando da sua consulta com ${doctor} no dia ${dateStr} às ${time}. Nos vemos lá! 💙`);
    showToast('success', 'Lembrete enviado!');
    setActionMenu(null);
  };

  const handleSendPaymentLink = async (appt: Appointment) => {
    const link = `https://checkout.traffio.com/pay/${appt.id}`;
    const firstName = patientName.split(' ')[0];
    await onSendMessage(`Olá ${firstName}! 😊 Aqui está o seu link para pagamento/confirmação da consulta: ${link}`);
    showToast('success', 'Link de pagamento enviado!');
    setActionMenu(null);
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-blue-600">
        <button onClick={onBack} className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-white min-w-0">
          <p className="text-xs font-bold opacity-80 uppercase tracking-tighter">Consultas</p>
          <p className="text-sm font-bold truncate max-w-[180px]">{patientName}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex p-2 bg-gray-50 border-b border-gray-100">
        <button
          onClick={() => setTab('upcoming')}
          className={clsx('flex-1 py-1.5 text-xs font-bold rounded-lg transition-all',
            tab === 'upcoming' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
          )}
        >
          Próximas ({upcoming.length})
        </button>
        <button
          onClick={() => setTab('history')}
          className={clsx('flex-1 py-1.5 text-xs font-bold rounded-lg transition-all',
            tab === 'history' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
          )}
        >
          Histórico ({history.length})
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>
        ) : list.length === 0 ? (
          <div className="py-12 text-center">
            <Calendar className="w-10 h-10 mx-auto text-gray-300 mb-2" />
            <p className="text-xs text-gray-400">{tab === 'upcoming' ? 'Nenhuma consulta agendada' : 'Sem histórico'}</p>
          </div>
        ) : (
          list.map(appt => {
            const s = STATUS_MAP[appt.status] || { label: appt.status, color: 'bg-gray-100 text-gray-600' };
            return (
              <div key={appt.id} className="bg-white border border-gray-100 rounded-xl p-3 relative">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-gray-900">{appt.appointment_types?.name || 'Consulta'}</p>
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-gray-500">
                      <User size={11} className="shrink-0" />
                      <span className="truncate">{appt.doctors?.full_name || 'Profissional'}</span>
                    </div>
                    {appt.locations?.name && (
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-gray-500">
                        <MapPin size={11} className="shrink-0" />
                        <span className="truncate">{appt.locations.name}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-gray-500">
                      <Clock size={11} className="shrink-0" />
                      <span>{formatDate(appt.date)} às {formatSlot(appt.start_time)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={clsx('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', s.color)}>
                      {s.label}
                    </span>
                    {appt.billing_records?.[0]?.status && (
                      <span className={clsx(
                        'text-[9px] font-bold px-2 py-0.5 rounded-full uppercase flex items-center gap-1',
                        appt.billing_records[0].status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 
                        appt.billing_records[0].status === 'pending' ? 'bg-amber-100 text-amber-700' : 
                        'bg-gray-100 text-gray-600'
                      )}>
                        <CreditCard size={9} />
                        {appt.billing_records[0].status === 'paid' ? 'Pago' : 'Pendente'}
                      </span>
                    )}
                    {tab === 'upcoming' && (
                      <div className="relative">
                        <button
                          onClick={() => setActionMenu(actionMenu === appt.id ? null : appt.id)}
                          className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"
                        >
                          <MoreVertical size={14} />
                        </button>
                        {actionMenu === appt.id && (
                          <div className="absolute right-0 top-7 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-44">
                            <button
                              onClick={() => onReschedule(appt)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2 text-blue-700"
                            >
                              <ArrowRightLeft size={13} /> Reagendar
                            </button>
                            <button
                              onClick={() => handleSendReminder(appt)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700"
                            >
                              <Bell size={13} /> Enviar Lembrete
                            </button>
                            <button
                              onClick={() => handleSendCheckin(appt)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700"
                            >
                              <Send size={13} /> Link Sala de Espera
                            </button>
                            <button
                              onClick={() => handleSendPaymentLink(appt)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700"
                            >
                              <CreditCard size={13} /> Link Pagamento
                            </button>
                            <hr className="my-1 border-gray-100" />
                            <button
                              onClick={() => handleCancel(appt)}
                              disabled={canceling === appt.id}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 flex items-center gap-2 text-red-600"
                            >
                              {canceling === appt.id ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                              Cancelar Consulta
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
