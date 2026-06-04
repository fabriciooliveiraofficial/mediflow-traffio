import { useState, useEffect } from 'react';
import { PhoneOff, Mic, MicOff, PauseCircle, PlayCircle, PhoneForwarded } from 'lucide-react';
import type { ActiveCall } from '../../hooks/useTelnyxWebRTC';

interface Props {
  call:         ActiveCall;
  isMuted:      boolean;
  isOnHold:     boolean;
  onHangup:     () => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onTransfer:   (to: string) => void;
}

export function ActiveCallView({ call, isMuted, isOnHold, onHangup, onToggleMute, onToggleHold, onTransfer }: Props) {
  const [elapsed, setElapsed]         = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferNum, setTransferNum]   = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - call.startedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [call.startedAt]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const displayName = call.remoteName ?? call.remoteNumber ?? 'Em chamada';

  return (
    <div className="bg-white rounded-3xl border border-ice-100 shadow-lg overflow-hidden w-72">
      {/* Status bar */}
      <div className={`px-4 py-3 ${isOnHold ? 'bg-amber-500' : 'bg-green-500'}`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-white/80 uppercase tracking-wide">
            {isOnHold ? 'Em Espera' : 'Em Chamada'}
          </p>
          <p className="text-sm font-black text-white font-mono">{formatTime(elapsed)}</p>
        </div>
        <p className="text-base font-black text-white mt-0.5 truncate">{displayName}</p>
      </div>

      <div className="p-4 space-y-3">
        {/* Controles principais */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={onToggleMute}
            className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-bold transition-colors border-none cursor-pointer ${
              isMuted
                ? 'bg-red-50 text-red-500'
                : 'bg-ice-50 text-graphite-500 hover:bg-ice-100'
            }`}
          >
            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            {isMuted ? 'Mudo' : 'Microfone'}
          </button>

          <button
            onClick={onToggleHold}
            className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-bold transition-colors border-none cursor-pointer ${
              isOnHold
                ? 'bg-amber-50 text-amber-500'
                : 'bg-ice-50 text-graphite-500 hover:bg-ice-100'
            }`}
          >
            {isOnHold ? <PlayCircle size={18} /> : <PauseCircle size={18} />}
            {isOnHold ? 'Retomar' : 'Espera'}
          </button>

          <button
            onClick={() => setShowTransfer(!showTransfer)}
            className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-bold bg-ice-50 text-graphite-500 hover:bg-ice-100 transition-colors border-none cursor-pointer"
          >
            <PhoneForwarded size={18} />
            Transferir
          </button>
        </div>

        {/* Transferência */}
        {showTransfer && (
          <div className="flex gap-2">
            <input
              type="tel"
              placeholder="Número destino"
              value={transferNum}
              onChange={(e) => setTransferNum(e.target.value)}
              className="flex-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
            />
            <button
              onClick={() => { onTransfer(transferNum); setShowTransfer(false); }}
              disabled={!transferNum}
              className="px-3 py-2 bg-brand-primary text-white rounded-xl text-xs font-bold disabled:opacity-40 border-none cursor-pointer"
            >
              OK
            </button>
          </div>
        )}

        {/* Desligar */}
        <button
          onClick={onHangup}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-500 text-white font-black text-sm hover:bg-red-600 transition-colors border-none cursor-pointer"
        >
          <PhoneOff size={18} />
          Desligar
        </button>
      </div>
    </div>
  );
}
