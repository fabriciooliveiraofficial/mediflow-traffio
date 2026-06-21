/**
 * SoftphoneWidget — Dialpad flutuante sempre visível no dashboard
 *
 * Aparece apenas quando tenant.telnyx_enabled = true.
 * Gerencia o ciclo completo: idle → discando → em chamada → encerrado.
 */

import { useState, useEffect, useRef } from 'react';
import { Phone, PhoneCall, ChevronDown, Loader2 } from 'lucide-react';
import { useTelnyxWebRTC } from '../../hooks/useTelnyxWebRTC';
import { ActiveCallView } from './ActiveCallView';
import { IncomingCallNotification } from './IncomingCallNotification';
import { supabase } from '../../lib/supabase';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

interface Props {
  enabled:       boolean;
  activeNumber?: string;   // número do tenant a usar como remetente
}

const DIAL_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

export function SoftphoneWidget({ enabled, activeNumber }: Props) {
  const [expanded,       setExpanded]       = useState(false);
  const [dialInput,      setDialInput]      = useState('');
  const [callerPatient,  setCallerPatient]  = useState<{ id: string; name: string } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const {
    status, callState, activeCall,
    isMuted, isOnHold,
    dial, answer, hangup, toggleMute, toggleHold, transfer,
    error,
  } = useTelnyxWebRTC(enabled);

  // Foca o input automaticamente quando o widget for expandido
  useEffect(() => {
    if (expanded && callState === 'idle') {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [expanded, callState]);

  // I.1 — Listener para click-to-call disparado de PatientDetails
  useEffect(() => {
    const handler = (e: Event) => {
      const { number } = (e as CustomEvent).detail ?? {};
      if (number) { setDialInput(number); setExpanded(true); }
    };
    window.addEventListener('softphone:dial', handler);
    return () => window.removeEventListener('softphone:dial', handler);
  }, []);

  // I.2 — Identificar paciente quando chegar chamada recebida
  useEffect(() => {
    if (callState !== 'ringing' || !activeCall?.remoteNumber) {
      setCallerPatient(null);
      return;
    }
    const phone = activeCall.remoteNumber.replace(/\D/g, '');
    supabase
      .from('patients')
      .select('id, full_name')
      .or(`mobile.ilike.%${phone}%,phone.ilike.%${phone}%`)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCallerPatient({ id: data.id, name: data.full_name });
      });
  }, [callState, activeCall?.remoteNumber]);

  if (!enabled) return null;

  const handleKey = (k: string) => setDialInput((prev) => prev + k);
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
    setDialInput('');
  };

  const statusColor = {
    ready:        'bg-green-500',
    connecting:   'bg-amber-400',
    error:        'bg-red-500',
    disconnected: 'bg-graphite-300',
  }[status];

  return (
    <>
      {/* Notificação de chamada recebida — I.2: mostra nome do paciente se identificado */}
      {callState === 'ringing' && activeCall && (
        <IncomingCallNotification
          call={{ ...activeCall, remoteName: callerPatient?.name ?? activeCall.remoteName }}
          onAnswer={answer}
          onReject={hangup}
        />
      )}

      {/* Elemento de áudio remoto do Telnyx WebRTC */}
      <audio id="telnyx-remote-audio" autoPlay playsInline style={{ display: 'none' }} />

      {/* Widget flutuante */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">

        {/* Active call view */}
        {(callState === 'active' || callState === 'held' || callState === 'calling') && activeCall && (
          <ActiveCallView
            call={activeCall}
            isMuted={isMuted}
            isOnHold={isOnHold}
            onHangup={hangup}
            onToggleMute={toggleMute}
            onToggleHold={toggleHold}
            onTransfer={transfer}
          />
        )}

        {/* Dialpad expandido */}
        {expanded && callState === 'idle' && (
          <div className="bg-white rounded-3xl border border-ice-100 shadow-xl w-64 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-ice-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${statusColor}`} />
                <span className="text-xs font-bold text-graphite-500">
                  {status === 'ready' ? 'Pronto' :
                   status === 'connecting' ? 'Conectando...' :
                   status === 'error' ? 'Erro' : 'Desconectado'}
                </span>
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="p-1 text-graphite-300 hover:text-graphite-600 border-none cursor-pointer bg-transparent"
              >
                <ChevronDown size={16} />
              </button>
            </div>

            {error && (
              <div className="px-4 py-2 bg-red-50 text-red-500 text-xs font-medium">
                {error}
              </div>
            )}

            {/* Display */}
            <div className="px-4 pt-4 pb-2">
              <input
                ref={inputRef}
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
            </div>

            {/* Dialpad */}
            <div className="px-4 pb-4 space-y-2">
              {DIAL_KEYS.map((row, ri) => (
                <div key={ri} className="grid grid-cols-3 gap-2">
                  {row.map((key) => (
                    <button
                      key={key}
                      onClick={() => handleKey(key)}
                      className="py-3 rounded-2xl bg-ice-50 text-graphite-700 font-black text-lg hover:bg-ice-100 active:scale-95 transition-all border-none cursor-pointer"
                    >
                      {key}
                    </button>
                  ))}
                </div>
              ))}

              {/* Botão de +, backspace e limpar */}
              <div className="grid grid-cols-3 gap-2 mt-1">
                <button
                  onClick={() => handleKey('+')}
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
                  <Phone size={18} />
                  Ligar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Botão flutuante */}
        {callState === 'idle' && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-14 h-14 rounded-full shadow-xl flex items-center justify-center border-none cursor-pointer transition-all active:scale-95"
            style={{ background: 'linear-gradient(135deg, #1152d4, #0d3fa0)' }}
            title="Softphone"
          >
            {status === 'connecting' ? (
              <Loader2 size={22} className="text-white animate-spin" />
            ) : expanded ? (
              <ChevronDown size={22} className="text-white" />
            ) : (
              <PhoneCall size={22} className="text-white" />
            )}
          </button>
        )}
      </div>
    </>
  );
}
