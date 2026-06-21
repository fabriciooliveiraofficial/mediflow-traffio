import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getLanguageForCountry } from '../lib/i18n/countryFormats';
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, type AppLanguage } from '../lib/i18n';

/**
 * Reactive access to the current UI language + a setter that persists the
 * user's explicit choice. Use this in the language selector shown in
 * Configurações (team) and inside the patient app — never a floating widget.
 */
export function useLang() {
    const { i18n } = useTranslation();

    const setLanguage = useCallback(
        (lng: AppLanguage) => {
            localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
            i18n.changeLanguage(lng);
        },
        [i18n]
    );

    return {
        language: (i18n.resolvedLanguage || i18n.language) as AppLanguage,
        setLanguage,
        supportedLanguages: SUPPORTED_LANGUAGES,
    };
}

/**
 * Resolves the default language once async tenant/user data becomes
 * available, following the priority documented in src/lib/i18n/index.ts:
 * localStorage (explicit choice, already applied by the boot-time detector)
 * > userPreferredLocale (profiles.preferred_locale / patients.preferred_locale)
 * > tenantCountry (clinic's country, mapped via getLanguageForCountry).
 *
 * Never overrides an explicit choice already in localStorage — this only
 * fills the gap for first-time visits where the detector had nothing to go on.
 */
export function useApplyDefaultLanguage({
    userPreferredLocale,
    tenantCountry,
}: {
    userPreferredLocale?: string | null;
    tenantCountry?: string | null;
}) {
    const { i18n } = useTranslation();

    useEffect(() => {
        const hasExplicitPreference = !!localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (hasExplicitPreference) return;

        if (userPreferredLocale && (SUPPORTED_LANGUAGES as readonly string[]).includes(userPreferredLocale)) {
            if (i18n.resolvedLanguage !== userPreferredLocale) {
                i18n.changeLanguage(userPreferredLocale);
            }
            return;
        }

        if (tenantCountry) {
            const targetLanguage = getLanguageForCountry(tenantCountry);
            if (i18n.resolvedLanguage !== targetLanguage) {
                i18n.changeLanguage(targetLanguage);
            }
        }
    }, [userPreferredLocale, tenantCountry, i18n]);
}

/**
 * Keeps <html lang> in sync with the active UI language (no RTL languages
 * among pt-BR/en/es, so `dir` stays implicitly "ltr"). Mount once near the
 * app root so it covers every route, public or authenticated.
 */
export function useSyncHtmlLang() {
    const { language } = useLang();

    useEffect(() => {
        document.documentElement.lang = language;
    }, [language]);
}
