/**
 * useTelnyxWebRTC — Hook de WebRTC para o softphone
 *
 * Conecta ao servidor Telnyx, gerencia estado da chamada e expõe
 * controles (ligar, atender, desligar, mudo, espera, transferir).
 *
 * loginToken é renovado automaticamente antes de expirar (a cada 55 min).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { TelnyxRTC } from '@telnyx/webrtc';
import { supabase } from '../lib/supabase';

export type CallState =
  | 'idle'       // sem chamada
  | 'ringing'    // chamada entrando (inbound)
  | 'calling'    // discando (outbound)
  | 'active'     // em chamada
  | 'held';      // em espera

export interface ActiveCall {
  id:          string;
  direction:   'inbound' | 'outbound';
  remoteNumber: string;
  remoteName?:  string;
  startedAt:   Date;
  callRef:     any;   // referência ao objeto call da SDK Telnyx
}

interface UseTelnyxWebRTCReturn {
  status:         'connecting' | 'ready' | 'error' | 'disconnected';
  callState:      CallState;
  activeCall:     ActiveCall | null;
  isMuted:        boolean;
  isOnHold:       boolean;
  dial:           (number: string, callerNumber?: string) => void;
  answer:         () => void;
  hangup:         () => void;
  toggleMute:     () => void;
  toggleHold:     () => void;
  transfer:       (toNumber: string) => void;
  error:          string | null;
}

export function useTelnyxWebRTC(enabled: boolean): UseTelnyxWebRTCReturn {
  const clientRef    = useRef<TelnyxRTC | null>(null);
  const callRef      = useRef<any>(null);
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status,     setStatus]     = useState<'connecting' | 'ready' | 'error' | 'disconnected'>('disconnected');
  const [callState,  setCallState]  = useState<CallState>('idle');
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [isMuted,    setIsMuted]    = useState(false);
  const [isOnHold,   setIsOnHold]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // ── Buscar loginToken da Edge Function ──────────────────────────────────────
  const fetchLoginToken = useCallback(async (): Promise<string | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telnyx-agent-credentials`,
        {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ action: 'create' }),
        }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.loginToken ?? null;
    } catch {
      return null;
    }
  }, []);

  // ── Renovar token automaticamente a cada 55 min ─────────────────────────────
  const scheduleTokenRefresh = useCallback((client: TelnyxRTC) => {
    if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
    tokenTimerRef.current = setTimeout(async () => {
      const newToken = await fetchLoginToken();
      if (newToken && client) {
        // @ts-ignore — internal method para atualizar token sem reconectar
        client.updateToken?.(newToken);
      }
      scheduleTokenRefresh(client);
    }, 55 * 60 * 1000);
  }, [fetchLoginToken]);

  // ── Conectar ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    let mounted = true;

    async function connect() {
      setStatus('connecting');
      setError(null);

      const token = await fetchLoginToken();
      if (!token) {
        if (mounted) {
          setStatus('error');
          setError('Softphone não configurado. Contate o administrador.');
        }
        return;
      }

      const client = new TelnyxRTC({ login_token: token });
      clientRef.current = client;

      client.on('telnyx.ready', () => {
        if (!mounted) return;
        setStatus('ready');
        scheduleTokenRefresh(client);
      });

      client.on('telnyx.error', (err: any) => {
        if (!mounted) return;
        setStatus('error');
        setError(err?.message ?? 'Erro de conexão WebRTC');
      });

      client.on('telnyx.socket.close', () => {
        if (!mounted) return;
        setStatus('disconnected');
      });

      client.on('telnyx.notification', (notification: any) => {
        if (!mounted) return;
        if (notification.type !== 'callUpdate') return;

        const call  = notification.call;
        const state = call.state;

        callRef.current = call;

        if (state === 'ringing' || state === 'early') {
          setCallState('ringing');
          setActiveCall({
            id:           call.id,
            direction:    call.direction === 'inbound' ? 'inbound' : 'outbound',
            remoteNumber: call.remoteNumber ?? call.callerNumber ?? '',
            remoteName:   call.callerName ?? undefined,
            startedAt:    new Date(),
            callRef:      call,
          });
        } else if (state === 'active') {
          setCallState('active');
          setActiveCall((prev) => prev
            ? { ...prev, callRef: call }
            : {
                id:           call.id,
                direction:    'outbound',
                remoteNumber: call.remoteNumber ?? '',
                startedAt:    new Date(),
                callRef:      call,
              }
          );
        } else if (state === 'held') {
          setCallState('held');
          setIsOnHold(true);
        } else if (state === 'done' || state === 'hangup') {
          setCallState('idle');
          setActiveCall(null);
          setIsMuted(false);
          setIsOnHold(false);
          callRef.current = null;
        }
      });

      client.connect();
    }

    connect();

    return () => {
      mounted = false;
      if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [enabled, fetchLoginToken, scheduleTokenRefresh]);

  // ── Controles ────────────────────────────────────────────────────────────────

  const dial = useCallback((number: string, callerNumber?: string) => {
    if (!clientRef.current || status !== 'ready') return;
    setCallState('calling');
    clientRef.current.newCall({
      destinationNumber: number,
      callerName:        'Traffio',
      callerNumber:      callerNumber ?? '',
    });
  }, [status]);

  const answer = useCallback(() => {
    callRef.current?.answer();
  }, []);

  const hangup = useCallback(() => {
    callRef.current?.hangup();
  }, []);

  const toggleMute = useCallback(() => {
    if (!callRef.current) return;
    if (isMuted) {
      callRef.current.unmuteAudio();
      setIsMuted(false);
    } else {
      callRef.current.muteAudio();
      setIsMuted(true);
    }
  }, [isMuted]);

  const toggleHold = useCallback(() => {
    if (!callRef.current) return;
    if (isOnHold) {
      callRef.current.unhold();
      setIsOnHold(false);
      setCallState('active');
    } else {
      callRef.current.hold();
      setIsOnHold(true);
      setCallState('held');
    }
  }, [isOnHold]);

  const transfer = useCallback((toNumber: string) => {
    callRef.current?.transfer(toNumber);
  }, []);

  return {
    status, callState, activeCall,
    isMuted, isOnHold,
    dial, answer, hangup, toggleMute, toggleHold, transfer,
    error,
  };
}
