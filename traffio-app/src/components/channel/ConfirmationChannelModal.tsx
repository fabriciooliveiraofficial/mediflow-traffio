import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X, Check, MessageCircle, Instagram, Facebook, MessageSquare, Mail, Send, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';

export type ConfirmationChannelId = 'whatsapp' | 'facebook' | 'instagram' | 'sms' | 'email' | 'livechat';

export interface ConfirmationChannelOption {
  id: ConfirmationChannelId;
  available: boolean;
  /** Chave i18n (humanInbox.channelModal.reasons.*) exibida quando indisponível */
  reasonKey?: string;
}

interface ConfirmationChannelModalProps {
  message: string;
  currentChannel: ConfirmationChannelId;
  options: ConfirmationChannelOption[] | null; // null = carregando disponibilidade
  sending: boolean;
  onConfirm: (channel: ConfirmationChannelId) => void;
  onSkip: () => void;
}

const CHANNEL_META: Record<ConfirmationChannelId, { labelKey: string; icon: any; activeClass: string; iconClass: string }> = {
  whatsapp:  { labelKey: 'humanInbox.channels.whatsapp',  icon: MessageCircle, activeClass: 'border-emerald-500 bg-emerald-50', iconClass: 'bg-emerald-100 text-emerald-600' },
  facebook:  { labelKey: 'humanInbox.channels.messenger', icon: Facebook,      activeClass: 'border-blue-500 bg-blue-50',       iconClass: 'bg-blue-100 text-blue-600' },
  instagram: { labelKey: 'humanInbox.channels.instagram', icon: Instagram,     activeClass: 'border-pink-500 bg-pink-50',       iconClass: 'bg-pink-100 text-pink-600' },
  sms:       { labelKey: 'humanInbox.channels.sms',       icon: MessageSquare, activeClass: 'border-teal-500 bg-teal-50',       iconClass: 'bg-teal-100 text-teal-600' },
  email:     { labelKey: 'humanInbox.channels.email',     icon: Mail,          activeClass: 'border-violet-500 bg-violet-50',   iconClass: 'bg-violet-100 text-violet-600' },
  livechat:  { labelKey: 'humanInbox.channels.liveChat',  icon: MessageCircle, activeClass: 'border-indigo-500 bg-indigo-50',   iconClass: 'bg-indigo-100 text-indigo-600' },
};

export function ConfirmationChannelModal({ message, currentChannel, options, sending, onConfirm, onSkip }: ConfirmationChannelModalProps) {
  const { t } = useTranslation('communications');
  const [selected, setSelected] = useState<ConfirmationChannelId | null>(() => {
    const current = options?.find(o => o.id === currentChannel);
    return current?.available ? currentChannel : (options?.find(o => o.available)?.id ?? null);
  });
  const [showPreview, setShowPreview] = useState(false);

  // Disponibilidade pode chegar depois do primeiro render — garantir pré-seleção
  if (selected === null && options) {
    const current = options.find(o => o.id === currentChannel);
    const fallback = current?.available ? currentChannel : options.find(o => o.available)?.id;
    if (fallback) setSelected(fallback);
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !sending && onSkip()} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-ice-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-gray-900">{t('humanInbox.channelModal.title')}</h3>
            <p className="text-xs text-gray-500 mt-1">{t('humanInbox.channelModal.subtitle')}</p>
          </div>
          <button
            onClick={onSkip}
            disabled={sending}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors border-0 bg-transparent cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {!options ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
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
                    isSelected ? meta.activeClass : 'border-gray-100',
                    opt.available ? 'cursor-pointer hover:border-gray-300' : 'opacity-50 cursor-not-allowed',
                    isSelected && 'hover:border-transparent',
                  )}
                >
                  <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', meta.iconClass)}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900">{t(meta.labelKey)}</p>
                      {opt.id === currentChannel && (
                        <span className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 text-[9px] font-black uppercase tracking-wide">
                          {t('humanInbox.channelModal.currentBadge')}
                        </span>
                      )}
                    </div>
                    {!opt.available && opt.reasonKey && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{t(opt.reasonKey)}</p>
                    )}
                  </div>
                  <div className={clsx(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors shrink-0',
                    isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300',
                  )}>
                    {isSelected && <Check size={12} className="text-white" strokeWidth={4} />}
                  </div>
                </button>
              );
            })
          )}

          {/* Message preview */}
          <button
            onClick={() => setShowPreview(p => !p)}
            className="w-full flex items-center justify-between px-1 pt-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-0 bg-transparent cursor-pointer hover:text-gray-600 transition-colors"
          >
            {t('humanInbox.channelModal.previewLabel')}
            {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showPreview && (
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 max-h-40 overflow-y-auto">
              <p className="text-[11px] text-gray-600 whitespace-pre-wrap leading-relaxed">{message}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-ice-100 space-y-2">
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || sending || !options}
            className="w-full bg-blue-600 text-white rounded-2xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 cursor-pointer border-0"
          >
            {sending ? <Loader2 className="animate-spin w-4 h-4" /> : <Send size={15} />}
            {t('humanInbox.channelModal.send')}
          </button>
          <button
            onClick={onSkip}
            disabled={sending}
            className="w-full text-gray-400 hover:text-gray-600 rounded-xl py-2 text-xs font-bold transition-colors cursor-pointer border-0 bg-transparent"
          >
            {t('humanInbox.channelModal.skip')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
