import type { Locale } from 'date-fns';
import { ptBR, enUS, es } from 'date-fns/locale';

/** Idioma da UI (i18next) -> objeto de locale do date-fns (nomes de mês/dia por extenso). */
const DATE_FNS_LOCALE_BY_LANGUAGE: Record<string, Locale> = {
    'pt-BR': ptBR,
    en: enUS,
    es,
};

export function getDateFnsLocale(language: string): Locale {
    return DATE_FNS_LOCALE_BY_LANGUAGE[language] ?? ptBR;
}
