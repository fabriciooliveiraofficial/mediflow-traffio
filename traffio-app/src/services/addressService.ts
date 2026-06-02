/**
 * Smart Address Service
 * 100% Free — No API keys, no billing, no limits (fair use).
 *
 * Stack:
 *  - Photon (photon.komoot.io)  → Search-as-you-type autocomplete + reverse geocoding
 *  - BrasilAPI (brasilapi.com.br) → CEP lookup (Brazilian postal code → full address)
 *  - Browser Geolocation API     → Native GPS for location bias + "Use my location"
 */

export interface AddressSuggestion {
    label: string;
    street?: string;
    number?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
    latitude: number;
    longitude: number;
    source: 'photon' | 'brasilapi' | 'geolocation';
}

interface PhotonFeature {
    geometry: { coordinates: [number, number] };
    properties: {
        name?: string;
        street?: string;
        housenumber?: string;
        district?: string;
        city?: string;
        state?: string;
        country?: string;
        postcode?: string;
        osm_value?: string;
        type?: string;
    };
}

interface BrasilApiCep {
    cep: string;
    state: string;
    city: string;
    neighborhood: string;
    street: string;
    location?: {
        type?: string;
        coordinates?: { longitude?: string; latitude?: string };
    };
}

const PHOTON_BASE = 'https://photon.komoot.io';
const BRASILAPI_BASE = 'https://brasilapi.com.br/api';
const DEBOUNCE_MIN_CHARS = 3;

function buildPhotonLabel(props: PhotonFeature['properties']): string {
    const parts: string[] = [];
    if (props.street) {
        parts.push(props.housenumber ? `${props.street}, ${props.housenumber}` : props.street);
    } else if (props.name) {
        parts.push(props.name);
    }
    if (props.district) parts.push(props.district);
    if (props.city) parts.push(props.city);
    if (props.state) parts.push(props.state);
    if (props.postcode) parts.push(props.postcode);
    return parts.join(' — ') || 'Endereço desconhecido';
}

export const addressService = {
    /**
     * Autocomplete via Photon (OpenStreetMap).
     * Biases results by user's lat/lon if provided.
     */
    async autocomplete(
        query: string,
        options?: { lat?: number; lon?: number; limit?: number }
    ): Promise<AddressSuggestion[]> {
        if (!query || query.length < DEBOUNCE_MIN_CHARS) return [];

        const params = new URLSearchParams({
            q: query,
            limit: String(options?.limit || 5),
            lang: 'default',
        });

        // Bias towards Brazil
        params.set('osm_tag', 'place');
        // If we have coords, bias results near them
        if (options?.lat && options?.lon) {
            params.set('lat', String(options.lat));
            params.set('lon', String(options.lon));
        }

        try {
            const res = await fetch(`${PHOTON_BASE}/api?${params}`);
            if (!res.ok) throw new Error('Photon API error');
            const data = await res.json();

            return (data.features || []).map((f: PhotonFeature) => ({
                label: buildPhotonLabel(f.properties),
                street: f.properties.street || f.properties.name,
                number: f.properties.housenumber,
                neighborhood: f.properties.district,
                city: f.properties.city,
                state: f.properties.state,
                country: f.properties.country,
                postcode: f.properties.postcode,
                latitude: f.geometry.coordinates[1],
                longitude: f.geometry.coordinates[0],
                source: 'photon' as const,
            }));
        } catch (err) {
            console.warn('[addressService] Photon autocomplete failed:', err);
            return [];
        }
    },

    /**
     * Reverse geocoding via Photon.
     * Converts lat/lon to a human-readable address.
     */
    async reverseGeocode(lat: number, lon: number): Promise<AddressSuggestion | null> {
        try {
            const res = await fetch(
                `${PHOTON_BASE}/reverse?lat=${lat}&lon=${lon}&limit=1`
            );
            if (!res.ok) throw new Error('Photon reverse failed');
            const data = await res.json();
            const f: PhotonFeature | undefined = data.features?.[0];
            if (!f) return null;

            return {
                label: buildPhotonLabel(f.properties),
                street: f.properties.street || f.properties.name,
                number: f.properties.housenumber,
                neighborhood: f.properties.district,
                city: f.properties.city,
                state: f.properties.state,
                country: f.properties.country,
                postcode: f.properties.postcode,
                latitude: f.geometry.coordinates[1],
                longitude: f.geometry.coordinates[0],
                source: 'geolocation',
            };
        } catch (err) {
            console.warn('[addressService] Reverse geocoding failed:', err);
            return null;
        }
    },

    /**
     * CEP lookup via BrasilAPI (free, no key).
     * Returns structured address data for a Brazilian postal code.
     */
    async lookupCep(cep: string): Promise<AddressSuggestion | null> {
        const cleanCep = cep.replace(/\D/g, '');
        if (cleanCep.length !== 8) return null;

        try {
            const res = await fetch(`${BRASILAPI_BASE}/cep/v2/${cleanCep}`);
            if (!res.ok) return null;
            const data: BrasilApiCep = await res.json();

            const lat = data.location?.coordinates?.latitude
                ? parseFloat(data.location.coordinates.latitude)
                : 0;
            const lon = data.location?.coordinates?.longitude
                ? parseFloat(data.location.coordinates.longitude)
                : 0;

            const label = [
                data.street,
                data.neighborhood,
                data.city,
                data.state,
                data.cep,
            ].filter(Boolean).join(' — ');

            return {
                label,
                street: data.street,
                neighborhood: data.neighborhood,
                city: data.city,
                state: data.state,
                country: 'Brasil',
                postcode: data.cep,
                latitude: lat,
                longitude: lon,
                source: 'brasilapi',
            };
        } catch (err) {
            console.warn('[addressService] CEP lookup failed:', err);
            return null;
        }
    },

    /**
     * Get current position from browser, then reverse geocode.
     * Returns the user's current address or null.
     */
    async getCurrentAddress(): Promise<AddressSuggestion | null> {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                resolve(null);
                return;
            }

            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const { latitude, longitude } = position.coords;
                    const address = await this.reverseGeocode(latitude, longitude);
                    resolve(address);
                },
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
            );
        });
    },
};
