import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X, Check, MessageCircle, MessageSquare, Mail, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { ProposalChannel, ProposalChannelOption } from '../../services/proposalService';

interface SendProposalChannelModalProps {
    message: string;
    options: ProposalChannelOption[] | null; // null = carregando disponibilidade
    sending: boolean;
    onConfirm: (channel: ProposalChannel) => void;
    onSkip: () => void;
}

const CHANNEL_META: Record<ProposalChannel, { labelKey: string; icon: any; activeClass: string; iconClass: string }> = {
    whatsapp: { labelKey: 'proposals.sendModal.channels.whatsapp', icon: MessageCircle, activeClass: 'border-emerald-500 bg-emerald-50', iconClass: 'bg-emerald-100 text-emerald-600' },
    sms: { labelKey: 'proposals.sendModal.channels.sms', icon: MessageSquare, activeClass: 'border-teal-500 bg-teal-50', iconClass: 'bg-teal-100 text-teal-600' },
    email: { labelKey: 'proposals.sendModal.channels.email', icon: Mail, activeClass: 'border-violet-500 bg-violet-50', iconClass: 'bg-violet-100 text-violet-600' },
};

/**
 * Seletor de canal para envio de orçamento — mesmo padrão visual de
 * ConfirmationChannelModal (Inbox), mas componente próprio e desacoplado de
 * conversation_sessions/selected (o modal do Inbox não deve servir dois
 * propósitos). Ver ProposalService.resolveChannelAvailability/send.
 */
export function SendProposalChannelModal({ message, options, sending, onConfirm, onSkip }: SendProposalChannelModalProps) {
    const { t } = useTranslation('tenantAdmin');
    const [selected, setSelected] = useState<ProposalChannel | null>(() => options?.find(o => o.available)?.id ?? null);

    if (selected === null && options) {
        const fallback = options.find(o => o.available)?.id;
        if (fallback) setSelected(fallback);
    }

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !sending && onSkip()} />
            <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
                <div className="px-6 pt-5 pb-4 border-b border-ice-100 flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-black text-graphite-900">{t('proposals.sendModal.title')}</h3>
                        <p className="text-xs text-graphite-400 mt-1">{t('proposals.sendModal.subtitle')}</p>
                    </div>
                    <button
                        onClick={onSkip}
                        disabled={sending}
                        className="p-1.5 rounded-lg hover:bg-ice-100 text-graphite-400 hover:text-graphite-600 transition-colors border-0 bg-transparent cursor-pointer shrink-0"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                    {!options ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-5 h-5 text-graphite-300 animate-spin" />
                        </div>
                    ) : (
                        options.map(opt => {
                            const meta = CHANNEL_META[opt.id];
                            const Icon = meta.icon;
                            const isSelected = selected === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    onClick={() => opt.available && setSelected(opt.id)}
                                    disabled={!opt.available || sending}
                                    className={clsx(
                                        'w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all text-left bg-white',
                                        isSelected ? meta.activeClass : 'border-ice-100',
                                        opt.available ? 'cursor-pointer hover:border-ice-200' : 'opacity-50 cursor-not-allowed',
                                    )}
                                >
                                    <div className={clsx('p-2 rounded-xl shrink-0', meta.iconClass)}>
                                        <Icon className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-graphite-800">{t(meta.labelKey)}</p>
                                        {!opt.available && opt.reasonKey && (
                                            <p className="text-[11px] text-graphite-400">{t(opt.reasonKey)}</p>
                                        )}
                                    </div>
                                    {isSelected && <Check className="w-4 h-4 text-brand-primary shrink-0" />}
                                </button>
                            );
                        })
                    )}

                    <div className="mt-3 p-3 rounded-2xl bg-ice-50 border border-ice-100">
                        <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">
                            {t('proposals.sendModal.previewLabel')}
                        </p>
                        <p className="text-xs text-graphite-600 whitespace-pre-wrap">{message}</p>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-ice-100 flex items-center justify-end gap-3">
                    <button
                        onClick={onSkip}
                        disabled={sending}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold text-graphite-500 hover:bg-ice-100 transition-colors border-0 bg-transparent cursor-pointer disabled:opacity-50"
                    >
                        {t('proposals.sendModal.skip')}
                    </button>
                    <button
                        onClick={() => selected && onConfirm(selected)}
                        disabled={!selected || sending}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black text-white bg-brand-primary hover:opacity-90 transition-opacity border-0 cursor-pointer disabled:opacity-50"
                    >
                        {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {t('proposals.sendModal.send')}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
