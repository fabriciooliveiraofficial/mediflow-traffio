import { useCallback, useEffect, useRef, useState } from 'react';

interface VersionManifest {
    version?: string;
    buildTime?: string;
}

interface AppUpdateState {
    available: boolean;
    updating: boolean;
    version: string | null;
    buildTime: string | null;
}

const VERSION_CHECK_INTERVAL_MS = 30000;
const SKIPPED_VERSION_KEY = 'traffio_skipped_app_update_version';
const SKIPPED_SW_SESSION_KEY = 'traffio_skipped_service_worker_update';

export const CURRENT_APP_VERSION = __APP_VERSION__;
export const CURRENT_APP_BUILD_TIME = __APP_BUILD_TIME__;

const initialState: AppUpdateState = {
    available: false,
    updating: false,
    version: null,
    buildTime: null,
};

const safeReadStorage = (storage: Storage, key: string) => {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
};

const safeWriteStorage = (storage: Storage, key: string, value: string) => {
    try {
        storage.setItem(key, value);
    } catch {
        // Storage may be unavailable in private or restricted contexts.
    }
};

const safeRemoveStorage = (storage: Storage, key: string) => {
    try {
        storage.removeItem(key);
    } catch {
        // Storage may be unavailable in private or restricted contexts.
    }
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
    const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

    const markUpdateAvailable = useCallback((manifest?: VersionManifest) => {
        const version = manifest?.version ?? null;
        const buildTime = manifest?.buildTime ?? null;

        if (version && safeReadStorage(window.localStorage, SKIPPED_VERSION_KEY) === version) {
            return;
        }

        if (!version && safeReadStorage(window.sessionStorage, SKIPPED_SW_SESSION_KEY) === CURRENT_APP_VERSION) {
            return;
        }

        setState((current) => ({
            ...current,
            available: true,
            version,
            buildTime,
        }));
    }, []);

    const checkPublishedVersion = useCallback(async () => {
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

            const manifest = await response.json() as VersionManifest;
            if (manifest.version && manifest.version !== CURRENT_APP_VERSION) {
                markUpdateAvailable(manifest);
            }
        } catch (error) {
            console.error('[AppUpdate] Version check failed:', error);
        }
    }, [markUpdateAvailable]);

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

    const applyUpdate = useCallback(async () => {
        setState((current) => ({ ...current, updating: true }));
        safeRemoveStorage(window.localStorage, SKIPPED_VERSION_KEY);
        safeRemoveStorage(window.sessionStorage, SKIPPED_SW_SESSION_KEY);

        try {
            await activateWaitingServiceWorker();
        } catch (error) {
            console.error('[AppUpdate] Failed to apply update cleanly:', error);
        } finally {
            reloadCurrentPage();
        }
    }, [activateWaitingServiceWorker]);

    const skipUpdate = useCallback(() => {
        if (state.version) {
            safeWriteStorage(window.localStorage, SKIPPED_VERSION_KEY, state.version);
        } else {
            safeWriteStorage(window.sessionStorage, SKIPPED_SW_SESSION_KEY, CURRENT_APP_VERSION);
        }

        setState((current) => ({
            ...current,
            available: false,
            updating: false,
        }));
    }, [state.version]);

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
                markUpdateAvailable();
            }

            registration.addEventListener('updatefound', () => {
                const worker = registration.installing;
                if (!worker) return;

                worker.addEventListener('statechange', () => {
                    if (!disposed && worker.state === 'installed' && navigator.serviceWorker.controller) {
                        markUpdateAvailable();
                    }
                });
            });

            // Periodically check for service worker updates every 30 seconds
            updateIntervalId = window.setInterval(() => checkSWUpdate(registration), VERSION_CHECK_INTERVAL_MS);

            // Also check on window focus
            const handleFocusUpdate = () => checkSWUpdate(registration);
            window.addEventListener('focus', handleFocusUpdate);

            // And on visibility changes
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
            .register('/sw.js')
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
    }, [markUpdateAvailable]);

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

    return {
        updateAvailable: state.available,
        updating: state.updating,
        version: state.version,
        buildTime: state.buildTime,
        currentVersion: CURRENT_APP_VERSION,
        currentBuildTime: CURRENT_APP_BUILD_TIME,
        applyUpdate,
        skipUpdate,
    };
}
