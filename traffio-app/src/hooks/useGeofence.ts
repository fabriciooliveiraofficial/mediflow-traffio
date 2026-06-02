import { useState, useCallback } from 'react';
import { GeolocationService, type GeofenceResult } from '../services/geolocationService';

interface UseGeofenceReturn {
    result: GeofenceResult | null;
    loading: boolean;
    error: string | null;
    check: () => Promise<void>;
}

/**
 * Hook that checks if the patient is within the clinic's geofence.
 * Exposes { result, loading, error, check }.
 * Call `check()` to trigger the multi-layer location check.
 */
export function useGeofence(tenantId: string, locationId?: string): UseGeofenceReturn {
    const [result, setResult] = useState<GeofenceResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const check = useCallback(async () => {
        if (!tenantId) {
            setError('Tenant ID não encontrado.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const geofenceResult = await GeolocationService.checkGeofence(tenantId, locationId);
            setResult(geofenceResult);
        } catch (e) {
            const message = e instanceof Error
                ? e.message
                : 'Erro ao verificar localização.';
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    return { result, loading, error, check };
}
