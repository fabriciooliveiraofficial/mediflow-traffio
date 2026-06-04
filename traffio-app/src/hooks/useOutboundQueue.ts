import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export interface OutboundQueueRow {
    id: string;
    tenant_id: string;
    patient_phone: string;
    patient_name?: string;
    message_type: 'follow_up' | 'reminder_48h' | 'reminder_24h' | 'reminder_2h' | 'booking_confirmed' | 'post_consultation' | 'nps' | 'reactivation';
    template_key: string;
    template_vars: any;
    scheduled_at: string;
    status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
    sent_at?: string;
    attempts: number;
    error_message?: string;
    is_edited: boolean;
    created_at: string;
    // Multi-canal
    notification_channel?: 'whatsapp' | 'instagram' | 'facebook' | 'sms';
    channel_recipient_id?: string;
}

interface UseOutboundQueueOptions {
    tenantId: string;
    filters: {
        status?: string;
        message_type?: string;
        search?: string;
        dateRange?: { from: Date; to: Date };
    };
    page?: number;
    pageSize?: number;
}

export function useOutboundQueue({ tenantId, filters, page = 1, pageSize = 25 }: UseOutboundQueueOptions) {
    const [data, setData] = useState<OutboundQueueRow[]>([]);
    const [count, setCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    // Stable refs to avoid recreating fetchQueue on every render
    const filtersRef = useRef(filters);
    const pageRef = useRef(page);
    const pageSizeRef = useRef(pageSize);
    filtersRef.current = filters;
    pageRef.current = page;
    pageSizeRef.current = pageSize;

    const fetchQueue = useCallback(async () => {
        if (!tenantId) return;
        setIsLoading(true);
        try {
            const f = filtersRef.current;
            const p = pageRef.current;
            const ps = pageSizeRef.current;

            let query = supabase
                .from('outbound_message_queue')
                .select('*', { count: 'exact' })
                .eq('tenant_id', tenantId);

            if (f.status && f.status !== 'all') {
                query = query.eq('status', f.status);
            }

            if (f.message_type && f.message_type !== 'all') {
                query = query.eq('message_type', f.message_type);
            }

            if (f.search) {
                query = query.or(`patient_phone.ilike.%${f.search}%,patient_name.ilike.%${f.search}%,template_key.ilike.%${f.search}%`);
            }

            if (f.dateRange) {
                query = query
                    .gte('scheduled_at', f.dateRange.from.toISOString())
                    .lte('scheduled_at', f.dateRange.to.toISOString());
            }

            const from = (p - 1) * ps;
            const to = from + ps - 1;

            const { data: rows, count: total, error } = await query
                .order('scheduled_at', { ascending: false })
                .range(from, to);

            if (error) throw error;

            setData(rows as OutboundQueueRow[]);
            setCount(total || 0);
        } catch (err) {
            console.error('[useOutboundQueue] Fetch error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [tenantId]); // Only tenantId — filters/page read via refs, no re-creation on filter change

    // Re-fetch when filters or page actually change
    useEffect(() => {
        fetchQueue();
    }, [fetchQueue, filters.status, filters.message_type, filters.search, filters.dateRange?.from, filters.dateRange?.to, page]);

    // Realtime subscription — created once per tenantId
    useEffect(() => {
        if (!tenantId) return;

        const channel = supabase
            .channel(`outbound_queue_${tenantId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'outbound_message_queue', filter: `tenant_id=eq.${tenantId}` },
                () => fetchQueue()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [tenantId, fetchQueue]);

    const cancel = async (id: string) => {
        const { error } = await supabase
            .from('outbound_message_queue')
            .update({ status: 'cancelled' })
            .eq('id', id)
            .eq('tenant_id', tenantId);
        if (error) throw error;
        return true;
    };

    const edit = async (id: string, overrideMessage: string) => {
        const { data: current } = await supabase
            .from('outbound_message_queue')
            .select('template_vars')
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .single();

        const newVars = { ...(current?.template_vars || {}), override_message: overrideMessage };

        const { error } = await supabase
            .from('outbound_message_queue')
            .update({ template_vars: newVars, is_edited: true })
            .eq('id', id)
            .eq('tenant_id', tenantId);
        if (error) throw error;
        return true;
    };

    const retry = async (id: string) => {
        const { error } = await supabase
            .from('outbound_message_queue')
            .update({ status: 'pending', attempts: 0, error_message: null })
            .eq('id', id)
            .eq('tenant_id', tenantId);
        if (error) throw error;
        return true;
    };

    const sendNow = async (id: string) => {
        const { error } = await supabase
            .from('outbound_message_queue')
            .update({ scheduled_at: new Date().toISOString(), status: 'pending' })
            .eq('id', id)
            .eq('tenant_id', tenantId);
        if (error) throw error;
        return true;
    };

    return { data, count, isLoading, cancel, edit, retry, sendNow, refetch: fetchQueue };
}
