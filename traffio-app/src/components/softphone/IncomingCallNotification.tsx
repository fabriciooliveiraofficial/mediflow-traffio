import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Phone, PhoneOff, User } from 'lucide-react';
import type { ActiveCall } from '../../hooks/useTelnyxWebRTC';

interface Props {
  call:    ActiveCall;
  onAnswer: () => void;
  onReject: () => void;
}

export function IncomingCallNotification({ call, onAnswer, onReject }: Props) {
  const { t } = useTranslation('communications');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Tocar som de chamada em loop
  useEffect(() => {
    const audio = new Audio();
    // Tom sintético via Web Audio API (sem arquivo externo)
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    let stopped = false;

    const ring = () => {
      if (stopped) return;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
      setTimeout(ring, 1800);
    };

    ring();
    return () => {
      stopped = true;
      ctx.close();
    };
  }, []);

  const displayNumber = call.remoteName
    ? `${call.remoteName} (${call.remoteNumber})`
    : call.remoteNumber || t('incomingCallNotification.unknownNumber');

  return (
    <div className="fixed top-4 right-4 z-50 w-80 bg-white rounded-3xl shadow-2xl border border-ice-100 overflow-hidden animate-in slide-in-from-top-4 duration-300">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-4">
        <p className="text-xs font-bold text-blue-200 uppercase tracking-wide">{t('incomingCallNotification.header')}</p>
        <p className="text-lg font-black text-white mt-0.5 truncate">{displayNumber}</p>
      </div>

      {/* Info */}
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-ice-50 border border-ice-100 flex items-center justify-center shrink-0">
          <User size={22} className="text-graphite-400" />
        </div>
        <div>
          <p className="text-sm font-bold text-graphite-700">
            {call.remoteName ?? t('incomingCallNotification.externalContactFallback')}
          </p>
          <p className="text-xs text-graphite-400">{call.remoteNumber}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="px-5 pb-5 grid grid-cols-2 gap-3">
        <button
          onClick={onReject}
          className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-50 text-red-500 font-bold text-sm hover:bg-red-100 transition-colors border-none cursor-pointer"
        >
          <PhoneOff size={18} />
          {t('incomingCallNotification.reject')}
        </button>
        <button
          onClick={onAnswer}
          className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-green-500 text-white font-bold text-sm hover:bg-green-600 transition-colors border-none cursor-pointer"
        >
          <Phone size={18} />
          {t('incomingCallNotification.answer')}
        </button>
      </div>
    </div>
  );
}
