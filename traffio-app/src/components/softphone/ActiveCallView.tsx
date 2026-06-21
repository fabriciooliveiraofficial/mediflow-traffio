import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('communications');
  const [elapsed, setElapsed]         = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferNum, setTransferNum]   = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - call.startedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [call.startedAt]);

  useEffect(() => {
    // 1. Diagnóstico do Objeto callRef
    const callRef = call.callRef;
    const hasCallRef = !!callRef;
    const remoteStream = callRef?.remoteStream;
    const optionsRemoteStream = callRef?.options?.remoteStream;
    const peer = callRef?.peer;
    const pc = peer?.instance || peer?.pc;
    
    console.log('[AudioDiagnostics] Checking callRef...', {
      hasCallRef,
      state: callRef?.state,
      id: callRef?.id,
      remoteStream: remoteStream ? 'Present' : 'Missing',
      optionsRemoteStream: optionsRemoteStream ? 'Present' : 'Missing',
      peer: peer ? 'Present' : 'Missing',
      pc: pc ? 'Present' : 'Missing',
    });

    // 2. Tenta obter o stream do SDK
    let stream = remoteStream || optionsRemoteStream;

    // 3. Se não achou na propriedade tradicional, tenta extrair do RTCPeerConnection interno
    if (!stream && pc) {
      const receivers = typeof pc.getReceivers === 'function' ? pc.getReceivers() : [];
      const remoteTracks = receivers.map((r: any) => r.track).filter(Boolean);
      console.log('[AudioDiagnostics] Receivers tracks found:', remoteTracks.length, remoteTracks);
      
      if (remoteTracks.length > 0) {
        console.log('[AudioDiagnostics] Creating a fallback MediaStream from tracks...');
        stream = new MediaStream(remoteTracks);
      }
    }

    // 4. Se temos um stream, vinculamos à tag <audio>
    const audioElement = document.getElementById('telnyx-remote-audio') as HTMLAudioElement;
    if (audioElement) {
      if (stream) {
        if (audioElement.srcObject !== stream) {
          console.log('[AudioDiagnostics] Attaching stream to DOM. Tracks:', stream.getAudioTracks());
          audioElement.srcObject = stream;
          audioElement.muted = false;
          audioElement.volume = 1.0;
          
          audioElement.play()
            .then(() => {
              console.log('[AudioDiagnostics] 🔊 Audio play succeeded!');
            })
            .catch((err) => {
              console.error('[AudioDiagnostics] 🔇 play() was blocked or failed:', err);
            });
        } else {
          // Já está associado, mas garante que não está travado em pause se o estado atual for ativo
          if (audioElement.paused) {
            console.log('[AudioDiagnostics] Audio is paused. Triggering play...');
            audioElement.play().catch(err => {
              console.error('[AudioDiagnostics] play() retry failed:', err);
            });
          }
        }
      } else {
        console.log('[AudioDiagnostics] Stream is not available yet.');
      }
    } else {
      console.error('[AudioDiagnostics] ❌ HTMLAudioElement with ID "telnyx-remote-audio" not found in DOM!');
    }
  }, [call.callRef, elapsed]);

  // Limpeza final do áudio quando o componente desmontar de verdade
  useEffect(() => {
    return () => {
      const audioElement = document.getElementById('telnyx-remote-audio') as HTMLAudioElement;
      if (audioElement) {
        console.log('[AudioDiagnostics] ActiveCallView unmounted. Clearing audio element.');
        audioElement.srcObject = null;
      }
    };
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const displayName = call.remoteName ?? call.remoteNumber ?? t('activeCallView.inCallFallback');

  return (
    <div className="bg-white rounded-3xl border border-ice-100 shadow-lg overflow-hidden w-72">
      {/* Status bar */}
      <div className={`px-4 py-3 ${isOnHold ? 'bg-amber-500' : 'bg-green-500'}`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-white/80 uppercase tracking-wide">
            {isOnHold ? t('activeCallView.onHold') : t('activeCallView.inCall')}
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
            {isMuted ? t('activeCallView.muted') : t('activeCallView.microphone')}
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
            {isOnHold ? t('activeCallView.resume') : t('activeCallView.hold')}
          </button>

          <button
            onClick={() => setShowTransfer(!showTransfer)}
            className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-bold bg-ice-50 text-graphite-500 hover:bg-ice-100 transition-colors border-none cursor-pointer"
          >
            <PhoneForwarded size={18} />
            {t('activeCallView.transfer')}
          </button>
        </div>

        {/* Transferência */}
        {showTransfer && (
          <div className="flex gap-2">
            <input
              type="tel"
              placeholder={t('activeCallView.transferTargetPlaceholder')}
              value={transferNum}
              onChange={(e) => setTransferNum(e.target.value)}
              className="flex-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
            />
            <button
              onClick={() => { onTransfer(transferNum); setShowTransfer(false); }}
              disabled={!transferNum}
              className="px-3 py-2 bg-brand-primary text-white rounded-xl text-xs font-bold disabled:opacity-40 border-none cursor-pointer"
            >
              {t('activeCallView.confirm')}
            </button>
          </div>
        )}

        {/* Desligar */}
        <button
          onClick={onHangup}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-500 text-white font-black text-sm hover:bg-red-600 transition-colors border-none cursor-pointer"
        >
          <PhoneOff size={18} />
          {t('activeCallView.hangup')}
        </button>
      </div>
    </div>
  );
}
