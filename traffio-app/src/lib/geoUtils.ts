/**
 * Utility functions for geographic coordinates.
 * Converts between Decimal Degrees (DD) and Degrees, Minutes, Seconds (DMS).
 */

/**
 * Converts decimal degrees to DMS string format: e.g. 36°47'10.3"S or 174°46'18.9"E.
 * @param decimal The coordinate in decimal degrees.
 * @param isLatitude True if coordinate is latitude, false if longitude.
 */
export function decimalToDMS(decimal: number | null | undefined, isLatitude: boolean): string {
    if (decimal === null || decimal === undefined || isNaN(decimal)) return '';
    
    const direction = isLatitude 
        ? (decimal >= 0 ? 'N' : 'S') 
        : (decimal >= 0 ? 'E' : 'W');
        
    const absolute = Math.abs(decimal);
    const degrees = Math.floor(absolute);
    const minutesNotTruncated = (absolute - degrees) * 60;
    const minutes = Math.floor(minutesNotTruncated);
    const seconds = (minutesNotTruncated - minutes) * 60;
    
    // Round seconds to 1 decimal place (e.g. 10.3)
    const secondsFormatted = seconds.toFixed(1);
    
    return `${degrees}°${minutes}'${secondsFormatted}"${direction}`;
}

/**
 * Parses a coordinate string in either decimal format (e.g. -36.786187) or DMS format (e.g. 36°47'10.3"S)
 * into a decimal number. Returns null if invalid.
 * @param val The coordinate string to parse.
 */
export function parseDMSToDecimal(val: string | null | undefined): number | null {
    if (!val) return null;
    
    const cleanVal = val.trim();

    // 1. Check if it's already a simple decimal number (e.g., -36.7861874)
    if (/^[+-]?\d+(?:\.\d+)?$/.test(cleanVal)) {
        const dec = parseFloat(cleanVal);
        return isNaN(dec) ? null : dec;
    }

    // 2. Try parsing as DMS (Degrees, Minutes, Seconds)
    // Matches degrees, optional minutes, optional seconds, and direction (N, S, E, W)
    // Support symbols: degree symbol, prime/single-quote, double prime/double-quote, spaces
    const dmsRegex = /^\s*(\d+(?:\.\d+)?)\s*[°dD\s]?\s*(?:(\d+(?:\.\d+)?)\s*['m\u2032\s]?)?\s*(?:(\d+(?:\.\d+)?)\s*["s\u2033\u201d\u201c\s]?)?\s*([NSEWnsew])\s*$/;
    const match = cleanVal.match(dmsRegex);
    if (!match) return null;

    const degrees = parseFloat(match[1]) || 0;
    const minutes = parseFloat(match[2]) || 0;
    const seconds = parseFloat(match[3]) || 0;
    const direction = match[4].toUpperCase();

    let decimal = degrees + (minutes / 60) + (seconds / 3600);

    if (direction === 'S' || direction === 'W') {
        decimal = -decimal;
    }

    // Round to 7 decimal places to keep precision clean
    return parseFloat(decimal.toFixed(7));
}
