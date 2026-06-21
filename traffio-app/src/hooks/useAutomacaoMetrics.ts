import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

interface MetricsOptions {
    tenantId: string;
    dateRange: { from: Date; to: Date };
}

export function useAutomacaoMetrics({ tenantId, dateRange }: MetricsOptions) {
    const { t } = useTranslation('automations');
    const [metrics, setMetrics] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const dateRangeRef = useRef(dateRange);
    dateRangeRef.current = dateRange;

    const fetchMetrics = useCallback(async () => {
        if (!tenantId) return;
        setIsLoading(true);
        try {
            const dateRange = dateRangeRef.current;
            const startStr = dateRange.from.toISOString();
            const endStr = dateRange.to.toISOString();

            // Previous period (same duration, shifted back) for trend comparison
            const durationMs = dateRange.to.getTime() - dateRange.from.getTime();
            const prevStart = new Date(dateRange.from.getTime() - durationMs).toISOString();
            const prevEnd = startStr;

            // 1. Current period — Outbound stats
            const { data: qData } = await supabase
                .from('outbound_message_queue')
                .select('message_type, status, template_key, template_vars, created_at, sent_at')
                .eq('tenant_id', tenantId)
                .gte('created_at', startStr)
                .lte('created_at', endStr);

            // 2. Previous period — Outbound stats (for trends)
            const { data: qPrev } = await supabase
                .from('outbound_message_queue')
                .select('message_type, status')
                .eq('tenant_id', tenantId)
                .gte('created_at', prevStart)
                .lte('created_at', prevEnd);

            // 3. Current period — Funnel stages
            const { data: fData } = await supabase
                .from('patient_funnel_stage')
                .select('current_stage, created_at')
                .eq('tenant_id', tenantId)
                .gte('created_at', startStr)
                .lte('created_at', endStr);

            // 4. Previous period — Funnel stages (for conversion trend)
            const { data: fPrev } = await supabase
                .from('patient_funnel_stage')
                .select('current_stage')
                .eq('tenant_id', tenantId)
                .gte('created_at', prevStart)
                .lte('created_at', prevEnd);

            const rows = qData || [];
            const rowsPrev = qPrev || [];
            const funnels = fData || [];
            const funnelsPrev = fPrev || [];

            // ── KPIs: current period ─────────────────────────────────────────
            const sentFollowups = rows.filter(r => r.message_type === 'follow_up' && r.status === 'sent').length;
            const remindersSent = rows.filter(r => (r.message_type === 'reminder_48h' || r.message_type === 'reminder_24h' || r.message_type === 'reminder_2h') && r.status === 'sent').length;
            const bookingsConfirmed = rows.filter(r => r.message_type === 'booking_confirmed').length;
            const confirmationsSent = rows.filter(r => (r.message_type === 'reminder_48h' || r.message_type === 'reminder_24h') && r.status === 'sent').length;

            const leadsCount = funnels.filter(f => f.current_stage !== 'perdido').length;
            const bookedCount = funnels.filter(f => f.current_stage === 'agendado').length;
            const conversionRate = leadsCount > 0 ? (bookedCount / leadsCount) * 100 : 0;

            // NPS
            const npsScores = rows
                .filter(r => r.template_vars?.nps_score !== undefined)
                .map(r => Number(r.template_vars.nps_score))
                .filter(n => !isNaN(n));
            const npsAverage = npsScores.length > 0
                ? npsScores.reduce((a, b) => a + b, 0) / npsScores.length
                : 0;

            // ── KPIs: previous period ────────────────────────────────────────
            const prevSentFollowups = rowsPrev.filter(r => r.message_type === 'follow_up' && r.status === 'sent').length;
            const prevRemindersSent = rowsPrev.filter(r => (r.message_type === 'reminder_48h' || r.message_type === 'reminder_2h') && r.status === 'sent').length;
            const prevLeads = funnelsPrev.filter(f => f.current_stage !== 'perdido').length;
            const prevBooked = funnelsPrev.filter(f => f.current_stage === 'agendado').length;
            const prevConversionRate = prevLeads > 0 ? (prevBooked / prevLeads) * 100 : 0;

            const trend = (curr: number, prev: number) => {
                if (prev === 0) return curr > 0 ? 100 : null;
                return parseFloat(((curr - prev) / prev * 100).toFixed(1));
            };

            // ── Funnel bar chart ─────────────────────────────────────────────
            const stageCounts = [
                { stage: 'Novo Lead', count: funnels.filter(f => f.current_stage === 'novo_lead').length },
                { stage: 'Em Follow-up', count: funnels.filter(f => f.current_stage === 'em_follow_up').length },
                { stage: 'Qualificado', count: funnels.filter(f => f.current_stage === 'qualificado').length },
                { stage: 'Agendado', count: funnels.filter(f => f.current_stage === 'agendado').length },
            ];

            // ── NPS distribution ─────────────────────────────────────────────
            const npsDist = [
                { range: '0-6', count: npsScores.filter(s => s <= 6).length },
                { range: '7-8', count: npsScores.filter(s => s >= 7 && s <= 8).length },
                { range: '9-10', count: npsScores.filter(s => s >= 9).length },
            ];
            const promotersCount = npsDist[2].count;
            const promotersPct = npsScores.length > 0
                ? Math.round((promotersCount / npsScores.length) * 100)
                : 0;

            // ── Time series ──────────────────────────────────────────────────
            const timeSeriesData = computeTimeSeries(rows);

            // ── Template effectiveness (real data) ───────────────────────────
            const templateStats: Record<string, { sent: number; failed: number; pending: number }> = {};
            rows.forEach(r => {
                const key = r.template_key || r.message_type;
                if (!templateStats[key]) templateStats[key] = { sent: 0, failed: 0, pending: 0 };
                if (r.status === 'sent') templateStats[key].sent++;
                else if (r.status === 'failed') templateStats[key].failed++;
                else if (r.status === 'pending') templateStats[key].pending++;
            });

            const topTemplates = Object.entries(templateStats)
                .map(([key, stats]) => {
                    const total = stats.sent + stats.failed;
                    const rate = total > 0 ? parseFloat(((stats.sent / total) * 100).toFixed(1)) : null;
                    return { key: formatTemplateName(key, t), sent: stats.sent, failed: stats.failed, pending: stats.pending, rate };
                })
                .filter(t => t.sent > 0)
                .sort((a, b) => b.sent - a.sent)
                .slice(0, 6);

            setMetrics({
                followUpsSent: sentFollowups,
                conversionRate: conversionRate.toFixed(1),
                noShowsPrevented: remindersSent,
                npsAverage: npsAverage.toFixed(1),
                bookingsConfirmed,
                confirmationsSent,
                funnelData: stageCounts,
                timeSeriesData,
                npsDistribution: npsDist,
                promotersPct,
                topTemplates,
                trends: {
                    followUps: trend(sentFollowups, prevSentFollowups),
                    conversion: trend(conversionRate, prevConversionRate),
                    noShows: trend(remindersSent, prevRemindersSent),
                }
            });

        } catch (err) {
            console.error('[useAutomacaoMetrics] Fetch error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [tenantId]); // dateRange read via ref — no loop

    useEffect(() => {
        fetchMetrics();
    }, [fetchMetrics, dateRange.from.getTime(), dateRange.to.getTime()]);

    return { metrics, isLoading, refetch: fetchMetrics };
}

function formatTemplateName(key: string): string {
    const labels: Record<string, string> = {
        follow_up: 'Follow-up',
        follow_up_1: 'Follow-up Passo 1',
        follow_up_2: 'Follow-up Passo 2',
        follow_up_3: 'Follow-up Passo 3',
        reminder_48h: 'Lembrete 48h',
        reminder_2h: 'Lembrete 2h',
        post_consultation: 'Pós-Consulta',
        nps: 'NPS / Feedback',
        reactivation: 'Reativação',
    };
    return labels[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function computeTimeSeries(rows: any[]) {
    const days: Record<string, any> = {};
    rows.forEach(r => {
        const date = new Date(r.created_at).toISOString().split('T')[0];
        if (!days[date]) days[date] = { date, follow_up: 0, reminder: 0, post_consultation: 0 };

        if (r.message_type === 'follow_up') days[date].follow_up++;
        else if (r.message_type.startsWith('reminder')) days[date].reminder++;
        else days[date].post_consultation++;
    });

    return Object.values(days).sort((a: any, b: any) => a.date.localeCompare(b.date));
}
