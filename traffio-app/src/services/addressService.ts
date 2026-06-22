/**
 * Smart Address Service
 * 100% Free — No API keys, no billing, no limits (fair use).
 *
 * Stack:
 *  - Photon (photon.komoot.io)    → Search-as-you-type autocomplete + reverse geocoding (global)
 *  - BrasilAPI (brasilapi.com.br) → CEP lookup (Brazilian postal code → full address)
 *  - Zippopotam.us                → ZIP/Postcode lookup for US/NZ/MX (free, no key)
 *  - Browser Geolocation API      → Native GPS for location bias + "Use my location"
 */
import { type CountryCode, getCountry } from '../lib/i18n/countryFormats';

export interface AddressSuggestion {
    label: string;
    street?: string;
    number?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    country?: string;
    countryCode?: string;
    postcode?: string;
    latitude: number;
    longitude: number;
    source: 'photon' | 'brasilapi' | 'zippopotam' | 'geolocation';
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
        countrycode?: string;
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

interface ZippopotamResponse {
    'post code': string;
    country: string;
    'country abbreviation': string;
    places: Array<{
        'place name': string;
        longitude: string;
        state: string;
        'state abbreviation': string;
        latitude: string;
    }>;
}

const PHOTON_BASE = 'https://photon.komoot.io';
const BRASILAPI_BASE = 'https://brasilapi.com.br/api';
const ZIPPOPOTAM_BASE = 'https://api.zippopotam.us';
const DEBOUNCE_MIN_CHARS = 3;

// Rough bounding boxes [minLon, minLat, maxLon, maxLat] used to bias Photon's
// global autocomplete towards the selected country (Photon has no ISO country filter).
const COUNTRY_BBOX: Record<CountryCode, [number, number, number, number]> = {
    BR: [-73.99, -33.75, -28.84, 5.27],
    US: [-124.85, 24.40, -66.88, 49.38],
    NZ: [165.87, -47.35, 178.6, -34.36],
    MX: [-118.45, 14.39, -86.49, 32.72],
};

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
        options?: { lat?: number; lon?: number; limit?: number; country?: CountryCode }
    ): Promise<AddressSuggestion[]> {
        if (!query || query.length < DEBOUNCE_MIN_CHARS) return [];

        const params = new URLSearchParams({
            q: query,
            limit: String(options?.limit || 5),
            lang: 'default',
        });

        params.set('osm_tag', 'place');
        // Bias towards the selected country's bounding box (Photon has no ISO country filter)
        if (options?.country) {
            const bbox = COUNTRY_BBOX[options.country];
            if (bbox) params.set('bbox', bbox.join(','));
        }
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
                countryCode: f.properties.countrycode?.toUpperCase() || options?.country,
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
                countryCode: f.properties.countrycode?.toUpperCase(),
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
                countryCode: 'BR',
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
     * ZIP/Postcode lookup via Zippopotam.us (free, no key).
     * Covers US/NZ/MX (and ~60 other countries) — used as the registry's
     * lookupProvider for any country whose postal.lookupProvider is 'zippopotam'.
     */
    async lookupZip(zip: string, country: CountryCode): Promise<AddressSuggestion | null> {
        const cleanZip = zip.trim().replace(/\s+/g, '');
        if (!cleanZip) return null;

        try {
            const res = await fetch(`${ZIPPOPOTAM_BASE}/${country.toLowerCase()}/${encodeURIComponent(cleanZip)}`);
            if (res.ok) {
                const data: ZippopotamResponse = await res.json();
                const place = data.places?.[0];
                if (place) {
                    const state = place['state abbreviation'] || place.state;
                    const label = [place['place name'], state, data['post code']].filter(Boolean).join(' — ');

                    return {
                        label,
                        city: place['place name'],
                        state,
                        country: data.country,
                        countryCode: data['country abbreviation'],
                        postcode: data['post code'],
                        latitude: parseFloat(place.latitude) || 0,
                        longitude: parseFloat(place.longitude) || 0,
                        source: 'zippopotam',
                    };
                }
            }
        } catch (err) {
            console.warn('[addressService] Zippopotam lookup failed, trying fallback:', err);
        }

        // Fallback to Photon API
        try {
            const params = new URLSearchParams({
                q: `${cleanZip} ${country}`,
                limit: '1',
            });
            const bbox = COUNTRY_BBOX[country];
            if (bbox) params.set('bbox', bbox.join(','));

            const photonRes = await fetch(`${PHOTON_BASE}/api?${params}`);
            if (photonRes.ok) {
                const photonData = await photonRes.json();
                const f: PhotonFeature | undefined = photonData.features?.[0];
                if (f) {
                    const city = f.properties.city || f.properties.district || f.properties.name || '';
                    const state = f.properties.state || '';
                    const label = [city, state, cleanZip].filter(Boolean).join(' — ');
                    return {
                        label,
                        city,
                        state,
                        country: f.properties.country || '',
                        countryCode: country,
                        postcode: cleanZip,
                        latitude: f.geometry.coordinates[1],
                        longitude: f.geometry.coordinates[0],
                        source: 'photon',
                    };
                }
            }
        } catch (err) {
            console.warn('[addressService] Photon fallback lookup failed:', err);
        }

        return null;
    },

    /**
     * Country-aware postal lookup — routes to the provider declared in the
     * country registry (countryFormats.ts): BrasilAPI for BR, Zippopotam.us
     * for everyone else. This is the entry point IntlPostalInput should call.
     */
    async lookupPostal(value: string, country: CountryCode): Promise<AddressSuggestion | null> {
        const provider = getCountry(country).postal.lookupProvider;
        return provider === 'brasilapi' ? this.lookupCep(value) : this.lookupZip(value, country);
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
