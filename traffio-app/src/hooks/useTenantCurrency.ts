/**
 * useTenantCurrency — DISPLAY-only BRL -> tenant-local-currency conversion for
 * analytics/dashboard values (ad spend, revenue KPIs). NEVER used for billing,
 * Stripe, or any stored/charged amount — BRL is always the canonical value;
 * this hook only renders a converted number next to it.
 *
 * The conversion rate comes from the `exchange_rates` table, refreshed once a
 * day by the `refresh-exchange-rates` Edge Function (see
 * supabase/functions/refresh-exchange-rates and
 * supabase/migrations/20260623_exchange_rates.sql). If no usable rate is
 * cached (missing or older than STALE_THRESHOLD_MS), `formatDual` silently
 * falls back to BRL-only — the same output as before this feature existed.
 */
import { useEffect, useState } from 'react';
import { useTenant } from '../contexts/TenantContext';
import { supabase } from '../lib/supabase';
import { getCurrencyForCountry, getLocaleForCountry } from '../lib/i18n/countryFormats';
import { formatCurrency } from '../lib/i18n/formatCurrency';

const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000; // 36h — daily cron + slack for a missed run
const SESSION_CACHE_TTL_MS = 60 * 60 * 1000; // 1h in-memory, avoids refetching on every remount

interface CachedRate {
    rate: number;
    fetchedAt: string;
    expiresAt: number;
}

// Module-level cache shared across every component instance in this session.
const rateCache: Record<string, CachedRate> = {};

export interface DualAmount {
    primary: string;
    secondary: string | null;
}

export function useTenantCurrency() {
    const { tenant } = useTenant();
    const displayCurrency = getCurrencyForCountry(tenant?.country);
    const displayLocale = getLocaleForCountry(tenant?.country);
    const isBrl = displayCurrency === 'BRL';

    const [rate, setRate] = useState<number | null>(null);
    const [rateFetchedAt, setRateFetchedAt] = useState<string | null>(null);

    useEffect(() => {
        if (isBrl) return;

        const cached = rateCache[displayCurrency];
        if (cached && cached.expiresAt > Date.now()) {
            applyCachedRate(cached);
            return;
        }

        let cancelled = false;
        supabase
            .from('exchange_rates')
            .select('rate, fetched_at')
            .eq('target_currency', displayCurrency)
            .maybeSingle()
            .then(({ data, error }) => {
                if (cancelled) return;
                if (error || !data) {
                    setRate(null);
                    setRateFetchedAt(null);
                    return;
                }
                const entry: CachedRate = {
                    rate: data.rate,
                    fetchedAt: data.fetched_at,
                    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
                };
                rateCache[displayCurrency] = entry;
                applyCachedRate(entry);
            });

        function applyCachedRate(entry: CachedRate) {
            const isStale = Date.now() - new Date(entry.fetchedAt).getTime() > STALE_THRESHOLD_MS;
            setRate(isStale ? null : entry.rate);
            setRateFetchedAt(isStale ? null : entry.fetchedAt);
        }

        return () => { cancelled = true; };
    }, [displayCurrency, isBrl]);

    // isBrl tenants never need a rate — ignore any stale state from a prior
    // (different-currency) render instead of clearing it via a synchronous
    // setState-in-effect call.
    const effectiveRate = isBrl ? null : rate;
    const effectiveRateFetchedAt = isBrl ? null : rateFetchedAt;

    function formatDual(brlValue: number): DualAmount {
        if (effectiveRate == null) {
            return { primary: formatCurrency(brlValue, { currency: 'BRL', locale: displayLocale }), secondary: null };
        }
        return {
            primary: formatCurrency(brlValue * effectiveRate, { currency: displayCurrency, locale: displayLocale }),
            secondary: formatCurrency(brlValue, { currency: 'BRL', locale: 'pt-BR' }),
        };
    }

    return {
        displayCurrency,
        displayLocale,
        rate: effectiveRate,
        rateFetchedAt: effectiveRateFetchedAt,
        isStale: effectiveRate == null && !isBrl,
        formatDual,
    };
}
