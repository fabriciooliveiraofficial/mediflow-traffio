/**
 * formatPhone.ts — International phone number formatter
 *
 * Detects country from numeric prefix and applies the correct national mask.
 * Input: raw digits, possibly with country code (e.g. "5541997759569", "14049257024")
 * Output: formatted string (e.g. "+55 (41) 99775-9569", "+1 (404) 925-7024")
 *
 * Storage format in DB is always raw digits with country code (no punctuation).
 * This function is display-only — never use for sending to APIs.
 */

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '—';

  // Strip everything except digits
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return raw;

  // ── Brazil (+55) ─────────────────────────────────────────────────────────
  // Format: +55 (DDD) 9XXXX-XXXX  or  +55 (DDD) XXXX-XXXX
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const area = digits.slice(2, 4);
    const num  = digits.slice(4);
    if (num.length === 9) {
      return `+55 (${area}) ${num.slice(0, 5)}-${num.slice(5)}`;
    }
    return `+55 (${area}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }

  // ── USA / Canada (+1) ────────────────────────────────────────────────────
  // Format: +1 (NXX) NXX-XXXX
  if (digits.startsWith('1') && digits.length === 11) {
    const area   = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line   = digits.slice(7);
    return `+1 (${area}) ${prefix}-${line}`;
  }

  // ── Argentina (+54) ──────────────────────────────────────────────────────
  // Format: +54 9 11 XXXX-XXXX  (mobile)  or  +54 11 XXXX-XXXX (landline)
  if (digits.startsWith('54') && digits.length >= 12) {
    const rest = digits.slice(2);
    if (rest.startsWith('9')) {
      const area = rest.slice(1, 3);
      const num  = rest.slice(3);
      return `+54 9 ${area} ${num.slice(0, 4)}-${num.slice(4)}`;
    }
    const area = rest.slice(0, 2);
    const num  = rest.slice(2);
    return `+54 ${area} ${num.slice(0, 4)}-${num.slice(4)}`;
  }

  // ── Portugal (+351) ──────────────────────────────────────────────────────
  // Format: +351 9XX XXX XXX
  if (digits.startsWith('351') && digits.length === 12) {
    const num = digits.slice(3);
    return `+351 ${num.slice(0, 3)} ${num.slice(3, 6)} ${num.slice(6)}`;
  }

  // ── UK (+44) ─────────────────────────────────────────────────────────────
  // Format: +44 7XXX XXXXXX
  if (digits.startsWith('44') && digits.length === 12) {
    const num = digits.slice(2);
    return `+44 ${num.slice(0, 4)} ${num.slice(4)}`;
  }

  // ── Spain (+34) ──────────────────────────────────────────────────────────
  // Format: +34 6XX XXX XXX
  if (digits.startsWith('34') && digits.length === 11) {
    const num = digits.slice(2);
    return `+34 ${num.slice(0, 3)} ${num.slice(3, 6)} ${num.slice(6)}`;
  }

  // ── France (+33) ─────────────────────────────────────────────────────────
  // Format: +33 6 XX XX XX XX
  if (digits.startsWith('33') && digits.length === 11) {
    const num = digits.slice(2);
    return `+33 ${num[0]} ${num.slice(1, 3)} ${num.slice(3, 5)} ${num.slice(5, 7)} ${num.slice(7)}`;
  }

  // ── Italy (+39) ──────────────────────────────────────────────────────────
  // Format: +39 3XX XXXXXXX
  if (digits.startsWith('39') && digits.length >= 11) {
    const num = digits.slice(2);
    return `+39 ${num.slice(0, 3)} ${num.slice(3)}`;
  }

  // ── Germany (+49) ────────────────────────────────────────────────────────
  // Format: +49 1XX XXXXXXXX
  if (digits.startsWith('49') && digits.length >= 11) {
    const num = digits.slice(2);
    return `+49 ${num.slice(0, 3)} ${num.slice(3)}`;
  }

  // ── Mexico (+52) ─────────────────────────────────────────────────────────
  // Format: +52 55 XXXX-XXXX
  if (digits.startsWith('52') && digits.length >= 12) {
    const num = digits.slice(2);
    return `+52 ${num.slice(0, 2)} ${num.slice(2, 6)}-${num.slice(6)}`;
  }

  // ── Colombia (+57) ───────────────────────────────────────────────────────
  // Format: +57 3XX XXX XXXX
  if (digits.startsWith('57') && digits.length === 12) {
    const num = digits.slice(2);
    return `+57 ${num.slice(0, 3)} ${num.slice(3, 6)} ${num.slice(6)}`;
  }

  // ── Chile (+56) ──────────────────────────────────────────────────────────
  // Format: +56 9 XXXX XXXX
  if (digits.startsWith('56') && digits.length >= 11) {
    const num = digits.slice(2);
    return `+56 ${num[0]} ${num.slice(1, 5)} ${num.slice(5)}`;
  }

  // ── Japan (+81) ──────────────────────────────────────────────────────────
  // Format: +81 90-XXXX-XXXX
  if (digits.startsWith('81') && digits.length >= 12) {
    const num = digits.slice(2);
    return `+81 ${num.slice(0, 2)}-${num.slice(2, 6)}-${num.slice(6)}`;
  }

  // ── Australia (+61) ──────────────────────────────────────────────────────
  // Format: +61 4XX XXX XXX
  if (digits.startsWith('61') && digits.length === 11) {
    const num = digits.slice(2);
    return `+61 ${num.slice(0, 3)} ${num.slice(3, 6)} ${num.slice(6)}`;
  }

  // ── Generic fallback — show +CC followed by number in groups ─────────────
  // Try known 3-digit prefixes first, then 2-digit
  const three = ['351','352','353','354','355','356','357','358','359',
                  '370','371','372','373','374','375','376','377','380',
                  '381','382','385','386','387','389','420','421','423'];
  for (const code of three) {
    if (digits.startsWith(code)) {
      const num = digits.slice(code.length);
      return `+${code} ${num}`;
    }
  }

  const two = ['20','27','30','31','32','36','40','41','43','45','46',
               '47','48','51','53','58','60','62','63','64','65','66',
               '82','84','86','90','91','92','93','94','95','98'];
  for (const code of two) {
    if (digits.startsWith(code)) {
      const num = digits.slice(code.length);
      return `+${code} ${num}`;
    }
  }

  // Last resort: just prefix with +
  return digits.length >= 10 ? `+${digits}` : raw;
}

/**
 * Returns just the country flag emoji for a phone number.
 * Useful to show alongside the formatted number.
 */
export function phoneFlag(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');

  if (digits.startsWith('55'))  return '🇧🇷';
  if (digits.startsWith('1'))   return '🇺🇸';
  if (digits.startsWith('54'))  return '🇦🇷';
  if (digits.startsWith('351')) return '🇵🇹';
  if (digits.startsWith('44'))  return '🇬🇧';
  if (digits.startsWith('34'))  return '🇪🇸';
  if (digits.startsWith('33'))  return '🇫🇷';
  if (digits.startsWith('39'))  return '🇮🇹';
  if (digits.startsWith('49'))  return '🇩🇪';
  if (digits.startsWith('52'))  return '🇲🇽';
  if (digits.startsWith('57'))  return '🇨🇴';
  if (digits.startsWith('56'))  return '🇨🇱';
  if (digits.startsWith('81'))  return '🇯🇵';
  if (digits.startsWith('61'))  return '🇦🇺';
  if (digits.startsWith('86'))  return '🇨🇳';
  if (digits.startsWith('91'))  return '🇮🇳';
  if (digits.startsWith('27'))  return '🇿🇦';
  if (digits.startsWith('47'))  return '🇳🇴';
  if (digits.startsWith('46'))  return '🇸🇪';
  if (digits.startsWith('45'))  return '🇩🇰';
  if (digits.startsWith('41'))  return '🇨🇭';
  if (digits.startsWith('31'))  return '🇳🇱';
  if (digits.startsWith('32'))  return '🇧🇪';
  if (digits.startsWith('48'))  return '🇵🇱';
  if (digits.startsWith('90'))  return '🇹🇷';
  if (digits.startsWith('82'))  return '🇰🇷';
  if (digits.startsWith('66'))  return '🇹🇭';
  if (digits.startsWith('60'))  return '🇲🇾';
  if (digits.startsWith('65'))  return '🇸🇬';
  if (digits.startsWith('64'))  return '🇳🇿';
  if (digits.startsWith('58'))  return '🇻🇪';
  if (digits.startsWith('51'))  return '🇵🇪';
  return '🌍';
}
