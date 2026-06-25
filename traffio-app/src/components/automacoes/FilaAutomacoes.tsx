import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutboundQueue } from '../../hooks/useOutboundQueue';
import type { OutboundQueueRow } from '../../hooks/useOutboundQueue';
import {
    Clock,
    CheckCircle,
    AlertCircle,
    Ban,
    Search,
    ChevronLeft,
    ChevronRight,
    Edit,
    Send,
    RefreshCcw,
    Eye,
    Star,
    MessageCircle,
    Instagram,
    Facebook,
    Phone,
} from 'lucide-react';

// Badge de canal de notificação
function ChannelBadge({ channel }: { channel?: string }) {
    const { t } = useTranslation('automations');
    const map: Record<string, { icon: React.ElementType; label: string; className: string }> = {
        whatsapp: { icon: MessageCircle, label: t('filaAutomacoes.channelBadge.whatsapp'), className: 'text-green-600 bg-green-50 border-green-100' },
        instagram: { icon: Instagram,    label: t('filaAutomacoes.channelBadge.instagram'), className: 'text-pink-500 bg-pink-50 border-pink-100' },
        facebook:  { icon: Facebook,     label: t('filaAutomacoes.channelBadge.facebook'), className: 'text-blue-600 bg-blue-50 border-blue-100' },
        sms:       { icon: Phone,        label: t('filaAutomacoes.channelBadge.sms'),       className: 'text-graphite-600 bg-ice-50 border-ice-100' },
    };
    const ch = map[channel ?? 'whatsapp'] ?? map['whatsapp'];
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${ch.className}`}>
            <ch.icon size={9} />
            {ch.label}
        </span>
    );
}
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { formatPhone, phoneFlag } from '../../lib/formatPhone';

interface FilaAutomacoesProps {
    tenantId: string;
    dateRange: { from: Date; to: Date };
    onViewJourney: (phone: string, name: string) => void;
}

export const FilaAutomacoes: React.FC<FilaAutomacoesProps> = ({ tenantId, dateRange, onViewJourney }) => {
    const { t } = useTranslation('automations');
    const [page, setPage] = useState(1);
    const [filters, setFilters] = useState<any>({
        status: 'all',
        message_type: 'all',
        search: ''
    });

    // Reset to page 1 whenever filters change
    const setFiltersAndReset = (newFilters: any) => {
        setFilters(newFilters);
        setPage(1);
    };

    const { data, count, isLoading, cancel, edit, retry, sendNow } = useOutboundQueue({
        tenantId,
        filters: { ...filters, dateRange },
        page,
        pageSize: 15
    });

    const [editingMsg, setEditingMsg] = useState<OutboundQueueRow | null>(null);
    const [editValue, setEditValue] = useState('');

    const statusBadge = (status: string) => {
        switch (status) {
            case 'pending': return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-wider"><Clock size={12} /> {t('filaAutomacoes.status.pending')}</span>;
            case 'processing': return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-50 text-orange-600 text-[10px] font-black uppercase tracking-wider animate-pulse"><RefreshCcw size={12} className="animate-spin" /> {t('filaAutomacoes.status.processing')}</span>;
            case 'sent': return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-wider"><CheckCircle size={12} /> {t('filaAutomacoes.status.sent')}</span>;
            case 'failed': return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 text-[10px] font-black uppercase tracking-wider"><AlertCircle size={12} /> {t('filaAutomacoes.status.failed')}</span>;
            case 'cancelled': return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-ice-100 text-graphite-300 text-[10px] font-black uppercase tracking-wider"><Ban size={12} /> {t('filaAutomacoes.status.cancelled')}</span>;
            default: return null;
        }
    };

    const typeBadge = (type: string) => {
        const labels: any = {
            follow_up: { label: t('filaAutomacoes.type.followUp'), color: 'bg-brand-primary/10 text-brand-primary' },
            booking_confirmed: { label: t('filaAutomacoes.type.bookingConfirmed'), color: 'bg-emerald-50 text-emerald-600' },
            reminder_48h: { label: t('filaAutomacoes.type.reminder48h'), color: 'bg-amber-50 text-amber-600' },
            reminder_24h: { label: t('filaAutomacoes.type.reminder24h'), color: 'bg-yellow-50 text-yellow-600' },
            reminder_2h: { label: t('filaAutomacoes.type.reminder2h'), color: 'bg-orange-50 text-orange-600' },
            post_consultation: { label: t('filaAutomacoes.type.postConsultation'), color: 'bg-purple-50 text-purple-600' },
            nps: { label: t('filaAutomacoes.type.nps'), color: 'bg-blue-50 text-blue-600' },
            reactivation: { label: t('filaAutomacoes.type.reactivation'), color: 'bg-pink-50 text-pink-600' }
        };
        
        let config = labels[type];
        if (!config && type.startsWith('reminder_')) {
            const match = type.match(/reminder_(?:custom_)?(-?\d+)/);
            if (match) {
                const mins = parseInt(match[1]);
                const isBefore = mins < 0;
                const absMins = Math.abs(mins);
                let labelText = '';
                if (absMins % 1440 === 0) {
                    const days = absMins / 1440;
                    labelText = `Lembrete ${days}d ${isBefore ? 'Antes' : 'Depois'}`;
                } else if (absMins % 60 === 0) {
                    const hrs = absMins / 60;
                    labelText = `Lembrete ${hrs}h ${isBefore ? 'Antes' : 'Depois'}`;
                } else {
                    labelText = `Lembrete ${absMins}m ${isBefore ? 'Antes' : 'Depois'}`;
                }
                config = { label: labelText, color: 'bg-amber-50 text-amber-600' };
            } else {
                config = { label: type.replace(/_/g, ' '), color: 'bg-amber-50 text-amber-600' };
            }
        }
        
        const badgeConfig = config || { label: type, color: 'bg-ice-50 text-graphite-400' };
        return <span className={clsx("px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-tight", badgeConfig.color)}>{badgeConfig.label}</span>;
    };

    const handleEditSave = async () => {
        if (!editingMsg) return;
        await edit(editingMsg.id, editValue);
        setEditingMsg(null);
    };

    return (
        <div className="bg-white rounded-[32px] border border-ice-100 shadow-sm overflow-hidden flex flex-col min-h-[700px]">
            {/* Toolbar */}
            <div className="p-6 border-b border-ice-50 flex flex-wrap items-center justify-between gap-4 bg-ice-25/30">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
                        <input
                            type="text"
                            placeholder={t('filaAutomacoes.toolbar.searchPlaceholder')}
                            className="pl-10 pr-4 py-2 bg-white border border-ice-100 rounded-2xl text-xs font-bold w-64 outline-none focus:border-brand-primary/30 transition-all placeholder:text-graphite-200"
                            value={filters.search}
                            onChange={(e) => setFiltersAndReset({...filters, search: e.target.value})}
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <select 
                        className="bg-white border border-ice-100 rounded-2xl px-4 py-2 text-xs font-bold outline-none cursor-pointer hover:bg-ice-50"
                        value={filters.status}
                        onChange={(e) => setFiltersAndReset({...filters, status: e.target.value})}
                    >
                        <option value="all">{t('filaAutomacoes.toolbar.allStatuses')}</option>
                        <option value="pending">{t('filaAutomacoes.toolbar.pending')}</option>
                        <option value="sent">{t('filaAutomacoes.toolbar.sent')}</option>
                        <option value="failed">{t('filaAutomacoes.toolbar.failed')}</option>
                        <option value="cancelled">{t('filaAutomacoes.toolbar.cancelled')}</option>
                    </select>

                    <select
                        className="bg-white border border-ice-100 rounded-2xl px-4 py-2 text-xs font-bold outline-none cursor-pointer hover:bg-ice-50"
                        value={filters.message_type}
                        onChange={(e) => setFiltersAndReset({...filters, message_type: e.target.value})}
                    >
                        <option value="all">{t('filaAutomacoes.toolbar.allTypes')}</option>
                        <option value="follow_up">{t('filaAutomacoes.toolbar.followUps')}</option>

                        <option value="reminder_48h">{t('filaAutomacoes.toolbar.reminder48h')}</option>
                        <option value="reminder_24h">{t('filaAutomacoes.toolbar.reminder24h')}</option>
                        <option value="reminder_2h">{t('filaAutomacoes.toolbar.reminder2h')}</option>
                        <option value="nps">{t('filaAutomacoes.toolbar.nps')}</option>
                        <option value="reactivation">{t('filaAutomacoes.toolbar.reactivation')}</option>
                    </select>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-ice-25/50 border-b border-ice-100">
                            <th className="px-6 py-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none">{t('filaAutomacoes.table.status')}</th>
                            <th className="px-6 py-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none">{t('filaAutomacoes.table.patient')}</th>
                            <th className="px-6 py-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none">{t('filaAutomacoes.table.channel')}</th>
                            <th className="px-6 py-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none">{t('filaAutomacoes.table.type')}</th>
                            <th className="px-6 py-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none">{t('filaAutomacoes.table.scheduledFor')}</th>
                            <th className="px-6 py-4 text-[10px] font-black uppercase text-graphite-300 tracking-widest leading-none text-right">{t('filaAutomacoes.table.actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ice-50">
                        {isLoading && data.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="py-24 text-center">
                                    <div className="w-10 h-10 border-2 border-ice-100 border-t-brand-primary rounded-full animate-spin mx-auto" />
                                </td>
                            </tr>
                        ) : data.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="py-24 text-center">
                                    <p className="text-sm font-bold text-graphite-300">{t('filaAutomacoes.table.noResults')}</p>
                                </td>
                            </tr>
                        ) : data.map((msg) => (
                            <tr key={msg.id} className="hover:bg-ice-25/50 transition-all group">
                                <td className="px-6 py-4">{statusBadge(msg.status)}</td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col cursor-pointer" onClick={() => onViewJourney(msg.patient_phone, msg.patient_name || t('filaAutomacoes.defaultPatientName'))}>
                                        <span className="text-xs font-black text-graphite-900 leading-tight group-hover:text-brand-primary transition-colors underline decoration-transparent group-hover:decoration-brand-primary/30 underline-offset-4">
                                            {msg.patient_name || formatPhone(msg.patient_phone)}
                                        </span>
                                        <span className="text-[10px] font-bold text-graphite-400">{phoneFlag(msg.patient_phone)} {formatPhone(msg.patient_phone)}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <ChannelBadge channel={msg.notification_channel} />
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col gap-1 items-start">
                                        {typeBadge(msg.message_type)}
                                        {msg.is_edited && (
                                            <span className="text-[9px] font-black text-amber-500 uppercase tracking-tighter">✎ {t('filaAutomacoes.table.edited')}</span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <span className="text-[11px] font-black text-graphite-700 leading-tight">
                                            {format(new Date(msg.scheduled_at), "dd 'de' MMMM", { locale: ptBR })}
                                        </span>
                                        <span className="text-[10px] font-bold text-graphite-400">
                                            {t('filaAutomacoes.table.at')} {format(new Date(msg.scheduled_at), "HH:mm")} ({formatDistanceToNow(new Date(msg.scheduled_at), { addSuffix: true, locale: ptBR })})
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                        {msg.status === 'pending' && (
                                            <>
                                                <button 
                                                    onClick={() => sendNow(msg.id)}
                                                    className="p-2 hover:bg-brand-primary/10 text-brand-primary rounded-xl transition-all border-none bg-transparent cursor-pointer"
                                                    title={t('filaAutomacoes.actions.sendNow')}
                                                >
                                                    <Send size={15} />
                                                </button>
                                                <button
                                                    onClick={() => { setEditingMsg(msg); setEditValue(msg.template_vars?.override_message || ''); }}
                                                    className="p-2 hover:bg-blue-50 text-blue-600 rounded-xl transition-all border-none bg-transparent cursor-pointer"
                                                    title={t('filaAutomacoes.actions.editText')}
                                                >
                                                    <Edit size={15} />
                                                </button>
                                                <button
                                                    onClick={() => cancel(msg.id)}
                                                    className="p-2 hover:bg-rose-50 text-rose-500 rounded-xl transition-all border-none bg-transparent cursor-pointer"
                                                    title={t('filaAutomacoes.actions.cancel')}
                                                >
                                                    <Ban size={15} />
                                                </button>
                                            </>
                                        )}
                                        {msg.status === 'failed' && (
                                            <button 
                                                onClick={() => retry(msg.id)}
                                                className="p-2 hover:bg-orange-50 text-orange-600 rounded-xl transition-all border-none bg-transparent cursor-pointer"
                                                title={t('filaAutomacoes.actions.retry')}
                                            >
                                                <RefreshCcw size={15} />
                                            </button>
                                        )}
                                        {msg.status === 'sent' && (
                                            <button 
                                                className="p-2 hover:bg-ice-100 text-graphite-400 rounded-xl transition-all border-none bg-transparent cursor-pointer"
                                                title={t('filaAutomacoes.actions.viewMessage')}
                                            >
                                                <Eye size={15} />
                                            </button>
                                        )}
                                        {msg.message_type === 'nps' && msg.template_vars?.nps_score !== undefined && (
                                            <div className="flex items-center gap-1 ml-2 px-2 py-1 bg-amber-50 text-amber-600 rounded-lg">
                                                <Star size={12} className="fill-amber-600" />
                                                <span className="text-[11px] font-black">{msg.template_vars.nps_score}</span>
                                            </div>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination / Footer */}
            <div className="p-6 border-t border-ice-50 flex items-center justify-between bg-ice-25/30">
                <p className="text-[10px] font-black uppercase text-graphite-300 tracking-widest">
                    {t('filaAutomacoes.pagination.summary', { page, totalPages: Math.max(1, Math.ceil(count / 15)), count })}
                </p>
                
                <div className="flex items-center gap-2">
                    <button 
                        disabled={page === 1}
                        onClick={() => setPage(p => p - 1)}
                        className="p-2 rounded-xl bg-white border border-ice-100 text-graphite-900 disabled:opacity-30 transition-all border-none cursor-pointer"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    <button 
                        disabled={page >= Math.ceil(count / 15)}
                        onClick={() => setPage(p => p + 1)}
                        className="p-2 rounded-xl bg-white border border-ice-100 text-graphite-900 disabled:opacity-30 transition-all border-none cursor-pointer"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>

            {/* Edit Modal */}
            {editingMsg && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-graphite-900/40 backdrop-blur-sm">
                    <div className="bg-white rounded-[40px] w-full max-w-xl p-10 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-2 bg-brand-primary" />
                        
                        <div className="mb-6">
                            <h3 className="text-xl font-black text-graphite-900 tracking-tighter">{t('filaAutomacoes.editModal.title')}</h3>
                            <p className="text-sm font-bold text-graphite-400">{t('filaAutomacoes.editModal.subtitle')}</p>
                        </div>

                        <textarea
                            className="w-full h-64 p-6 bg-ice-50 border border-ice-100 rounded-[32px] text-sm font-bold text-graphite-700 outline-none focus:border-brand-primary/30 transition-all resize-none shadow-inner"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            placeholder={t('filaAutomacoes.editModal.placeholder')}
                        />

                        <div className="mt-8 flex items-center justify-end gap-3">
                            <button
                                onClick={() => setEditingMsg(null)}
                                className="px-8 py-4 bg-ice-50 text-graphite-600 font-bold rounded-2xl transition-all border-none cursor-pointer hover:bg-ice-100"
                            >
                                {t('filaAutomacoes.editModal.discard')}
                            </button>
                            <button
                                onClick={handleEditSave}
                                className="px-8 py-4 bg-brand-primary text-white font-black rounded-2xl shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-95 transition-all border-none cursor-pointer flex items-center gap-2"
                            >
                                <CheckCircle size={20} /> {t('filaAutomacoes.editModal.save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
