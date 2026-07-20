export const MAX_SOURCE_CHARS = 12_000;
export const MAX_RESPONSE_BYTES = 300 * 1024;

export type FactCatalogItem = {
    key: string;
    type: "boolean" | "short_text" | "long_text" | "enum";
    options?: Array<{ value: string }>;
};

export type ExtractedSuggestion = {
    destination: "clinic_info" | "knowledge_base";
    fact_key?: string | null;
    title?: string | null;
    suggested_value: string;
    source_excerpt?: string | null;
    clarity?: "high" | "medium" | "low";
    /** Onda 4 (blindagem): defesa em profundidade contra poisoning na ingestão — nunca bloqueia, só destaca para o revisor humano. */
    flagged_suspicious?: boolean;
};

// Onda 4 — padrão de instrução embutida ("ignore as regras", "system:", "você agora
// é...") dentro de um FATO sugerido é sinal de tentativa de poisoning na base de
// conhecimento; a revisão humana já é obrigatória (nunca escrevemos direto), isto
// só dá mais destaque ao revisor — nunca rejeita automaticamente uma sugestão
// legítima que por acaso contenha essas palavras em contexto clínico normal.
const INJECTION_ATTEMPT_PATTERN = /\b(?:ignore|desconsidere|disregard)\b[^.]{0,30}\b(?:regras|instru[cç][oõ]es|instructions|rules)\b|\bsystem\s*:|\bprompt (?:do )?sistema\b|\byou are now\b|\bact as\s+(?:an?\s+)?assistant\b/i;

/** Onda 4: marca (nunca bloqueia) sugestões com padrão de instrução embutida. */
export function looksLikeInjectionAttempt(text: string): boolean {
    return INJECTION_ATTEMPT_PATTERN.test(text || "");
}

export function stripHtmlToText(html: string): string {
    return html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;|&#34;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}

export function truncateSource(text: string, limit = MAX_SOURCE_CHARS): string {
    return text.trim().slice(0, limit);
}

export function isSafePublicUrl(value: string): boolean {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (hostname === "localhost" || hostname.endsWith(".local")) return false;
        if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(hostname)) return false;
        const match = hostname.match(/^172\.(\d+)\./);
        if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return false;
        if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:")) return false;
        return true;
    } catch {
        return false;
    }
}

export function validateExtractedSuggestions(
    input: unknown,
    catalog: readonly FactCatalogItem[],
): ExtractedSuggestion[] {
    if (!Array.isArray(input)) return [];
    const catalogByKey = new Map(catalog.map((fact) => [fact.key, fact]));

    return input.flatMap((candidate): ExtractedSuggestion[] => {
        if (!candidate || typeof candidate !== "object") return [];
        const item = candidate as Record<string, unknown>;
        const value = typeof item.suggested_value === "string" ? item.suggested_value.trim() : "";
        if (!value || value.length > 2_000) return [];
        const excerpt = typeof item.source_excerpt === "string"
            ? item.source_excerpt.trim().slice(0, 500) || null
            : null;
        const clarity = item.clarity === "high" || item.clarity === "low" ? item.clarity : "medium";

        if (item.destination === "clinic_info" && typeof item.fact_key === "string") {
            const fact = catalogByKey.get(item.fact_key);
            if (!fact) return [];
            const valueLimit = fact.type === "long_text" ? 1_200
                : fact.type === "short_text" ? 240
                : fact.type === "enum" ? 64
                : 5;
            if (value.length > valueLimit) return [];
            if ((fact.type === "enum" || fact.type === "boolean")
                && !fact.options?.some((option) => option.value === value)) return [];
            return [{
                destination: "clinic_info",
                fact_key: fact.key,
                title: null,
                suggested_value: value,
                source_excerpt: excerpt,
                clarity,
            }];
        }

        if (item.destination === "knowledge_base" && typeof item.title === "string") {
            const title = item.title.trim();
            if (!title || title.length > 200) return [];
            return [{
                destination: "knowledge_base",
                fact_key: null,
                title,
                suggested_value: value,
                source_excerpt: excerpt,
                clarity,
            }];
        }

        return [];
    });
}
