/**
 * useTodaySnapshot — dados da tela Hoje.
 *
 * Estratégia de atualização (ver docs/SPEC_TELA_HOJE.md §7):
 *  - realtime em conversation_sessions (a fila F1 é a mais sensível a latência),
 *    com throttle para não recarregar em rajada;
 *  - polling leve de 60s para as demais filas;
 *  - refetch ao voltar o foco para a aba.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { getTodaySnapshot, type TodaySnapshot } from '../services/todayService';

const POLL_MS = 60_000;
const REALTIME_THROTTLE_MS = 1_500;

export function useTodaySnapshot() {
    const { tenant } = useTenant();
    const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const tenantId = tenant?.id;
    const timezone = tenant?.timezone;

    const load = useCallback(async (isManual = false) => {
        if (!tenantId) return;
        if (isManual) setRefreshing(true);
        try {
            const snap = await getTodaySnapshot(tenantId, timezone);
            setSnapshot(snap);
        } catch (e) {
            console.error('[useTodaySnapshot] load failed:', e);
        } finally {
            setLoading(false);
            if (isManual) setRefreshing(false);
        }
    }, [tenantId, timezone]);

    useEffect(() => {
        if (!tenantId) return;
        load();

        const interval = setInterval(() => load(), POLL_MS);

        const onVisibility = () => {
            if (document.visibilityState === 'visible') load();
        };
        document.addEventListener('visibilitychange', onVisibility);

        // Mudança em qualquer sessão do tenant → recarrega (com throttle)
        const channel = supabase
            .channel(`today-${tenantId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'conversation_sessions', filter: `tenant_id=eq.${tenantId}` },
                () => {
                    if (throttleRef.current) return;
                    throttleRef.current = setTimeout(() => {
                        throttleRef.current = null;
                        load();
                    }, REALTIME_THROTTLE_MS);
                }
            )
            .subscribe();

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
            if (throttleRef.current) clearTimeout(throttleRef.current);
            supabase.removeChannel(channel);
        };
    }, [tenantId, load]);

    return { snapshot, loading, refreshing, refresh: () => load(true) };
}
