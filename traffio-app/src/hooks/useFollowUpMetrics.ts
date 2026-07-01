import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

import { useLocaleFormat } from './useLocaleFormat';
import { getTenantTodayString, addDaysToDateString, localDateTimeToUTC } from '../lib/timezoneUtils';
import type { CrmStageId } from '../lib/crmStages';

export interface PerformanceMetrics {
  totalLeads: number;
  conversionRate: number;
  totalRevenue: number;
  appointmentsCount: number;
  evaluationsCount: number;
  noShowCount: number;
  noShowRate: number;
  recoveredRevenue: number;
  funnelData: { stage: CrmStageId; count: number }[];
  timeSeriesData: { date: string; leads: number }[];
  trends: {
    leads: number | null;
    conversion: number | null;
    revenue: number | null;
    noShows: number | null;
  };
}

interface MetricsOptions {
  tenantId: string;
  days?: number;
  timezone?: string;
}

const FUNNEL_STAGES: CrmStageId[] = ['new_lead', 'in_contact', 'scheduled', 'showed_up', 'won'];

export function useFollowUpMetrics({ tenantId, days = 30, timezone }: MetricsOptions) {
  const { locale } = useLocaleFormat();
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);

    try {
      const tz = timezone || 'America/Sao_Paulo';
      const todayStr = getTenantTodayString(tz);
      const startDateStr = addDaysToDateString(todayStr, -days);
      const prevStartDateStr = addDaysToDateString(startDateStr, -days);

      const startDateUTC = localDateTimeToUTC(startDateStr, '00:00', tz);
      const endDateUTC = localDateTimeToUTC(todayStr, '23:59', tz);
      const prevStartDateUTC = localDateTimeToUTC(prevStartDateStr, '00:00', tz);
      const prevEndDateUTC = localDateTimeToUTC(startDateStr, '23:59', tz);

      const startStr = startDateUTC.toISOString();
      const endStr = endDateUTC.toISOString();
      const prevStartStr = prevStartDateUTC.toISOString();
      const prevEndStr = prevEndDateUTC.toISOString();

      // 1. Leads criados no período (cards do CRM Journey Engine)
      const { data: currentLeads } = await supabase
        .from('crm_journeys')
        .select('id, stage_id, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startStr)
        .lte('created_at', endStr);

      const { data: prevLeads } = await supabase
        .from('crm_journeys')
        .select('id')
        .eq('tenant_id', tenantId)
        .gte('created_at', prevStartStr)
        .lte('created_at', prevEndStr);

      // 2. Vendas: evento stage_changed → won ocorrido no período (fonte de
      //    verdade real, não "qualquer updated_at" como na versão antiga)
      const { data: currentSaleEvents } = await supabase
        .from('crm_journey_events')
        .select('journey_id, created_at')
        .eq('tenant_id', tenantId)
        .eq('event_type', 'stage_changed')
        .eq('payload->>to', 'won')
        .gte('created_at', startStr)
        .lte('created_at', endStr);

      const { data: prevSaleEvents } = await supabase
        .from('crm_journey_events')
        .select('journey_id')
        .eq('tenant_id', tenantId)
        .eq('event_type', 'stage_changed')
        .eq('payload->>to', 'won')
        .gte('created_at', prevStartStr)
        .lte('created_at', prevEndStr);

      const saleJourneyIds = [...new Set((currentSaleEvents || []).map(e => e.journey_id))];
      let totalRevenue = 0;
      let soldJourneys: { id: string; revenue_estimated: number }[] = [];
      if (saleJourneyIds.length > 0) {
        const { data } = await supabase
          .from('crm_journeys')
          .select('id, revenue_estimated')
          .in('id', saleJourneyIds);
        soldJourneys = data || [];
        totalRevenue = soldJourneys.reduce((acc, j) => acc + (j.revenue_estimated || 0), 0);
      }

      // 3. No-shows: evento no_show ocorrido no período
      const { data: currentNoShowEvents } = await supabase
        .from('crm_journey_events')
        .select('journey_id')
        .eq('tenant_id', tenantId)
        .eq('event_type', 'no_show')
        .gte('created_at', startStr)
        .lte('created_at', endStr);

      const { data: prevNoShowEvents } = await supabase
        .from('crm_journey_events')
        .select('journey_id')
        .eq('tenant_id', tenantId)
        .eq('event_type', 'no_show')
        .gte('created_at', prevStartStr)
        .lte('created_at', prevEndStr);

      // 4. Receita recuperada: cards que passaram por recovery/recall_due e fecharam won
      const { data: recoveryTouched } = await supabase
        .from('crm_journey_events')
        .select('journey_id')
        .eq('tenant_id', tenantId)
        .eq('event_type', 'stage_changed')
        .in('payload->>to', ['recovery', 'recall_due']);

      const recoveredJourneyIds = new Set((recoveryTouched || []).map(e => e.journey_id));
      const recoveredRevenue = soldJourneys
        .filter(j => recoveredJourneyIds.has(j.id))
        .reduce((acc, j) => acc + (j.revenue_estimated || 0), 0);

      // 5. Agendamentos no período (mesma leitura de sempre — appointments é a
      //    fonte real da agenda; o CRM só espelha o resultado)
      const { data: currentAppointments } = await supabase
        .from('appointments')
        .select('*, type:appointment_types(name)')
        .eq('tenant_id', tenantId)
        .gte('date', startDateStr)
        .lte('date', todayStr);

      const leads = currentLeads || [];
      const pLeads = prevLeads || [];
      const appointments = currentAppointments || [];

      const totalLeads = leads.length;
      const salesCount = saleJourneyIds.length;
      const conversionRate = totalLeads > 0 ? (salesCount / totalLeads) * 100 : 0;
      const noShowCount = (currentNoShowEvents || []).length;
      const noShowRate = appointments.length > 0 ? (noShowCount / appointments.length) * 100 : 0;

      const evaluationsCount = appointments.filter(a =>
        (a.type as any)?.name?.toLowerCase().includes('avaliação') ||
        (a.type as any)?.name?.toLowerCase().includes('avaliacao')
      ).length;

      const funnelData = FUNNEL_STAGES.map(stage => ({
        stage,
        count: leads.filter(j => j.stage_id === stage).length,
      }));

      const daysMap: Record<string, number> = {};
      leads.forEach(j => {
        const d = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: tz }).format(new Date(j.created_at));
        daysMap[d] = (daysMap[d] || 0) + 1;
      });
      const timeSeriesData = Object.entries(daysMap).map(([date, count]) => ({ date, leads: count }));

      const prevLeadsCount = pLeads.length;
      const prevSalesCount = (prevSaleEvents || []).length;
      const prevNoShowCount = (prevNoShowEvents || []).length;
      const prevConv = prevLeadsCount > 0 ? (prevSalesCount / prevLeadsCount) * 100 : 0;

      const calcTrend = (curr: number, prev: number) => {
        if (prev === 0) return curr > 0 ? 100 : null;
        return ((curr - prev) / prev) * 100;
      };

      setMetrics({
        totalLeads,
        conversionRate,
        totalRevenue,
        appointmentsCount: appointments.length,
        evaluationsCount,
        noShowCount,
        noShowRate,
        recoveredRevenue: recoveredRevenue || 0,
        funnelData,
        timeSeriesData,
        trends: {
          leads: calcTrend(totalLeads, prevLeadsCount),
          conversion: calcTrend(conversionRate, prevConv),
          revenue: calcTrend(totalRevenue, 0),
          noShows: calcTrend(noShowCount, prevNoShowCount),
        },
      });

    } catch (err) {
      console.error('[useFollowUpMetrics] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, days, locale, timezone]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return { metrics, isLoading, refetch: fetchMetrics };
}
