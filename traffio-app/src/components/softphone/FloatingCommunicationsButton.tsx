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
import {
  Phone, PhoneCall, PhoneOff, MessageSquare,
  X, Mic, MicOff, PauseCircle, PlayCircle,
  PhoneForwarded, PhoneIncoming,
} from 'lucide-react';
import { useTelnyxWebRTC } from '../../hooks/useTelnyxWebRTC';
import type { ActiveCall } from '../../hooks/useTelnyxWebRTC';
import { supabase } from '../../lib/supabase';
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
        // Foi drag: salvar posição e suprimir o click
        setPos((p) => { localStorage.setItem(storageKey, JSON.stringify(p)); return p; });
        e.stopPropagation();
      }
      hasMoved.current = false;
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
  const { pos, onMouseDown } = useDraggable(
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

  const handleCall = () => {
    if (dialInput.length < 5) return;

    let numberToDial = dialInput.trim();

    // Se o número não começa com '+', tentamos inferir o código do país pelo activeNumber
    if (!numberToDial.startsWith('+') && activeNumber) {
      const parsedActive = parsePhoneNumberFromString(activeNumber);
      const defaultCountry = parsedActive?.country; // e.g. 'BR'
      
      const parsedDial = parsePhoneNumberFromString(numberToDial, defaultCountry);
      
      if (parsedDial && parsedDial.isValid()) {
        numberToDial = parsedDial.number;
      } else {
        // Fallback se libphonenumber-js achar inválido ou incompleto (ex: 5541997759569 sem +)
        const ddi = parsedActive?.countryCallingCode;
        if (ddi) {
          const cleanNumber = numberToDial.replace(/\D/g, '');
          // Se o número limpo já começa com o DDI correspondente do activeNumber e tem comprimento razoável,
          // assumimos que o usuário digitou o DDI mas esqueceu o '+'
          if (cleanNumber.startsWith(ddi) && cleanNumber.length > ddi.length + 6) {
            numberToDial = `+${cleanNumber}`;
          } else {
            numberToDial = `+${ddi}${cleanNumber}`;
          }
        } else {
          numberToDial = numberToDial.replace(/[^\d+]/g, '');
        }
      }
    } else {
      numberToDial = numberToDial.replace(/[^\d+]/g, '');
    }

    dial(numberToDial, activeNumber);
    setExpanded(false);
    setDialInput('');
  };

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
              <p className="text-white/70 text-xs font-bold uppercase tracking-widest mb-1">Chamada Recebida</p>
              <p className="text-white text-xl font-black truncate">
                {callerName ?? activeCall.remoteNumber ?? 'Número desconhecido'}
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
                Recusar
              </button>
              <button
                onClick={() => { answer(); setExpanded(false); }}
                className="flex flex-col items-center gap-2 py-4 rounded-2xl bg-green-500 text-white font-bold text-sm hover:bg-green-600 transition-colors border-none cursor-pointer"
              >
                <Phone size={22} />
                Atender
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
                {callerName ?? activeCall.remoteNumber ?? 'Em chamada'}
              </p>
              <p className="text-white/70 text-xs font-mono">{fmt(callDuration)}</p>
            </div>
          </div>
          <div className="px-3 py-3 grid grid-cols-4 gap-1.5">
            <button onClick={toggleMute} className={`flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-bold transition-colors border-none cursor-pointer ${isMuted ? 'bg-red-50 text-red-500' : 'bg-ice-50 text-graphite-500'}`}>
              {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
              {isMuted ? 'Mudo' : 'Mic'}
            </button>
            <button onClick={toggleHold} className={`flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-bold transition-colors border-none cursor-pointer ${isOnHold ? 'bg-amber-50 text-amber-500' : 'bg-ice-50 text-graphite-500'}`}>
              {isOnHold ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
              {isOnHold ? 'Retomar' : 'Espera'}
            </button>
            <button onClick={() => setShowTransfer(!showTransfer)} className="flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-bold bg-ice-50 text-graphite-500 transition-colors border-none cursor-pointer">
              <PhoneForwarded size={14} />
              Transfer
            </button>
            <button onClick={hangup} className="flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-bold bg-red-500 text-white transition-colors border-none cursor-pointer">
              <PhoneOff size={14} />
              Desligar
            </button>
          </div>
          {showTransfer && (
            <div className="px-3 pb-3 flex gap-1.5">
              <input value={transferInput} onChange={(e) => setTransferInput(e.target.value)} placeholder="Número destino" className="flex-1 text-xs bg-ice-50 border border-ice-200 rounded-xl px-2 py-1.5 focus:outline-none" />
              <button onClick={() => { transfer(transferInput); setShowTransfer(false); }} className="px-2 py-1.5 bg-brand-primary text-white text-xs font-bold rounded-xl border-none cursor-pointer">OK</button>
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
            // Posicionar o painel ACIMA ou à esquerda do botão, nunca sobre ele
            left: Math.min(Math.max(8, pos.x - 288 + 56), window.innerWidth - 296),
            top:  Math.max(8, pos.y - 380),
          }}
        >
          {/* Header do painel */}
          <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 flex items-center justify-between">
            <div className="flex gap-1 bg-white/20 p-0.5 rounded-xl">
              <button onClick={() => setMode('dial')} className={`px-3 py-1 rounded-xl text-xs font-bold transition-all border-none cursor-pointer ${mode === 'dial' ? 'bg-white text-blue-600' : 'text-white'}`}>
                <Phone size={12} className="inline mr-1" />Ligar
              </button>
              <button onClick={() => setMode('sms')} className={`px-3 py-1 rounded-xl text-xs font-bold transition-all border-none cursor-pointer ${mode === 'sms' ? 'bg-white text-blue-600' : 'text-white'}`}>
                <MessageSquare size={12} className="inline mr-1" />SMS
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
                placeholder="Digite o número..."
                className="w-full text-center text-xl font-black text-graphite-800 bg-ice-50 border border-ice-200 rounded-2xl px-3 py-2.5 focus:outline-none focus:border-brand-primary font-mono tracking-widest"
              />
              {/* Dialpad */}
              {[['1','2','3'],['4','5','6'],['7','8','9'],['*','0','#']].map((row, ri) => (
                <div key={ri} className="grid grid-cols-3 gap-2">
                  {row.map((k) => (
                    <button key={k} onClick={() => setDialInput((p) => p + k)}
                      className="py-3 rounded-2xl bg-ice-50 text-graphite-700 font-black text-lg hover:bg-ice-100 active:scale-95 transition-all border-none cursor-pointer">
                      {k}
                    </button>
                  ))}
                </div>
              ))}
              {/* Botões de +, backspace e limpar */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setDialInput((p) => p + '+')}
                  className="py-3 rounded-2xl bg-ice-50 text-graphite-700 font-black text-lg hover:bg-ice-100 active:scale-95 transition-all border-none cursor-pointer"
                >
                  +
                </button>
                <button
                  onClick={() => setDialInput((p) => p.slice(0, -1))}
                  className="py-3 rounded-2xl bg-ice-50 text-graphite-400 font-bold text-sm hover:bg-ice-100 transition-all border-none cursor-pointer"
                >
                  ⌫
                </button>
                <button
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
                  <Phone size={18} /> Ligar
                </button>
              </div>
            </div>
          )}

          {/* Modo: SMS */}
          {mode === 'sms' && (
            <div className="p-4 space-y-3">
              <input type="tel" value={smsTo} onChange={(e) => setSmsTo(e.target.value)}
                placeholder="Número destinatário..." className="w-full text-sm bg-ice-50 border border-ice-200 rounded-2xl px-3 py-2.5 focus:outline-none focus:border-brand-primary" />
              <textarea
                value={smsInput} onChange={(e) => setSmsInput(e.target.value)}
                placeholder="Digite a mensagem SMS..." rows={4}
                className="w-full text-sm bg-ice-50 border border-ice-200 rounded-2xl px-3 py-2.5 resize-none focus:outline-none focus:border-brand-primary"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-graphite-400">{smsInput.length}/160 chars</span>
                <button
                  disabled={!smsTo || !smsInput || smsInput.length > 160}
                  onClick={async () => {
                    // Enviar SMS via endpoint existente
                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session) return;
                    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telnyx-numbers`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'send_sms', to: smsTo, text: smsInput }),
                    });
                    setSmsInput(''); setSmsTo('');
                    setExpanded(false);
                  }}
                  className="px-4 py-2 bg-green-500 text-white text-sm font-bold rounded-2xl disabled:opacity-40 disabled:cursor-not-allowed border-none cursor-pointer"
                >
                  <MessageSquare size={14} className="inline mr-1" />Enviar
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
            if (isRinging) return;
            if (smsBadge > 0) setSmsBadge(0);
            setExpanded(!expanded);
          }}
          className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center border-none cursor-grab active:cursor-grabbing transition-all
            bg-gradient-to-br ${btnColor}
            ${isRinging ? 'scale-110' : 'hover:scale-105'}
          `}
          title={isRinging ? 'Chamada recebida' : isActive ? 'Em chamada' : 'Comunicações'}
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
