import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { startOfDay, endOfDay, subDays } from 'date-fns';
import { useLocaleFormat } from './useLocaleFormat';
import { getTenantTodayString, addDaysToDateString, localDateTimeToUTC } from '../lib/timezoneUtils';

export interface PerformanceMetrics {
  totalLeads: number;
  conversionRate: number;
  totalRevenue: number;
  appointmentsCount: number;
  evaluationsCount: number;
  noShowCount: number;
  noShowRate: number;
  funnelData: { stage: string; count: number }[];
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

      const startLocalTime = '00:00';
      const endLocalTime = '23:59';

      const startDateUTC = localDateTimeToUTC(startDateStr, startLocalTime, tz);
      const endDateUTC = localDateTimeToUTC(todayStr, endLocalTime, tz);
      const prevStartDateUTC = localDateTimeToUTC(prevStartDateStr, startLocalTime, tz);
      const prevEndDateUTC = localDateTimeToUTC(startDateStr, endLocalTime, tz);

      const startStr = startDateUTC.toISOString();
      const endStr = endDateUTC.toISOString();
      const prevStartStr = prevStartDateUTC.toISOString();
      const prevEndStr = prevEndDateUTC.toISOString();

      // 1. Current Period Data
      // Leads: Created in period
      const { data: currentLeads } = await supabase
        .from('conversation_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', startStr)
        .lte('created_at', endStr);

      // Sales Performance: Updated to "Vendido" in period (regardless of when created)
      const { data: currentSales } = await supabase
        .from('conversation_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('kanban_stage', 'Vendido/Procedimento')
        .gte('updated_at', startStr)
        .lte('updated_at', endStr);

      const { data: currentNoShows } = await supabase
        .from('conversation_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('kanban_stage', ['Faltou Avaliação', 'Faltou Consulta'])
        .gte('updated_at', startStr)
        .lte('updated_at', endStr);

      const { data: currentAppointments } = await supabase
        .from('appointments')
        .select('*, type:appointment_types(name)')
        .eq('tenant_id', tenantId)
        .gte('date', startDateStr)
        .lte('date', todayStr);

      // 2. Previous Period Data (for trends)

      const { data: prevLeads } = await supabase
        .from('conversation_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', prevStartStr)
        .lte('created_at', prevEndStr);

      const { data: prevSales } = await supabase
        .from('conversation_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('kanban_stage', 'Vendido/Procedimento')
        .gte('updated_at', prevStartStr)
        .lte('updated_at', prevEndStr);

      const { data: prevNoShows } = await supabase
        .from('conversation_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('kanban_stage', ['Faltou Avaliação', 'Faltou Consulta'])
        .gte('updated_at', prevStartStr)
        .lte('updated_at', prevEndStr);

      const leads = currentLeads || [];
      const sales = currentSales || [];
      const noShowsArr = currentNoShows || [];
      const pLeads = prevLeads || [];
      const pSales = prevSales || [];
      const pNoShows = prevNoShows || [];
      const appointments = currentAppointments || [];

      // Calculations
      const totalLeads = leads.length;
      const totalRevenue = sales.reduce((acc, s) => acc + (s.revenue_estimated || 0), 0);
      const conversionRate = totalLeads > 0 ? (sales.length / totalLeads) * 100 : 0;
      const noShowCount = noShowsArr.length;
      const noShowRate = appointments.length > 0 ? (noShowCount / appointments.length) * 100 : 0;

      const evaluationsCount = appointments.filter(a => 
        (a.type as any)?.name?.toLowerCase().includes('avaliação') || 
        (a.type as any)?.name?.toLowerCase().includes('avaliacao')
      ).length;

      // Funnel Distribution (based on leads created in the period)
      const STAGES = [
        'Novos Leads',
        'Em Contato',
        'Avaliação',
        'Consulta',
        'Vendido/Procedimento'
      ];

      const funnelData = STAGES.map(stage => ({
        stage,
        count: leads.filter(s => s.kanban_stage === stage).length
      }));

      // Time Series (New leads per day)
      const daysMap: Record<string, number> = {};
      leads.forEach(s => {
        const d = new Intl.DateTimeFormat(locale, { 
          day: '2-digit', 
          month: '2-digit',
          timeZone: tz
        }).format(new Date(s.created_at));
        daysMap[d] = (daysMap[d] || 0) + 1;
      });
      const timeSeriesData = Object.entries(daysMap).map(([date, leads]) => ({ date, leads }));

      // Trends
      const prevLeadsCount = pLeads.length;
      const prevSalesCount = pSales.length;
      const prevNoShowCount = pNoShows.length;
      const prevConv = prevLeadsCount > 0 ? (prevSalesCount / prevLeadsCount) * 100 : 0;
      const prevRev = pSales.reduce((acc, s) => acc + (s.revenue_estimated || 0), 0);

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
        funnelData,
        timeSeriesData,
        trends: {
          leads: calcTrend(totalLeads, prevLeadsCount),
          conversion: calcTrend(conversionRate, prevConv),
          revenue: calcTrend(totalRevenue, prevRev),
          noShows: calcTrend(noShowCount, prevNoShowCount)
        }
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
