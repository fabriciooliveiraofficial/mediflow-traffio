/**
 * FloatingCommunicationsButton
 *
 * Botão flutuante arrastável para comunicações (voz + SMS).
 * Sempre visível. Pulsante quando há chamada/SMS entrando.
 * Arrastar e soltar para qualquer posição. Posição salva no localStorage.
 *
 * Estados:
 *   idle      → botão pequeno, cor azul
 *   ringing   → pulsante vermelho, toca som em loop
 *   sms       → pulsante verde, toca som único
 *   active    → ativo durante chamada, mostra ActiveCallView
 *   expanded  → painel de ações (ligar / SMS / atender)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Phone, PhoneCall, PhoneOff, MessageSquare,
  X, Mic, MicOff, PauseCircle, PlayCircle,
  PhoneForwarded, PhoneIncoming,
} from 'lucide-react';
import { useTelnyxWebRTC } from '../../hooks/useTelnyxWebRTC';
import { supabase } from '../../lib/supabase';
import { logPlatformClient } from '../../lib/logger';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

// ─── Sons via Web Audio API (sem arquivos externos) ─────────────────────────

function playRingtone(ctx: AudioContext, stop: { value: boolean }) {
  const loop = () => {
    if (stop.value) return;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1046, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.45);
    setTimeout(loop, 2200);
  };
  loop();
}

function playSmsChime(ctx: AudioContext) {
  [1047, 1319].forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + i * 0.12 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.28);
    osc.start(ctx.currentTime + i * 0.12);
    osc.stop(ctx.currentTime + i * 0.12 + 0.3);
  });
}

// ─── Drag hook ────────────────────────────────────────────────────────────────

function useDraggable(defaultPos: { x: number; y: number }, storageKey: string) {
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null'); } catch { return null; }
  })();
  const [pos, setPos]       = useState<{ x: number; y: number }>(saved ?? defaultPos);
  const dragging            = useRef(false);
  const hasMoved            = useRef(false);  // distingue drag de click
  const offset              = useRef({ x: 0, y: 0 });
  const startPos            = useRef({ x: 0, y: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    hasMoved.current = false;
    offset.current   = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    startPos.current = { x: e.clientX, y: e.clientY };
    // NÃO prevenir default aqui — permite que onClick dispare se não houver movimento
  }, [pos]);

  useEffect(() => {
    const MOVE_THRESHOLD = 6; // pixels mínimos para considerar drag

    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = Math.abs(e.clientX - startPos.current.x);
      const dy = Math.abs(e.clientY - startPos.current.y);
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
        hasMoved.current = true;
      }
      if (!hasMoved.current) return;
      const x = Math.max(0, Math.min(window.innerWidth  - 64, e.clientX - offset.current.x));
      const y = Math.max(0, Math.min(window.innerHeight - 64, e.clientY - offset.current.y));
      setPos({ x, y });
    };

    const up = (e: MouseEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (hasMoved.current) {
        // Foi drag: salvar posição e manter hasMoved=true até o próximo tick,
        // para que o onClick (disparado pelo browser logo após o mouseup) possa
        // checar isDragging() e suprimir a ação de clique
        setPos((p) => { localStorage.setItem(storageKey, JSON.stringify(p)); return p; });
        e.stopPropagation();
        setTimeout(() => { hasMoved.current = false; }, 0);
      } else {
        hasMoved.current = false;
      }
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup',   up, true); // capture para suprimir click após drag
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup',   up, true);
    };
  }, [storageKey]);

  return { pos, onMouseDown, isDragging: () => hasMoved.current };
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  enabled:       boolean;
  activeNumber?: string;
  tenantId?:     string;
}

export function FloatingCommunicationsButton({ enabled, activeNumber: activeNumberProp, tenantId }: Props) {
  const { t } = useTranslation('communications');
  const { pos, onMouseDown, isDragging } = useDraggable(
    { x: window.innerWidth - 80, y: window.innerHeight - 80 },
    'traffio_softphone_pos'
  );

  const [activeNumber,   setActiveNumber]   = useState<string | undefined>(activeNumberProp);
  const [expanded,       setExpanded]       = useState(false);
  const [dialInput,      setDialInput]      = useState('');
  const [smsInput,       setSmsInput]       = useState('');
  const [smsTo,          setSmsTo]          = useState('');
  const [mode,           setMode]           = useState<'dial' | 'sms'>('dial');
  const [callerName,     setCallerName]     = useState<string | null>(null);
  const [smsBadge,       setSmsBadge]       = useState(0);
  const [callDuration,   setCallDuration]   = useState(0);
  const [transferInput,  setTransferInput]  = useState('');
  const [showTransfer,   setShowTransfer]   = useState(false);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const ringStopRef  = useRef({ value: false });
  const durationRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const dialInputRef = useRef<HTMLInputElement>(null);

  // ── Drag do painel expandido (dial / sms) via header ──────────────────────
  const [panelOffset, setPanelOffset] = useState({ x: 0, y: 0 });
  const panelDragRef = useRef({ dragging: false, startX: 0, startY: 0, offX: 0, offY: 0 });

  const onPanelHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // não arrasta ao clicar nas tabs/fechar
    panelDragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, offX: panelOffset.x, offY: panelOffset.y };
  }, [panelOffset]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!panelDragRef.current.dragging) return;
      const dx = e.clientX - panelDragRef.current.startX;
      const dy = e.clientY - panelDragRef.current.startY;
      setPanelOffset({ x: panelDragRef.current.offX + dx, y: panelDragRef.current.offY + dy });
    };
    const up = () => { panelDragRef.current.dragging = false; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  // Reposiciona o painel perto do botão a cada vez que ele é aberto
  useEffect(() => {
    if (expanded) setPanelOffset({ x: 0, y: 0 });
  }, [expanded]);

  const {
    status, callState, activeCall,
    isMuted, isOnHold,
    dial, answer, hangup, toggleMute, toggleHold, transfer,
  } = useTelnyxWebRTC(enabled);

  // Foca o input automaticamente quando o widget for expandido no modo dial
  useEffect(() => {
    if (expanded && mode === 'dial' && callState === 'idle') {
      const timer = setTimeout(() => {
        dialInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [expanded, mode, callState]);

  // Buscar o número de telefone ativo do tenant se não for passado via prop
  useEffect(() => {
    if (activeNumberProp) {
      setActiveNumber(activeNumberProp);
      return;
    }
    if (!tenantId) return;

    supabase
      .from('tenant_phone_numbers')
      .select('phone_number')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (data && !error) {
          setActiveNumber(data.phone_number);
        }
      });
  }, [activeNumberProp, tenantId]);

  const handleCall = useCallback(() => {
    if (dialInput.length < 5) return;

    let numberToDial = dialInput.trim();
    const cleanDialInput = numberToDial.replace(/\D/g, '');

    // Se o número não começa com '+', tentamos inferir o código do país pelo activeNumber
    if (!numberToDial.startsWith('+') && activeNumber) {
      const parsedActive = parsePhoneNumberFromString(activeNumber);
      const defaultCountry = parsedActive?.country; // e.g. 'BR'
      
      let processedNumber = numberToDial;
      if (parsedActive && defaultCountry) {
        if (defaultCountry === 'BR' && (cleanDialInput.length === 8 || cleanDialInput.length === 9)) {
          // Extrai o DDD de 2 dígitos do número ativo
          const areaCode = parsedActive.nationalNumber.slice(0, 2);
          processedNumber = areaCode + cleanDialInput;
        } else if ((defaultCountry === 'US' || defaultCountry === 'CA') && cleanDialInput.length === 7) {
          // Extrai o Area Code de 3 dígitos do número ativo
          const areaCode = parsedActive.nationalNumber.slice(0, 3);
          processedNumber = areaCode + cleanDialInput;
        }
      }

      const parsedDial = parsePhoneNumberFromString(processedNumber, defaultCountry);
      
      if (parsedDial && parsedDial.isValid()) {
        numberToDial = parsedDial.number;
      } else {
        // Fallback se libphonenumber-js achar inválido ou incompleto (ex: 5541997759569 sem +)
        const ddi = parsedActive?.countryCallingCode;
        if (ddi) {
          const cleanNumber = processedNumber.replace(/\D/g, '');
          // Se o número limpo já começa com o DDI correspondente do activeNumber e tem comprimento razoável,
          // assumimos que o usuário digitou o DDI mas esqueceu o '+'
          if (cleanNumber.startsWith(ddi) && cleanNumber.length > ddi.length + 6) {
            numberToDial = `+${cleanNumber}`;
          } else {
            numberToDial = `+${ddi}${cleanNumber}`;
          }
        } else {
          numberToDial = processedNumber.replace(/[^\d+]/g, '');
        }
      }
    } else {
      numberToDial = numberToDial.replace(/[^\d+]/g, '');
    }

    dial(numberToDial, activeNumber);
    setExpanded(false);
    setDialInput('');
  }, [dialInput, activeNumber, dial]);

  // ── Suporte a teclado físico global quando expandido ────────────────────────
  useEffect(() => {
    if (!expanded) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpanded(false);
        return;
      }

      // Ignorar se o usuário estiver digitando em outros campos editáveis (ex: inputs do SMS)
      if (
        document.activeElement?.tagName === 'TEXTAREA' ||
        (document.activeElement?.tagName === 'INPUT' && document.activeElement !== dialInputRef.current)
      ) {
        return;
      }

      if (mode === 'dial' && callState === 'idle') {
        // Se o foco já estiver no input de telefone, deixa o comportamento nativo (exceto Enter)
        if (document.activeElement === dialInputRef.current) {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleCall();
          }
          return;
        }

        // Se o foco NÃO estiver no input, redireciona a digitação
        if (e.key === 'Enter') {
          e.preventDefault();
          handleCall();
          return;
        }

        if (e.key === 'Backspace') {
          e.preventDefault();
          setDialInput((p) => p.slice(0, -1));
          dialInputRef.current?.focus();
          return;
        }

        if (/^[0-9*#+]$/.test(e.key)) {
          e.preventDefault();
          setDialInput((p) => p + e.key);
          dialInputRef.current?.focus();
          // Mover cursor para o final
          setTimeout(() => {
            if (dialInputRef.current) {
              dialInputRef.current.selectionStart = dialInputRef.current.selectionEnd = dialInputRef.current.value.length;
            }
          }, 0);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [expanded, mode, callState, handleCall]);

  // ── Identificar paciente na chamada recebida ──────────────────────────────
  useEffect(() => {
    if (callState !== 'ringing' || !activeCall?.remoteNumber) { setCallerName(null); return; }
    const phone = activeCall.remoteNumber.replace(/\D/g, '');
    supabase.from('patients').select('full_name')
      .or(`mobile.ilike.%${phone}%,phone.ilike.%${phone}%`)
      .limit(1).maybeSingle()
      .then(({ data }) => setCallerName(data?.full_name ?? null));
  }, [callState, activeCall?.remoteNumber]);

  // ── Sons de chamada e SMS ─────────────────────────────────────────────────
  useEffect(() => {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;

    if (callState === 'ringing') {
      audioCtxRef.current = new Ctx();
      ringStopRef.current = { value: false };
      playRingtone(audioCtxRef.current, ringStopRef.current);
    } else {
      ringStopRef.current.value = true;
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    }
    return () => { ringStopRef.current.value = true; };
  }, [callState]);

  // ── Timer de chamada ──────────────────────────────────────────────────────
  useEffect(() => {
    if (callState === 'active') {
      setCallDuration(0);
      durationRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
    } else {
      if (durationRef.current) clearInterval(durationRef.current);
    }
    return () => { if (durationRef.current) clearInterval(durationRef.current); };
  }, [callState]);

  // ── Listener click-to-call de PatientDetails ──────────────────────────────
  useEffect(() => {
    const h = (e: Event) => {
      const { number } = (e as CustomEvent).detail ?? {};
      if (number) { setDialInput(number); setMode('dial'); setExpanded(true); }
    };
    window.addEventListener('softphone:dial', h);
    return () => window.removeEventListener('softphone:dial', h);
  }, []);

  // ── Listener SMS recebido (Realtime) ──────────────────────────────────────
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase.channel(`sms:${tenantId}`)
      .on('broadcast', { event: 'sms_received' }, () => {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (Ctx) { const ctx = new Ctx(); playSmsChime(ctx); setTimeout(() => ctx.close(), 1000); }
        setSmsBadge((b) => b + 1);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId]);

  // ── Diagnóstico de Áudio Remoto (Injeta o stream na tag <audio>) ───────────
  useEffect(() => {
    if (callState !== 'active' && callState !== 'calling' && callState !== 'held') return;

    const callRef = activeCall?.callRef;
    if (!callRef) return;

    const remoteStream = callRef.remoteStream;
    const optionsRemoteStream = callRef.options?.remoteStream;
    const peer = callRef.peer;
    const pc = peer?.instance || peer?.pc;
    
    logPlatformClient({
      level: 'info',
      source: 'FloatingCommunicationsButton',
      eventName: 'audio_diagnostics_check',
      message: 'Checking callRef...',
      metadata: {
        state: callRef.state,
        id: callRef.id,
        remoteStream: remoteStream ? 'Present' : 'Missing',
        optionsRemoteStream: optionsRemoteStream ? 'Present' : 'Missing',
        peer: peer ? 'Present' : 'Missing',
        pc: pc ? 'Present' : 'Missing',
      }
    });

    let stream = remoteStream || optionsRemoteStream;

    if (!stream && pc) {
      const receivers = typeof pc.getReceivers === 'function' ? pc.getReceivers() : [];
      const remoteTracks = receivers.map((r: any) => r.track).filter(Boolean);
      logPlatformClient({
        level: 'info',
        source: 'FloatingCommunicationsButton',
        eventName: 'audio_diagnostics_receivers',
        message: 'Receivers tracks found',
        metadata: { trackCount: remoteTracks.length }
      });
      
      if (remoteTracks.length > 0) {
        stream = new MediaStream(remoteTracks);
      }
    }

    const audioElement = document.getElementById('telnyx-remote-audio') as HTMLAudioElement;
    if (audioElement) {
      if (stream) {
        if (audioElement.srcObject !== stream) {
          logPlatformClient({
            level: 'info',
            source: 'FloatingCommunicationsButton',
            eventName: 'audio_diagnostics_attach',
            message: 'Attaching stream to DOM'
          });
          audioElement.srcObject = stream;
          audioElement.muted = false;
          audioElement.volume = 1.0;
          audioElement.play().catch((err: any) => {
            logPlatformClient({ level: 'error', source: 'FloatingButton', eventName: 'audio_play_error', message: err.message });
          });
        }
      }
    } else {
      logPlatformClient({
        level: 'error',
        source: 'FloatingCommunicationsButton',
        eventName: 'audio_diagnostics_no_element',
        message: 'HTMLAudioElement with ID "telnyx-remote-audio" not found in DOM!'
      });
    }
  }, [callState, activeCall?.callRef, callDuration]); // re-avalia baseado no timer também

  // Limpeza final do áudio
  useEffect(() => {
    return () => {
      const audioElement = document.getElementById('telnyx-remote-audio') as HTMLAudioElement;
      if (audioElement) audioElement.srcObject = null;
    };
  }, []);

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const isRinging  = callState === 'ringing';
  const isActive   = callState === 'active' || callState === 'held' || callState === 'calling';
  const hasBadge   = smsBadge > 0 || isRinging;

  if (!enabled) return null;

  // ── Cor do botão principal ─────────────────────────────────────────────────
  const btnColor = isRinging ? 'from-red-500 to-red-600'
    : isActive   ? 'from-green-500 to-green-600'
    : smsBadge   ? 'from-emerald-500 to-emerald-600'
    : 'from-blue-600 to-blue-700';

  return (
    <>
      <audio id="telnyx-remote-audio" autoPlay playsInline style={{ display: 'none' }} />
      {/* ── Overlay de chamada recebida (prioridade máxima) ─────────────────── */}
      {isRinging && activeCall && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" />

          {/* Card de chamada */}
          <div className="relative z-10 w-80 rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            {/* Pulso de fundo */}
            <div className="absolute inset-0 bg-red-500 animate-pulse opacity-20 rounded-3xl" />

            {/* Header */}
            <div className="relative bg-gradient-to-b from-red-500 to-red-600 px-6 pt-8 pb-6 text-center">
              {/* Anel pulsante */}
              <div className="relative w-20 h-20 mx-auto mb-4">
                <div className="absolute inset-0 bg-white/30 rounded-full animate-ping" />
                <div className="absolute inset-2 bg-white/20 rounded-full animate-ping animation-delay-200" />
                <div className="relative w-20 h-20 bg-white/20 rounded-full flex items-center justify-center">
                  <PhoneIncoming size={32} className="text-white" />
                </div>
              </div>
              <p className="text-white/70 text-xs font-bold uppercase tracking-widest mb-1">{t('floatingCommunicationsButton.incomingCallHeader')}</p>
              <p className="text-white text-xl font-black truncate">
                {callerName ?? activeCall.remoteNumber ?? t('floatingCommunicationsButton.unknownNumber')}
              </p>
              {callerName && (
                <p className="text-white/60 text-sm mt-0.5">{activeCall.remoteNumber}</p>
              )}
            </div>

            {/* Ações */}
            <div className="relative bg-white px-6 py-6 grid grid-cols-2 gap-3">
              <button
                onClick={hangup}
                className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-red-50 text-red-500 font-bold text-sm hover:bg-red-100 transition-colors border-none cursor-pointer"
              >
                <PhoneOff size={22} />
                {t('floatingCommunicationsButton.reject')}
              </button>
              <button
                onClick={() => { answer(); setExpanded(false); }}
                className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-green-500 text-white font-bold text-sm hover:bg-green-600 transition-colors border-none cursor-pointer"
              >
                <Phone size={22} />
                {t('floatingCommunicationsButton.answer')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Painel de chamada ativa (flutuante, não overlay) ────────────────── */}
      {isActive && activeCall && !expanded && (
        <div
          className="fixed z-[1000] bottom-20 right-4 w-64 bg-white rounded-3xl shadow-2xl border border-ice-100 overflow-hidden"
        >
          <div className={`px-4 py-3 flex items-center gap-3 ${isOnHold ? 'bg-amber-500' : 'bg-green-500'}`}>
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
              <Phone size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-black text-sm truncate">
                {callerName ?? activeCall.remoteNumber ?? (callState === 'calling' ? t('floatingCommunicationsButton.dialingFallback') : t('floatingCommunicationsButton.inCallFallback'))}
              </p>
              <p className="text-white/70 text-xs font-mono">
                {callState === 'calling' ? t('floatingCommunicationsButton.callingStatus') : fmt(callDuration)}
              </p>
            </div>
          </div>
          <div className="px-3 py-3 grid grid-cols-4 gap-1.5">
            <button onClick={toggleMute} className={`flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-bold transition-colors border-none cursor-pointer ${isMuted ? 'bg-red-50 text-red-500' : 'bg-ice-50 text-graphite-500'}`}>
              {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
              {isMuted ? t('floatingCommunicationsButton.muted') : t('floatingCommunicationsButton.mic')}
            </button>
            <button onClick={toggleHold} className={`flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-bold transition-colors border-none cursor-pointer ${isOnHold ? 'bg-amber-50 text-amber-500' : 'bg-ice-50 text-graphite-500'}`}>
              {isOnHold ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
              {isOnHold ? t('floatingCommunicationsButton.resume') : t('floatingCommunicationsButton.hold')}
            </button>
            <button onClick={() => setShowTransfer(!showTransfer)} className="flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-bold bg-ice-50 text-graphite-500 transition-colors border-none cursor-pointer">
              <PhoneForwarded size={14} />
              {t('floatingCommunicationsButton.transfer')}
            </button>
            <button onClick={hangup} className="flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-bold bg-red-500 text-white transition-colors border-none cursor-pointer">
              <PhoneOff size={14} />
              {t('floatingCommunicationsButton.hangup')}
            </button>
          </div>
          {showTransfer && (
            <div className="px-3 pb-3 flex gap-1.5">
              <input value={transferInput} onChange={(e) => setTransferInput(e.target.value)} placeholder={t('floatingCommunicationsButton.transferTargetPlaceholder')} className="flex-1 text-xs bg-ice-50 border border-ice-200 rounded-xl px-2 py-1.5 focus:outline-none" />
              <button onClick={() => { transfer(transferInput); setShowTransfer(false); }} className="px-2 py-1.5 bg-brand-primary text-white text-xs font-bold rounded-xl border-none cursor-pointer">{t('floatingCommunicationsButton.confirm')}</button>
            </div>
          )}
        </div>
      )}

      {/* ── Painel expandido (dial / sms) — z-index ACIMA do botão ───────────── */}
      {expanded && !isRinging && !isActive && (
        <div
          className="fixed w-72 bg-white rounded-3xl shadow-2xl border border-ice-100 overflow-hidden"
          style={{
            zIndex: 3000, // acima do botão (2000)
            // Posicionar o painel ACIMA ou à esquerda do botão, nunca sobre ele, mais o offset de drag do usuário
            left: Math.min(Math.max(8, pos.x - 288 + 56 + panelOffset.x), window.innerWidth - 296),
            top:  Math.max(8, Math.min(pos.y - 380 + panelOffset.y, window.innerHeight - 100)),
          }}
        >
          {/* Header do painel — arrastável */}
          <div
            onMouseDown={onPanelHeaderMouseDown}
            className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 flex items-center justify-between cursor-grab active:cursor-grabbing select-none"
          >
            <div className="flex gap-1 bg-white/20 p-0.5 rounded-xl">
              <button onClick={() => setMode('dial')} className={`px-3 py-1 rounded-xl text-xs font-bold transition-all border-none cursor-pointer ${mode === 'dial' ? 'bg-white text-blue-600' : 'text-white'}`}>
                <Phone size={12} className="inline mr-1" />{t('floatingCommunicationsButton.call')}
              </button>
              <button onClick={() => setMode('sms')} className={`px-3 py-1 rounded-xl text-xs font-bold transition-all border-none cursor-pointer ${mode === 'sms' ? 'bg-white text-blue-600' : 'text-white'}`}>
                <MessageSquare size={12} className="inline mr-1" />{t('floatingCommunicationsButton.sms')}
              </button>
            </div>
            <button onClick={() => setExpanded(false)} className="w-7 h-7 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 border-none cursor-pointer">
              <X size={14} />
            </button>
          </div>

          {/* Modo: Ligar */}
          {mode === 'dial' && (
            <div className="p-4 space-y-3">
              <input
                ref={dialInputRef}
                type="tel"
                value={dialInput}
                onChange={(e) => setDialInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCall();
                  }
                }}
                placeholder={t('floatingCommunicationsButton.dialPlaceholder')}
                className="w-full text-center text-xl font-black text-graphite-800 bg-ice-50 border border-ice-200 rounded-2xl px-3 py-2.5 focus:outline-none focus:border-brand-primary font-mono tracking-widest"
              />
              {/* Dialpad */}
              {[['1','2','3'],['4','5','6'],['7','8','9'],['*','0','#']].map((row, ri) => (
                <div key={ri} className="grid grid-cols-3 gap-2">
                  {row.map((k) => (
                    <button key={k}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setDialInput((p) => p + k)}
                      className="py-3 rounded-2xl bg-ice-50 text-graphite-700 font-black text-lg hover:bg-ice-100 active:scale-95 transition-all border-none cursor-pointer">
                      {k}
                    </button>
                  ))}
                </div>
              ))}
              {/* Botões de +, backspace e limpar */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setDialInput((p) => p + '+')}
                  className="py-3 rounded-2xl bg-ice-50 text-graphite-700 font-black text-lg hover:bg-ice-100 active:scale-95 transition-all border-none cursor-pointer"
                >
                  +
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setDialInput((p) => p.slice(0, -1))}
                  className="py-3 rounded-2xl bg-ice-50 text-graphite-400 font-bold text-sm hover:bg-ice-100 transition-all border-none cursor-pointer"
                >
                  ⌫
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setDialInput('')}
                  className="py-3 rounded-2xl bg-ice-50 text-graphite-400 font-bold text-sm hover:bg-ice-100 transition-all border-none cursor-pointer"
                >
                  C
                </button>
              </div>

              {/* Botão de ligar */}
              <div className="mt-1">
                <button
                  onClick={handleCall}
                  disabled={dialInput.length < 5 || status !== 'ready'}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-green-500 text-white font-black text-sm hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all border-none cursor-pointer"
                >
                  <Phone size={18} /> {t('floatingCommunicationsButton.call')}
                </button>
              </div>
            </div>
          )}

          {/* Modo: SMS */}
          {mode === 'sms' && (
            <div className="p-4 space-y-3">
              <input type="tel" value={smsTo} onChange={(e) => setSmsTo(e.target.value)}
                placeholder={t('floatingCommunicationsButton.smsToPlaceholder')} className="w-full text-sm bg-ice-50 border border-ice-200 rounded-2xl px-3 py-2.5 focus:outline-none focus:border-brand-primary" />
              <textarea
                value={smsInput} onChange={(e) => setSmsInput(e.target.value)}
                placeholder={t('floatingCommunicationsButton.smsMessagePlaceholder')} rows={4}
                className="w-full text-sm bg-ice-50 border border-ice-200 rounded-2xl px-3 py-2.5 resize-none focus:outline-none focus:border-brand-primary"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-graphite-400">{t('floatingCommunicationsButton.charCount', { count: smsInput.length })}</span>
                <button
                  disabled={!smsTo || !smsInput || smsInput.length > 160}
                  onClick={async () => {
                    // Enviar SMS via endpoint send-human-message
                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session) return;
                    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-human-message`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        tenant_id: tenantId,
                        user_id: session.user.id,
                        target_channel: 'sms',
                        patient_phone: smsTo,
                        text: smsInput
                      }),
                    });
                    const resData = await res.json();
                    if (resData.error) {
                      console.error("Erro ao enviar SMS:", resData.error);
                      alert("Erro ao enviar SMS: " + resData.error);
                      return;
                    }
                    setSmsInput(''); setSmsTo('');
                    setExpanded(false);
                  }}
                  className="px-4 py-2 bg-green-500 text-white text-sm font-bold rounded-2xl disabled:opacity-40 disabled:cursor-not-allowed border-none cursor-pointer"
                >
                  <MessageSquare size={14} className="inline mr-1" />{t('floatingCommunicationsButton.send')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Botão flutuante principal (arrastável) ───────────────────────────── */}
      <div
        className="fixed select-none"
        style={{ left: pos.x, top: pos.y, touchAction: 'none', zIndex: 2000 }}
      >
        {/* Badge de notificações não lidas */}
        {hasBadge && (
          <div className="absolute -top-1 -right-1 z-10">
            {smsBadge > 0 && (
              <span className="w-5 h-5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
                {smsBadge > 9 ? '9+' : smsBadge}
              </span>
            )}
          </div>
        )}

        {/* Anel pulsante (chamada recebida) */}
        {isRinging && (
          <>
            <div className="absolute inset-0 bg-red-400 rounded-full animate-ping opacity-75" />
            <div className="absolute -inset-3 bg-red-300 rounded-full animate-ping opacity-40 animation-delay-300" />
          </>
        )}

        {/* Botão principal — onMouseDown aqui é o drag handle */}
        <button
          onMouseDown={onMouseDown}
          onClick={() => {
            if (isDragging()) return; // suprime o click gerado após um drag
            if (isRinging) return;
            if (smsBadge > 0) setSmsBadge(0);
            setExpanded(!expanded);
          }}
          className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center border-none cursor-grab active:cursor-grabbing transition-all
            bg-gradient-to-br ${btnColor}
            ${isRinging ? 'scale-110' : 'hover:scale-105'}
          `}
          title={isRinging ? t('floatingCommunicationsButton.title.ringing') : isActive ? t('floatingCommunicationsButton.title.active') : t('floatingCommunicationsButton.title.idle')}
        >
          {isRinging   ? <PhoneIncoming size={24} className="text-white" /> :
           isActive    ? <Phone size={22} className="text-white" /> :
           smsBadge    ? <MessageSquare size={22} className="text-white" /> :
                         <PhoneCall size={22} className="text-white" />}
        </button>

        {/* Status de chamada ativa no botão */}
        {isActive && (
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
            <span className="bg-green-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full font-mono">
              {fmt(callDuration)}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
