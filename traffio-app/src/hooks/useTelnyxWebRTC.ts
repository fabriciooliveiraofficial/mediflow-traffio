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
import { logPlatformClient } from '../lib/logger';

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
      logPlatformClient({
        level: 'info',
        source: 'useTelnyxWebRTC',
        eventName: 'fetch_token_started',
        message: 'Starting request to fetch Telnyx login token'
      });

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        logPlatformClient({
          level: 'warn',
          source: 'useTelnyxWebRTC',
          eventName: 'fetch_token_no_session',
          message: 'No active session found when fetching login token'
        });
        return null;
      }

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
      if (!res.ok) {
        const text = await res.text();
        logPlatformClient({
          level: 'error',
          source: 'useTelnyxWebRTC',
          eventName: 'fetch_token_failed',
          message: `Failed to fetch login token from API. Status: ${res.status}`,
          metadata: { status: res.status, responseText: text }
        });
        return null;
      }
      const data = await res.json();
      if (!data.loginToken) {
        logPlatformClient({
          level: 'error',
          source: 'useTelnyxWebRTC',
          eventName: 'fetch_token_missing_token',
          message: 'API response did not contain loginToken',
          metadata: { data }
        });
      } else {
        logPlatformClient({
          level: 'info',
          source: 'useTelnyxWebRTC',
          eventName: 'fetch_token_success',
          message: 'Successfully retrieved Telnyx login token from API'
        });
      }
      return data.loginToken ?? null;
    } catch (err: any) {
      logPlatformClient({
        level: 'error',
        source: 'useTelnyxWebRTC',
        eventName: 'fetch_token_exception',
        message: `Exception while fetching login token: ${err.message}`,
        metadata: { stack: err.stack }
      });
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

      logPlatformClient({
        level: 'info',
        source: 'useTelnyxWebRTC',
        eventName: 'webrtc_connect_initiated',
        message: 'Initializing Telnyx WebRTC connection'
      });

      const token = await fetchLoginToken();
      if (!token) {
        if (mounted) {
          setStatus('error');
          setError('Softphone não configurado. Contate o administrador.');
        }
        logPlatformClient({
          level: 'error',
          source: 'useTelnyxWebRTC',
          eventName: 'webrtc_connect_no_token',
          message: 'WebRTC connection aborted: Failed to retrieve login token'
        });
        return;
      }

      const client = new TelnyxRTC({ login_token: token });
      clientRef.current = client;

      client.on('telnyx.ready', () => {
        if (!mounted) return;
        setStatus('ready');
        scheduleTokenRefresh(client);
        logPlatformClient({
          level: 'info',
          source: 'useTelnyxWebRTC',
          eventName: 'webrtc_ready',
          message: 'Telnyx WebRTC client connected and ready'
        });
      });

      client.on('telnyx.error', (err: any) => {
        if (!mounted) return;
        setStatus('error');
        setError(err?.message ?? 'Erro de conexão WebRTC');
        logPlatformClient({
          level: 'error',
          source: 'useTelnyxWebRTC',
          eventName: 'webrtc_error',
          message: `Telnyx WebRTC client error: ${err?.message ?? 'Unknown WebRTC error'}`,
          metadata: { error: err }
        });
      });

      client.on('telnyx.socket.close', () => {
        if (!mounted) return;
        setStatus('disconnected');
        logPlatformClient({
          level: 'info',
          source: 'useTelnyxWebRTC',
          eventName: 'webrtc_socket_closed',
          message: 'Telnyx WebRTC socket connection closed'
        });
      });

      client.on('telnyx.notification', (notification: any) => {
        if (!mounted) return;

        // Registrar notificações do WebRTC para diagnóstico detalhado do ciclo de chamada
        logPlatformClient({
          level: 'info',
          source: 'useTelnyxWebRTC',
          eventName: `notification_${notification.type}`,
          message: `Telnyx notification received: ${notification.type} (call state: ${notification.call?.state ?? 'N/A'})`,
          metadata: {
            type: notification.type,
            callId: notification.call?.id,
            state: notification.call?.state,
            direction: notification.call?.direction,
            cause: notification.call?.cause,
            remoteNumber: notification.call?.remoteNumber,
            callerNumber: notification.call?.callerNumber,
          }
        });

        if (notification.type !== 'callUpdate') return;

        const call  = notification.call;
        const state = call.state;

        callRef.current = call;

        if (state === 'ringing' || state === 'early') {
          const isIncoming = call.direction === 'inbound' || call.direction === 'incoming';
          setCallState(isIncoming ? 'ringing' : 'calling');
          setActiveCall({
            id:           call.id,
            direction:    isIncoming ? 'inbound' : 'outbound',
            remoteNumber: call.remoteNumber ?? call.callerNumber ?? '',
            remoteName:   call.callerName ?? undefined,
            startedAt:    new Date(),
            callRef:      call,
          });
        } else if (state === 'active') {
          setCallState('active');
          setActiveCall((prev) => {
            const isIncoming = call.direction === 'inbound' || call.direction === 'incoming';
            return prev
              ? { ...prev, callRef: call }
              : {
                  id:           call.id,
                  direction:    isIncoming ? 'inbound' : 'outbound',
                  remoteNumber: call.remoteNumber ?? '',
                  startedAt:    new Date(),
                  callRef:      call,
                };
          });
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
    if (!clientRef.current || status !== 'ready') {
      logPlatformClient({
        level: 'warn',
        source: 'useTelnyxWebRTC',
        eventName: 'dial_aborted',
        message: 'Cannot place call: WebRTC client not ready',
        metadata: { status, destinationNumber: number, callerNumber }
      });
      return;
    }
    setCallState('calling');
    logPlatformClient({
      level: 'info',
      source: 'useTelnyxWebRTC',
      eventName: 'dial_initiated',
      message: `Placing call to ${number}`,
      metadata: { destinationNumber: number, callerNumber }
    });
    clientRef.current.newCall({
      destinationNumber: number,
      callerName:        'Traffio',
      callerNumber:      callerNumber ?? '',
      audio:             true,
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
