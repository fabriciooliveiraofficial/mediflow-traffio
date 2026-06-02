/**
 * BUG FIX #5: Conversão de datas relativas para YYYY-MM-DD.
 *
 * O problema: o businessOrchestrator oferece botões 'date_today' e 'date_tomorrow'
 * que mapeiam para as strings 'hoje' e 'amanhã'. Essas strings são armazenadas em
 * entities.date e passadas diretamente para o RPC book_appointment como p_date (tipo date).
 * O PostgreSQL falha no cast de 'amanhã' → date, quebrando silenciosamente todos os
 * agendamentos feitos via botão de data rápida.
 */

/**
 * Resolve datas relativas em português e formatos comuns para YYYY-MM-DD.
 * Aceita: 'hoje', 'amanhã', 'amanha', 'depois de amanhã', '12/08', '12/08/2026', '2026-08-12'.
 * Retorna null se a string não for reconhecida como data válida.
 */
/** Returns today's calendar date in Brazil timezone (America/Sao_Paulo) as a local Date at midnight. */
function getBrazilToday(): Date {
    const now = new Date();
    // Format as YYYY-MM-DD in Brazil timezone
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now).split('-').map(Number);
    // Construct using numeric parts to stay in "local" space (UTC in Edge Function)
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function resolveDate(raw: string | null | undefined): string | null {
    if (!raw) return null;

    const normalized = raw.trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // remove acentos

    const today = getBrazilToday();

    // --- Datas relativas em português ---
    if (normalized === 'hoje') {
        return formatDate(today);
    }
    if (normalized === 'amanha' || normalized === 'amanhã'.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) {
        const d = new Date(today);
        d.setDate(d.getDate() + 1);
        return formatDate(d);
    }
    if (normalized === 'depois de amanha' || normalized === 'depois amanha') {
        const d = new Date(today);
        d.setDate(d.getDate() + 2);
        return formatDate(d);
    }

    // --- Formato DD/MM ou DD/MM/YYYY ---
    const dmMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (dmMatch) {
        const day = parseInt(dmMatch[1], 10);
        const month = parseInt(dmMatch[2], 10) - 1; // 0-indexed
        let year = dmMatch[3] ? parseInt(dmMatch[3], 10) : today.getFullYear();
        if (year < 100) year += 2000; // normaliza 2 dígitos
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return formatDate(d);
    }

    // --- Formato YYYY-MM-DD (já correto) ---
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        const d = new Date(normalized);
        if (!isNaN(d.getTime())) return normalized;
    }

    // --- Dias da semana (próximo) ---
    const weekdays: Record<string, number> = {
        'domingo': 0, 'segunda': 1, 'segunda-feira': 1,
        'terca': 2, 'terca-feira': 2,
        'quarta': 3, 'quarta-feira': 3,
        'quinta': 4, 'quinta-feira': 4,
        'sexta': 5, 'sexta-feira': 5,
        'sabado': 6, 'sabado-feira': 6
    };
    if (weekdays[normalized] !== undefined) {
        const target = weekdays[normalized];
        const d = new Date(today);
        const current = d.getDay();
        let diff = target - current;
        if (diff <= 0) diff += 7; // sempre próxima ocorrência
        d.setDate(d.getDate() + diff);
        return formatDate(d);
    }

    // --- Month names in Portuguese (scan full input for any month word) ---
    const months: Record<string, number> = {
        'janeiro': 0, 'fevereiro': 1, 'marco': 2, 'abril': 3,
        'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7,
        'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11
    };

    // Regex scan: find any month name anywhere in the phrase
    // e.g. "preciso para maio", "quero em junho", "agendamento em maio de 2026"
    const monthRegex = new RegExp(`\\b(${Object.keys(months).join('|')})\\b`);
    const monthMatch = normalized.match(monthRegex);
    if (monthMatch) {
        const targetMonth = months[monthMatch[1]];
        let year = today.getFullYear();

        // Check for an explicit 4-digit year in the string (e.g. "maio de 2027")
        const yearMatch = normalized.match(/\b(202\d|203\d)\b/);
        if (yearMatch) {
            year = parseInt(yearMatch[1], 10);
        } else {
            // If the entire target month is already past this year, jump to next year
            const lastDayOfTarget = new Date(year, targetMonth + 1, 0);
            if (lastDayOfTarget < today) {
                year += 1;
            }
        }

        // If it's the current month, return today instead of the 1st
        if (targetMonth === today.getMonth() && year === today.getFullYear()) {
            return formatDate(today);
        }
        return formatDate(new Date(year, targetMonth, 1));
    }

    return null;
}

function formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
