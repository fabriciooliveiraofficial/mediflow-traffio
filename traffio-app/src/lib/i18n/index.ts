/**
 * i18n/index.ts — UI translation engine (Pilar 2: idioma, não formatação de dados).
 *
 * Lazy-loads JSON catalogs per language+namespace via Vite's import.meta.glob,
 * so adding/translating a namespace never bloats the main bundle. No HTTP
 * backend needed — catalogs ship inside the app build.
 *
 * Language resolution order on boot: localStorage (explicit user choice) ->
 * browser navigator language -> DEFAULT_LANGUAGE. Once tenant/patient data
 * loads (async, from Supabase), `useApplyDefaultLanguageFromCountry` in
 * src/hooks/useLang.ts may override this — but only if the user never chose
 * a language explicitly.
 */
import i18next, { type BackendModule } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = ['pt-BR', 'en', 'es'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: AppLanguage = 'pt-BR';

export const NAMESPACES = [
    'common',
    'auth',
    'settings',
    'agenda',
    'patient',
    'portal',
    'crm',
    'medical',
    'billing',
    'communications',
    'automations',
    'master',
] as const;

export const LANGUAGE_STORAGE_KEY = 'traffio_language';

// Vite-resolved map of every catalog file, lazily imported on demand.
const catalogModules = import.meta.glob('../../locales/*/*.json');

const lazyJsonBackend: BackendModule = {
    type: 'backend',
    init() {
        /* no-op — nothing to configure */
    },
    read(language, namespace, callback) {
        const key = `../../locales/${language}/${namespace}.json`;
        const loader = catalogModules[key];
        if (!loader) {
            // Missing catalog file for this language/namespace — treat as empty,
            // react-i18next falls back to fallbackLng for any missing key.
            callback(null, {});
            return;
        }
        loader()
            .then((mod) => callback(null, (mod as { default?: object }).default ?? (mod as object)))
            .catch((err: unknown) => callback(err instanceof Error ? err : String(err), undefined));
    },
};

i18next
    .use(lazyJsonBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        fallbackLng: DEFAULT_LANGUAGE,
        supportedLngs: SUPPORTED_LANGUAGES,
        ns: NAMESPACES,
        defaultNS: 'common',
        interpolation: { escapeValue: false }, // React already escapes
        detection: {
            order: ['localStorage', 'navigator'],
            caches: ['localStorage'],
            lookupLocalStorage: LANGUAGE_STORAGE_KEY,
        },
        react: {
            useSuspense: true,
        },
    });

export default i18next;
