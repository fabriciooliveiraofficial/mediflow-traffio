import { useCallback, useEffect, useRef, useState } from 'react';
import { isAppBusy } from '../lib/appBusyGuard';

interface VersionManifest {
    version?: string;
    buildTime?: string;
}

interface AppUpdateState {
    available: boolean;
    deferred: boolean;
    updating: boolean;
    version: string | null;
    buildTime: string | null;
}

const VERSION_CHECK_INTERVAL_MS = 5000;
const UPDATE_CHANNEL_NAME = 'traffio_app_update';
// Se ficar "ocupado" (digitando, em ligação) por muito tempo seguido, aplica
// mesmo assim depois desse teto — nunca fica preso indefinidamente numa
// versão velha só porque o usuário deixou uma aba aberta e esquecida.
const MAX_DEFER_MS = 20 * 60 * 1000;

export const CURRENT_APP_VERSION = __APP_VERSION__;
export const CURRENT_APP_BUILD_TIME = __APP_BUILD_TIME__;

const initialState: AppUpdateState = {
    available: false,
    deferred: false,
    updating: false,
    version: null,
    buildTime: null,
};

/**
 * Verdadeiro só quando é seguro recarregar a página sozinho: nenhum campo de
 * texto focado (não perde rascunho de mensagem/formulário) e nenhum fluxo
 * crítico registrado como ocupado (ex: ligação em andamento — ver
 * appBusyGuard.ts / useBusyGuard).
 */
const isSafeToApplyNow = (): boolean => {
    if (isAppBusy()) return false;

    const el = document.activeElement as HTMLElement | null;
    if (!el) return true;

    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (el.isContentEditable) return false;

    return true;
};

const waitForControllerChange = () => {
    return new Promise<void>((resolve) => {
        if (!('serviceWorker' in navigator)) {
            resolve();
            return;
        }

        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            navigator.serviceWorker.removeEventListener('controllerchange', finish);
            resolve();
        };
        const timeoutId = window.setTimeout(finish, 3000);
        navigator.serviceWorker.addEventListener('controllerchange', finish);
    });
};

const waitForInstallingWorker = (registration: ServiceWorkerRegistration) => {
    return new Promise<void>((resolve) => {
        const worker = registration.installing;
        if (!worker) {
            resolve();
            return;
        }

        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            worker.removeEventListener('statechange', handleStateChange);
            resolve();
        };
        const handleStateChange = () => {
            if (['installed', 'activated', 'redundant'].includes(worker.state)) {
                finish();
            }
        };
        const timeoutId = window.setTimeout(finish, 5000);
        worker.addEventListener('statechange', handleStateChange);
        handleStateChange();
    });
};

const reloadCurrentPage = () => {
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('__traffio_update', Date.now().toString());
        window.location.replace(url.toString());
    } catch {
        window.location.reload();
    }
};

export function useAppUpdate() {
    const [state, setState] = useState<AppUpdateState>(initialState);
    const stateRef = useRef(state);
    stateRef.current = state;
    const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
    const updateChannelRef = useRef<BroadcastChannel | null>(null);
    const deferredSinceRef = useRef<number | null>(null);
    const applyingRef = useRef(false);

    const activateWaitingServiceWorker = useCallback(async () => {
        if (!('serviceWorker' in navigator)) return;

        const registration = registrationRef.current ?? await navigator.serviceWorker.getRegistration();
        if (!registration) return;

        const updatedRegistration = await registration.update().catch(() => registration);
        await waitForInstallingWorker(updatedRegistration);

        const waitingWorker = updatedRegistration.waiting ?? registration.waiting;
        if (!waitingWorker) return;

        const controllerChange = waitForControllerChange();
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        await controllerChange;
    }, []);

    /** Aplica a atualização agora, incondicionalmente (chamado quando já é seguro, ou pelo botão manual). */
    const applyUpdate = useCallback(async () => {
        if (applyingRef.current) return;
        applyingRef.current = true;
        setState((current) => ({ ...current, updating: true }));

        try {
            await Promise.race([
                activateWaitingServiceWorker(),
                new Promise((resolve) => setTimeout(resolve, 8000)),
            ]);
        } catch (error) {
            console.error('[AppUpdate] Failed to apply update cleanly:', error);
        } finally {
            reloadCurrentPage();
        }
    }, [activateWaitingServiceWorker]);

    /** Uma atualização foi detectada: aplica na hora se for seguro, senão fica "adiada" até virar seguro. */
    const scheduleUpdate = useCallback((manifest?: VersionManifest) => {
        if (applyingRef.current) return;

        const version = manifest?.version ?? null;
        const buildTime = manifest?.buildTime ?? null;

        if (isSafeToApplyNow()) {
            applyUpdate();
            return;
        }

        if (deferredSinceRef.current === null) {
            deferredSinceRef.current = Date.now();
        }

        setState((current) => ({
            ...current,
            available: true,
            deferred: true,
            version: version ?? current.version,
            buildTime: buildTime ?? current.buildTime,
        }));
    }, [applyUpdate]);

    /** Reavalia uma atualização adiada — chamado em blur/foco/visibilidade e no polling. */
    const recheckDeferred = useCallback(() => {
        if (!stateRef.current.deferred || applyingRef.current) return;

        const waitedTooLong = deferredSinceRef.current !== null
            && (Date.now() - deferredSinceRef.current) >= MAX_DEFER_MS;

        if (waitedTooLong || isSafeToApplyNow()) {
            applyUpdate();
        }
    }, [applyUpdate]);

    const checkPublishedVersion = useCallback(async () => {
        if (import.meta.env.DEV) return;

        try {
            const response = await fetch(`/app-version.json?t=${Date.now()}`, {
                cache: 'no-store',
                credentials: 'omit',
                headers: {
                    'Cache-Control': 'no-cache',
                    Pragma: 'no-cache',
                },
            });

            if (!response.ok) {
                console.warn('[AppUpdate] Version check response not ok:', response.status);
                return;
            }

            const contentType = response.headers.get('content-type') ?? '';
            if (!contentType.includes('application/json')) {
                console.warn('[AppUpdate] Version check response is not JSON:', contentType);
                return;
            }

            const manifest = await response.json() as VersionManifest;
            if (manifest.version && manifest.version !== CURRENT_APP_VERSION) {
                scheduleUpdate(manifest);
                updateChannelRef.current?.postMessage(manifest);
            }
        } catch (error) {
            console.error('[AppUpdate] Version check failed:', error);
        }
    }, [scheduleUpdate]);

    // Registro do service worker + detecção de nova versão instalada.
    useEffect(() => {
        if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;

        let disposed = false;
        let updateIntervalId: number | undefined;

        const checkSWUpdate = (registration: ServiceWorkerRegistration) => {
            if (!disposed) {
                registration.update().catch((err) => {
                    console.debug('[AppUpdate] SW auto-update check failed:', err);
                });
            }
        };

        const watchRegistration = (registration: ServiceWorkerRegistration) => {
            registrationRef.current = registration;

            if (registration.waiting && navigator.serviceWorker.controller) {
                scheduleUpdate();
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }

            registration.addEventListener('updatefound', () => {
                const worker = registration.installing;
                if (!worker) return;

                worker.addEventListener('statechange', () => {
                    if (!disposed && worker.state === 'installed' && navigator.serviceWorker.controller) {
                        scheduleUpdate();
                        worker.postMessage({ type: 'SKIP_WAITING' });
                    }
                });
            });

            updateIntervalId = window.setInterval(() => checkSWUpdate(registration), VERSION_CHECK_INTERVAL_MS);

            const handleFocusUpdate = () => checkSWUpdate(registration);
            window.addEventListener('focus', handleFocusUpdate);

            const handleVisibilityUpdate = () => {
                if (document.visibilityState === 'visible') {
                    checkSWUpdate(registration);
                }
            };
            document.addEventListener('visibilitychange', handleVisibilityUpdate);

            return () => {
                window.clearInterval(updateIntervalId);
                window.removeEventListener('focus', handleFocusUpdate);
                document.removeEventListener('visibilitychange', handleVisibilityUpdate);
            };
        };

        let cleanupEvents: (() => void) | undefined;

        navigator.serviceWorker
            .register('/sw.js', { updateViaCache: 'none' })
            .then((registration) => {
                if (disposed) return;
                cleanupEvents = watchRegistration(registration);
                registration.update().catch(() => {});
            })
            .catch((error) => {
                console.error('[AppUpdate] Service worker registration failed:', error);
            });

        return () => {
            disposed = true;
            if (cleanupEvents) {
                cleanupEvents();
            }
        };
    }, [scheduleUpdate]);

    // Sincroniza a detecção de update entre abas abertas ao mesmo tempo.
    useEffect(() => {
        if (!('BroadcastChannel' in window)) return;

        const channel = new BroadcastChannel(UPDATE_CHANNEL_NAME);
        updateChannelRef.current = channel;
        channel.onmessage = (event: MessageEvent<VersionManifest>) => {
            if (event.data?.version && event.data.version !== CURRENT_APP_VERSION) {
                scheduleUpdate(event.data);
            }
        };

        return () => {
            updateChannelRef.current = null;
            channel.close();
        };
    }, [scheduleUpdate]);

    // Polling do manifest de versão publicado (fallback caso o SW não avise).
    useEffect(() => {
        checkPublishedVersion();

        const intervalId = window.setInterval(checkPublishedVersion, VERSION_CHECK_INTERVAL_MS);
        const handleFocus = () => checkPublishedVersion();
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkPublishedVersion();
            }
        };

        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [checkPublishedVersion]);

    // Enquanto uma atualização estiver adiada: reavalia a cada poucos segundos
    // e a cada vez que o usuário sai de um campo de texto/muda de aba — assim
    // ela é aplicada automaticamente no primeiro momento seguro, sem precisar
    // de nenhuma ação do usuário.
    useEffect(() => {
        if (!state.deferred) return;

        const interval = window.setInterval(recheckDeferred, VERSION_CHECK_INTERVAL_MS);
        document.addEventListener('focusout', recheckDeferred);
        document.addEventListener('visibilitychange', recheckDeferred);

        return () => {
            window.clearInterval(interval);
            document.removeEventListener('focusout', recheckDeferred);
            document.removeEventListener('visibilitychange', recheckDeferred);
        };
    }, [state.deferred, recheckDeferred]);

    return {
        updateAvailable: state.available,
        updateDeferred: state.deferred,
        updating: state.updating,
        version: state.version,
        buildTime: state.buildTime,
        currentVersion: CURRENT_APP_VERSION,
        currentBuildTime: CURRENT_APP_BUILD_TIME,
        applyUpdate,
    };
}
