/**
 * Timezone utilities for multi-international support.
 * All time-sensitive features (scheduling, reminders, WhatsApp, Messenger, Instagram DMs,
 * cron jobs) should read the tenant timezone from this module instead of using the
 * browser's local timezone or hardcoded offsets.
 */

export interface TimezoneOption {
    value: string;   // IANA identifier
    label: string;   // Human-readable label (PT-BR)
    region: string;  // Group label
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
    // Brasil
    { value: 'America/Sao_Paulo',               label: 'Brasília, São Paulo, Rio de Janeiro (BRT, UTC-3)',   region: 'Brasil' },
    { value: 'America/Fortaleza',               label: 'Fortaleza, Recife, Natal (BRT, UTC-3)',              region: 'Brasil' },
    { value: 'America/Belem',                   label: 'Belém, Macapá (BRT, UTC-3)',                         region: 'Brasil' },
    { value: 'America/Manaus',                  label: 'Manaus, Cuiabá, Campo Grande (AMT, UTC-4)',          region: 'Brasil' },
    { value: 'America/Porto_Velho',             label: 'Porto Velho (AMT, UTC-4)',                           region: 'Brasil' },
    { value: 'America/Boa_Vista',               label: 'Boa Vista (AMT, UTC-4)',                             region: 'Brasil' },
    { value: 'America/Rio_Branco',              label: 'Rio Branco (ACT, UTC-5)',                            region: 'Brasil' },
    { value: 'America/Noronha',                 label: 'Fernando de Noronha (FNT, UTC-2)',                   region: 'Brasil' },
    // América do Sul
    { value: 'America/Argentina/Buenos_Aires',  label: 'Buenos Aires (ART, UTC-3)',                          region: 'América do Sul' },
    { value: 'America/Santiago',                label: 'Santiago (CLT, UTC-3 / UTC-4)',                      region: 'América do Sul' },
    { value: 'America/Lima',                    label: 'Lima (PET, UTC-5)',                                  region: 'América do Sul' },
    { value: 'America/Bogota',                  label: 'Bogotá (COT, UTC-5)',                                region: 'América do Sul' },
    { value: 'America/Caracas',                 label: 'Caracas (VET, UTC-4)',                               region: 'América do Sul' },
    { value: 'America/La_Paz',                  label: 'La Paz (BOT, UTC-4)',                                region: 'América do Sul' },
    { value: 'America/Asuncion',                label: 'Assunção (PYT, UTC-3 / UTC-4)',                      region: 'América do Sul' },
    { value: 'America/Montevideo',              label: 'Montevidéu (UYT, UTC-3)',                            region: 'América do Sul' },
    { value: 'America/Guayaquil',               label: 'Quito (ECT, UTC-5)',                                 region: 'América do Sul' },
    // América do Norte
    { value: 'America/New_York',                label: 'Nova York, Miami (EST/EDT, UTC-5/-4)',                region: 'América do Norte' },
    { value: 'America/Chicago',                 label: 'Chicago, Dallas (CST/CDT, UTC-6/-5)',                region: 'América do Norte' },
    { value: 'America/Denver',                  label: 'Denver (MST/MDT, UTC-7/-6)',                         region: 'América do Norte' },
    { value: 'America/Los_Angeles',             label: 'Los Angeles, São Francisco (PST/PDT, UTC-8/-7)',     region: 'América do Norte' },
    { value: 'America/Anchorage',               label: 'Anchorage (AKST/AKDT, UTC-9/-8)',                   region: 'América do Norte' },
    { value: 'Pacific/Honolulu',                label: 'Havaí (HST, UTC-10)',                                region: 'América do Norte' },
    { value: 'America/Toronto',                 label: 'Toronto (EST/EDT, UTC-5/-4)',                        region: 'América do Norte' },
    { value: 'America/Vancouver',               label: 'Vancouver (PST/PDT, UTC-8/-7)',                      region: 'América do Norte' },
    { value: 'America/Mexico_City',             label: 'Cidade do México (CST/CDT, UTC-6/-5)',               region: 'América do Norte' },
    // Europa
    { value: 'Europe/London',                   label: 'Londres (GMT/BST, UTC+0/+1)',                        region: 'Europa' },
    { value: 'Europe/Lisbon',                   label: 'Lisboa (WET/WEST, UTC+0/+1)',                        region: 'Europa' },
    { value: 'Europe/Madrid',                   label: 'Madri (CET/CEST, UTC+1/+2)',                         region: 'Europa' },
    { value: 'Europe/Paris',                    label: 'Paris (CET/CEST, UTC+1/+2)',                         region: 'Europa' },
    { value: 'Europe/Berlin',                   label: 'Berlim (CET/CEST, UTC+1/+2)',                        region: 'Europa' },
    { value: 'Europe/Rome',                     label: 'Roma (CET/CEST, UTC+1/+2)',                          region: 'Europa' },
    { value: 'Europe/Amsterdam',                label: 'Amsterdam (CET/CEST, UTC+1/+2)',                     region: 'Europa' },
    { value: 'Europe/Brussels',                 label: 'Bruxelas (CET/CEST, UTC+1/+2)',                      region: 'Europa' },
    { value: 'Europe/Zurich',                   label: 'Zurique (CET/CEST, UTC+1/+2)',                       region: 'Europa' },
    { value: 'Europe/Warsaw',                   label: 'Varsóvia (CET/CEST, UTC+1/+2)',                      region: 'Europa' },
    { value: 'Europe/Vienna',                   label: 'Viena (CET/CEST, UTC+1/+2)',                         region: 'Europa' },
    { value: 'Europe/Stockholm',                label: 'Estocolmo (CET/CEST, UTC+1/+2)',                     region: 'Europa' },
    { value: 'Europe/Helsinki',                 label: 'Helsinque (EET/EEST, UTC+2/+3)',                     region: 'Europa' },
    { value: 'Europe/Athens',                   label: 'Atenas (EET/EEST, UTC+2/+3)',                        region: 'Europa' },
    { value: 'Europe/Bucharest',                label: 'Bucareste (EET/EEST, UTC+2/+3)',                     region: 'Europa' },
    { value: 'Europe/Istanbul',                 label: 'Istambul (TRT, UTC+3)',                               region: 'Europa' },
    { value: 'Europe/Moscow',                   label: 'Moscou (MSK, UTC+3)',                                region: 'Europa' },
    // África
    { value: 'Africa/Johannesburg',             label: 'Joanesburgo (SAST, UTC+2)',                          region: 'África' },
    { value: 'Africa/Cairo',                    label: 'Cairo (EET, UTC+2)',                                 region: 'África' },
    { value: 'Africa/Lagos',                    label: 'Lagos (WAT, UTC+1)',                                 region: 'África' },
    { value: 'Africa/Nairobi',                  label: 'Nairóbi (EAT, UTC+3)',                               region: 'África' },
    { value: 'Africa/Casablanca',               label: 'Casablanca (WET/WEST, UTC+0/+1)',                    region: 'África' },
    // Oriente Médio
    { value: 'Asia/Riyadh',                     label: 'Riad (AST, UTC+3)',                                  region: 'Oriente Médio' },
    { value: 'Asia/Dubai',                      label: 'Dubai, Abu Dhabi (GST, UTC+4)',                      region: 'Oriente Médio' },
    { value: 'Asia/Tehran',                     label: 'Teerã (IRST, UTC+3:30)',                             region: 'Oriente Médio' },
    { value: 'Asia/Kabul',                      label: 'Cabul (AFT, UTC+4:30)',                              region: 'Oriente Médio' },
    // Ásia
    { value: 'Asia/Karachi',                    label: 'Carachi (PKT, UTC+5)',                               region: 'Ásia' },
    { value: 'Asia/Kolkata',                    label: 'Mumbai, Nova Delhi (IST, UTC+5:30)',                  region: 'Ásia' },
    { value: 'Asia/Kathmandu',                  label: 'Katmandu (NPT, UTC+5:45)',                           region: 'Ásia' },
    { value: 'Asia/Dhaka',                      label: 'Daca (BST, UTC+6)',                                  region: 'Ásia' },
    { value: 'Asia/Bangkok',                    label: 'Bangkok, Ho Chi Minh (ICT, UTC+7)',                  region: 'Ásia' },
    { value: 'Asia/Jakarta',                    label: 'Jacarta (WIB, UTC+7)',                               region: 'Ásia' },
    { value: 'Asia/Singapore',                  label: 'Singapura (SGT, UTC+8)',                             region: 'Ásia' },
    { value: 'Asia/Hong_Kong',                  label: 'Hong Kong (HKT, UTC+8)',                             region: 'Ásia' },
    { value: 'Asia/Shanghai',                   label: 'Pequim, Xangai (CST, UTC+8)',                        region: 'Ásia' },
    { value: 'Asia/Taipei',                     label: 'Taipei (CST, UTC+8)',                                region: 'Ásia' },
    { value: 'Asia/Tokyo',                      label: 'Tóquio (JST, UTC+9)',                                region: 'Ásia' },
    { value: 'Asia/Seoul',                      label: 'Seul (KST, UTC+9)',                                  region: 'Ásia' },
    // Oceania
    { value: 'Australia/Perth',                 label: 'Perth (AWST, UTC+8)',                                region: 'Oceania' },
    { value: 'Australia/Adelaide',              label: 'Adelaide (ACST, UTC+9:30/+10:30)',                   region: 'Oceania' },
    { value: 'Australia/Brisbane',              label: 'Brisbane (AEST, UTC+10)',                            region: 'Oceania' },
    { value: 'Australia/Sydney',                label: 'Sydney, Melbourne (AEST/AEDT, UTC+10/+11)',          region: 'Oceania' },
    { value: 'Pacific/Auckland',                label: 'Auckland (NZST/NZDT, UTC+12/+13)',                   region: 'Oceania' },
    { value: 'Pacific/Fiji',                    label: 'Fiji (FJT, UTC+12)',                                 region: 'Oceania' },
    // Universal
    { value: 'UTC',                             label: 'UTC — Tempo Universal Coordenado (UTC+0)',           region: 'Universal' },
];

/** Returns unique region names in order of appearance. */
export const TIMEZONE_REGIONS = [...new Set(TIMEZONE_OPTIONS.map(t => t.region))];

/** Returns the local hour (0–23) for a given date in the specified IANA timezone. */
export function getLocalHour(date: Date, timezone: string): number {
    try {
        return parseInt(
            new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(date),
            10
        );
    } catch {
        return date.getUTCHours();
    }
}

/**
 * Formats a Date as a human-readable string in the given timezone.
 * Uses Intl.DateTimeFormat under the hood — no external library needed.
 * `locale` defaults to `'pt-BR'` for backward compatibility; pass the tenant's
 * locale (see `useLocaleFormat`) for country-aware display.
 */
export function formatInTimezone(
    date: Date,
    timezone: string,
    options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
    locale: string = 'pt-BR'
): string {
    try {
        return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone }).format(date);
    } catch {
        return new Intl.DateTimeFormat(locale, options).format(date);
    }
}

/**
 * Returns the UTC offset string (e.g. "-03:00", "+05:30") for an IANA timezone
 * at the given reference date (accounts for DST).
 *
 * Used when building ISO timestamps like "2026-06-03T14:00:00-03:00".
 */
export function getUTCOffsetString(timezone: string, refDate: Date = new Date()): string {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'shortOffset',
        }).formatToParts(refDate);

        const tzName = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+0';
        // tzName is like "GMT-3", "GMT+5:30", "GMT+0"
        const match = tzName.match(/GMT([+-]\d+(?::\d+)?)?/);
        if (!match || !match[1]) return '+00:00';

        const raw = match[1]; // e.g. "-3", "+5:30"
        const [hourPart, minPart = '00'] = raw.split(':');
        const sign = hourPart[0];
        const absHours = Math.abs(parseInt(hourPart, 10));
        return `${sign}${String(absHours).padStart(2, '0')}:${minPart.padStart(2, '0')}`;
    } catch {
        return '-03:00';
    }
}

/**
 * Builds a UTC Date from a local date string (YYYY-MM-DD) + time string (HH:MM)
 * interpreted in the given IANA timezone.
 *
 * Replaces the pattern: new Date(date + 'T' + time + '-03:00')
 */
export function localDateTimeToUTC(dateStr: string, timeStr: string, timezone: string): Date {
    const offset = getUTCOffsetString(timezone, new Date(`${dateStr}T${timeStr}:00Z`));
    return new Date(`${dateStr}T${timeStr}:00${offset}`);
}
