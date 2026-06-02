import { supabase } from '../lib/supabase';

export interface GeoCoordinates {
    latitude: number;
    longitude: number;
    accuracy: number;
    source: 'gps';
}

export interface LocationInfo {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
}

export interface GeofenceResult {
    allowed: boolean;
    distance: number;
    radiusUsed: number;
    coordinates: GeoCoordinates | null;
    clinicName?: string;
    matchedLocation?: LocationInfo;
}

const DEFAULT_RADIUS = 100; // 100 meters

/**
 * Geolocation service using Browser GPS exclusively.
 * High precision (~10m), no external APIs, no cost.
 */
export const GeolocationService = {
    /**
     * Browser Geolocation API (GPS/WiFi — ~10m precision)
     * Free, unlimited, no signup. Requires user permission.
     */
    getBrowserLocation(): Promise<GeoCoordinates> {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Seu navegador não suporta geolocalização.'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        source: 'gps',
                    });
                },
                (error) => {
                    const messages: Record<number, string> = {
                        1: 'Permissão de localização negada. Ative nas configurações do navegador.',
                        2: 'Não foi possível obter sua localização. Tente em área aberta.',
                        3: 'Tempo esgotado ao buscar localização. Tente novamente.',
                    };
                    reject(new Error(messages[error.code] || 'Erro ao obter localização.'));
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 30000,
                }
            );
        });
    },

    /**
     * Haversine formula — distance between two points on Earth (meters).
     */
    calculateDistance(
        lat1: number, lon1: number,
        lat2: number, lon2: number
    ): number {
        const R = 6371000;
        const toRad = (deg: number) => (deg * Math.PI) / 180;

        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;

        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    /**
     * Main geofence check.
     * Checks against ALL active locations + tenant main address.
     * Returns the NEAREST location result.
     */
    async checkGeofence(tenantId: string, expectedLocationId?: string): Promise<GeofenceResult> {
        // 1. Fetch Tenant Settings
        const { data: tenant } = await supabase
            .from('tenants')
            .select('name, latitude, longitude, geofence_radius, address')
            .eq('id', tenantId)
            .single();

        if (!tenant) throw new Error('Tenant not found');

        // 2. Fetch Active Locations with Coordinates
        const { data: locations } = await supabase
            .from('locations')
            .select('id, name, latitude, longitude')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .not('latitude', 'is', null)
            .not('longitude', 'is', null);

        // 3. Get User Location
        const coords = await this.getBrowserLocation();
        const radius = tenant.geofence_radius || DEFAULT_RADIUS;

        // 4. Build Candidates List (Locations + Main Address)
        const candidates: LocationInfo[] = [];

        // Add specific locations
        if (locations?.length) {
            candidates.push(...locations.map(l => ({
                id: l.id,
                name: l.name,
                latitude: l.latitude,
                longitude: l.longitude
            })));
        }

        // Add main tenant address (legacy fallback or HQ)
        if (tenant.latitude && tenant.longitude && !candidates.some(c => c.latitude === tenant.latitude && c.longitude === tenant.longitude)) {
            candidates.push({
                id: 'main',
                name: 'Unidade Principal', // Or tenant.name
                latitude: tenant.latitude,
                longitude: tenant.longitude
            });
        }

        if (candidates.length === 0) {
            // No geofence configured at all -> Allow by default (logic decision: if no geofence, no restriction?)
            // OR Deny? Usually if feature is on, default deny.
            // But let's assume allowed if no coordinates set to avoid blocking.
            return {
                allowed: true,
                distance: 0,
                radiusUsed: radius,
                coordinates: coords,
                clinicName: tenant.name,
            };
        }

        // 5. Calculate Distances and Find Nearest
        let minDistance = Infinity;
        let nearest: LocationInfo | undefined;

        for (const loc of candidates) {
            const d = this.calculateDistance(
                coords.latitude, coords.longitude,
                loc.latitude, loc.longitude
            );
            
            // If we have an expected location, prioritize it for the result name/info
            // even if it's not the absolute nearest, but we still calculate minimal distance
            // to check if they are "allowed" in ANY unit (or specifically the expected one)
            if (expectedLocationId && loc.id === expectedLocationId) {
                // We found the one we wanted!
                // If we want to be strict, we'd only allow this one.
                // For now, let's just make sure this is the one reported in the UI.
                nearest = loc;
                minDistance = d;
                break; // Exit loop early if we found the specific one we are looking for
            }

            if (d < minDistance) {
                minDistance = d;
                nearest = loc;
            }
        }

        return {
            allowed: minDistance <= radius,
            distance: Math.round(minDistance),
            radiusUsed: radius,
            coordinates: coords,
            clinicName: tenant.name,
            matchedLocation: nearest,
        };
    },
};
