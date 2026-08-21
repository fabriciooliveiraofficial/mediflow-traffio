import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { supabase } from '../lib/supabase';

const SESSION_TOKEN_KEY = 'traffio_session_token';
const HEARTBEAT_INTERVAL = 30000; // 30 segundos

function getDeviceLabel(): string {
    const ua = navigator.userAgent;
    let browser = 'Navegador';
    let os = 'Desconhecido';

    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edge')) browser = 'Edge';

    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
    else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    return `${browser} · ${os}`;
}

let isLoggingOutGlobal = false;
// Lock em escopo de módulo (não por instância do hook): impede que duas
// montagens simultâneas do hook para o mesmo token disputem o mesmo canal
// Realtime `session_kick:<token>` — o Supabase reaproveita o canal pelo nome,
// e chamar `.on()` numa segunda instância já `joined`/`joining` lança exceção
// e pode deixar essa segunda instância sem heartbeat/realtime ativo.
const registeredTokens = new Set<string>();

export function useSessionGuard() {
    const { session, user } = useAuth();
    const { tenant } = useTenant();
    const [kicked, setKicked] = useState(false);
    const registrationAttempted = useRef(false);
    const heartbeatTimer = useRef<NodeJS.Timeout | null>(null);

    // Obter ou criar token de sessão único para este perfil do navegador
    const getSessionToken = useCallback((): string => {
        let token = localStorage.getItem(SESSION_TOKEN_KEY);
        if (!token) {
            token = crypto.randomUUID();
            localStorage.setItem(SESSION_TOKEN_KEY, token);
        }
        return token;
    }, []);

    // Desativa a sessão atual (ex: no logout manual)
    const deactivateCurrentSession = useCallback(async () => {
        isLoggingOutGlobal = true;
        setKicked(false);
        const token = localStorage.getItem(SESSION_TOKEN_KEY);
        if (token && user) {
            try {
                await supabase.rpc('deactivate_session', { p_session_id: token });
            } catch (err) {
                console.error('[SessionGuard] Falha ao inativar sessão no logout:', err);
            }
        }
        localStorage.removeItem(SESSION_TOKEN_KEY);
        registrationAttempted.current = false;
        if (heartbeatTimer.current) {
            clearInterval(heartbeatTimer.current);
            heartbeatTimer.current = null;
        }
    }, [user]);

    // Função para verificar se a sessão continua ativa
    const checkValidity = useCallback(async () => {
        if (isLoggingOutGlobal) return;
        const token = localStorage.getItem(SESSION_TOKEN_KEY);
        if (!token || !user) return;

        try {
            const { data: isValid, error } = await supabase.rpc('check_session_valid', {
                p_session_id: token
            });

            if (!error && isValid === false && !isLoggingOutGlobal) {
                console.warn('[SessionGuard] Sessão invalidada (verificação de validade).');
                setKicked(true);
                if (heartbeatTimer.current) {
                    clearInterval(heartbeatTimer.current);
                    heartbeatTimer.current = null;
                }
            }
        } catch (err) {
            console.error('[SessionGuard] Erro ao verificar validade da sessão:', err);
        }
    }, [user]);

    useEffect(() => {
        // Se não houver usuário logado ou tenant, não inicia segurança de sessão
        if (!user || !tenant?.id) {
            isLoggingOutGlobal = false;
            if (heartbeatTimer.current) {
                clearInterval(heartbeatTimer.current);
                heartbeatTimer.current = null;
            }
            registrationAttempted.current = false;
            return;
        }

        const token = getSessionToken();
        const deviceLabel = getDeviceLabel();

        // Variável de controle para o canal de realtime
        let channel: any = null;

        const registerAndStartHeartbeat = async () => {
            if (registrationAttempted.current) return;
            if (registeredTokens.has(token)) {
                // Outra instância do hook já está registrando/registrada para este
                // token (ex: montagem duplicada em componentes aninhados) — não
                // disputa o mesmo canal Realtime.
                registrationAttempted.current = true;
                return;
            }
            registrationAttempted.current = true;
            registeredTokens.add(token);

            try {
                // 1. Registra a sessão atual no banco de dados
                const { error } = await supabase.rpc('register_session', {
                    p_session_id: token,
                    p_tenant_id: tenant.id,
                    p_device_label: deviceLabel,
                    p_user_agent: navigator.userAgent,
                    p_ip_address: null
                });

                if (error) {
                    console.error('[SessionGuard] Erro ao registrar sessão:', error);
                    registrationAttempted.current = false;
                    return;
                }

                // 2. Inscreve no canal de tempo real (Realtime) para detecção imediata (em milissegundos)
                channel = supabase
                    .channel(`session_kick:${token}`)
                    .on('postgres_changes', {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'active_sessions',
                        filter: `session_id=eq.${token}`
                    }, (payload: any) => {
                        if (isLoggingOutGlobal) return;
                        console.log('[SessionGuard] Realtime payload:', payload);
                        if (payload.new && payload.new.is_current === false && !isLoggingOutGlobal) {
                            console.warn('[SessionGuard] Sessão invalidada em tempo real por outro dispositivo.');
                            setKicked(true);
                            if (heartbeatTimer.current) {
                                clearInterval(heartbeatTimer.current);
                                heartbeatTimer.current = null;
                            }
                        }
                    })
                    .subscribe();

                // 3. Inicia o loop de Heartbeat a cada 60s
                if (heartbeatTimer.current) {
                    clearInterval(heartbeatTimer.current);
                }

                heartbeatTimer.current = setInterval(async () => {
                    if (isLoggingOutGlobal) return;
                    try {
                        const { data: isValid, error: hbError } = await supabase.rpc('session_heartbeat', {
                            p_session_id: token
                        });

                        if (hbError) {
                            console.warn('[SessionGuard] Falha no heartbeat:', hbError);
                            return;
                        }

                        if (isValid === false && !isLoggingOutGlobal) {
                            console.warn('[SessionGuard] Sessão invalidada por outro login (heartbeat).');
                            setKicked(true);
                            if (heartbeatTimer.current) {
                                clearInterval(heartbeatTimer.current);
                                heartbeatTimer.current = null;
                            }
                        }
                    } catch (hbErr) {
                        console.error('[SessionGuard] Erro na execução do heartbeat:', hbErr);
                    }
                }, HEARTBEAT_INTERVAL);

            } catch (err) {
                console.error('[SessionGuard] Erro crítico no registro de sessão:', err);
                registrationAttempted.current = false;
                registeredTokens.delete(token);
            }
        };

        registerAndStartHeartbeat();

        // 4. Ouvinte de visibilidade da página para checagem imediata quando o usuário clica de volta na aba
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && !isLoggingOutGlobal) {
                checkValidity();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleVisibilityChange);
            if (channel) {
                supabase.removeChannel(channel);
            }
            registeredTokens.delete(token);
        };
    }, [user, tenant?.id, getSessionToken, checkValidity]);

    // Limpeza ao desmontar componente
    useEffect(() => {
        return () => {
            if (heartbeatTimer.current) {
                clearInterval(heartbeatTimer.current);
                heartbeatTimer.current = null;
            }
        };
    }, []);

    return {
        kicked,
        deactivateCurrentSession
    };
}
