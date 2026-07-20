import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
export function useGeofence(
    tenantId: string,
    locationId?: string,
    tenantData?: { name?: string; latitude?: number; longitude?: number; geofence_radius?: number; address?: string },
    locationsData?: any[]
): UseGeofenceReturn {
    const { t } = useTranslation('patient');
    const [result, setResult] = useState<GeofenceResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const check = useCallback(async () => {
        if (!tenantId) {
            setError(t('preCheckin.errors.tenantIdMissing'));
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const geofenceResult = await GeolocationService.checkGeofence(tenantId, locationId, tenantData, locationsData);
            setResult(geofenceResult);
        } catch (e) {
            const message = e instanceof Error
                ? e.message
                : t('preCheckin.errors.checkFailed');
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [tenantId, locationId, tenantData, locationsData, t]);

    return { result, loading, error, check };
}
