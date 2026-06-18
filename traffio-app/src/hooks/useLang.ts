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
 * Applies the default language derived from a clinic/patient country, but
 * ONLY when the user has never made an explicit language choice before
 * (no stored preference). Call once tenant/patient `country` is available
 * (e.g. from TenantContext) — async data can't be read by the boot-time
 * language detector, so this closes that gap.
 */
export function useApplyDefaultLanguageFromCountry(country: string | null | undefined) {
    const { i18n } = useTranslation();

    useEffect(() => {
        if (!country) return;
        const hasExplicitPreference = !!localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (hasExplicitPreference) return;

        const targetLanguage = getLanguageForCountry(country);
        if (i18n.resolvedLanguage !== targetLanguage) {
            i18n.changeLanguage(targetLanguage);
        }
    }, [country, i18n]);
}
