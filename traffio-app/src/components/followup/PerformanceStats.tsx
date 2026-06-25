import { TrendingUp, Users, DollarSign, Calendar, CalendarX, Target, Activity } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import type { PerformanceMetrics } from '../../hooks/useFollowUpMetrics';
import { useTranslation } from 'react-i18next';
import { STAGE_LABEL_KEYS, type KanbanStage } from '../../lib/kanbanStages';
import { useTenantCurrency } from '../../hooks/useTenantCurrency';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';
import { Card, KpiCard, EmptyState } from '../ui';

interface PerformanceStatsProps {
  metrics: PerformanceMetrics | null;
  isLoading: boolean;
}

const CustomTooltip = ({ active, payload, label, prefix = '' }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-ice-100 animate-in zoom-in-95 duration-200">
        <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-2">{label}</p>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-brand-primary"></div>
          <p className="text-sm font-black text-graphite-900">
            {prefix}{payload[0].value.toLocaleString('pt-BR')}
          </p>
        </div>
      </div>
    );
  }
  return null;
};

export function PerformanceStats({ metrics, isLoading }: PerformanceStatsProps) {
  const { t } = useTranslation('crm');
  const { formatDual, rateFetchedAt } = useTenantCurrency();
  const { formatDateTime } = useLocaleFormat();

  if (isLoading || !metrics) {
    return (
      <div className="space-y-6 mb-10 animate-pulse">
        {/* KPI Cards Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => (
            <Card key={i} variant="floating" padding="none" className="h-[124px]" />
          ))}
        </div>

        {/* Charts Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card variant="floatingPanel" padding="none" className="h-[386px]" />
          <Card variant="floatingPanel" padding="none" className="h-[386px]" />
        </div>
      </div>
    );
  }

  const kpis = [
    {
      label: t('performanceStats.kpis.totalLeads'),
      value: metrics.totalLeads,
      trend: metrics.trends.leads,
      icon: Users,
      accent: 'brand' as const,
    },
    {
      label: t('performanceStats.kpis.conversionRate'),
      value: `${metrics.conversionRate.toFixed(1)}%`,
      trend: metrics.trends.conversion,
      icon: Target,
      accent: 'success' as const,
    },
    {
      label: t('performanceStats.kpis.sales'),
      value: (() => {
        const d = formatDual(metrics.totalRevenue);
        if (!d.secondary) return d.primary;
        return (
          <>
            {d.primary}
            <span
              className="block text-[10px] font-medium text-graphite-400 mt-0.5 normal-case tracking-normal"
              title={rateFetchedAt ? `Cotação de ${formatDateTime(rateFetchedAt)}` : undefined}
            >
              ({d.secondary})
            </span>
          </>
        );
      })(),
      trend: metrics.trends.revenue,
      icon: DollarSign,
      accent: 'warning' as const,
    },
    {
      label: t('performanceStats.kpis.appointments'),
      value: metrics.appointmentsCount,
      subValue: t('performanceStats.evaluationsSuffix', { count: metrics.evaluationsCount }),
      icon: Calendar,
      accent: 'indigo' as const,
    },
    {
      label: t('performanceStats.kpis.noShow'),
      value: metrics.noShowCount,
      subValue: t('performanceStats.noShowRateSuffix', { rate: metrics.noShowRate.toFixed(1) }),
      trend: metrics.trends.noShows,
      icon: CalendarX,
      accent: 'error' as const,
    }
  ];

  const hasData = metrics.totalLeads > 0;

  const translatedFunnelData = metrics.funnelData.map(d => ({
    ...d,
    stage: t(`kanbanStages.${STAGE_LABEL_KEYS[d.stage as KanbanStage]}`),
  }));

  return (
    <div className="space-y-6 mb-10">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map((kpi, idx) => (
          <KpiCard
            key={idx}
            label={kpi.label}
            value={kpi.value}
            subValue={kpi.subValue}
            icon={kpi.icon}
            accent={kpi.accent}
            trend={kpi.trend}
            variant="floating"
          />
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funnel Chart */}
        <Card variant="floatingPanel" padding="lg" className="relative overflow-hidden group">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-brand-secondary/30">
                <Activity className="w-5 h-5 text-brand-primary" />
              </div>
              <div>
                <h3 className="text-sm font-black text-graphite-900 uppercase tracking-wider">{t('performanceStats.funnelTitle')}</h3>
                <p className="text-[10px] text-graphite-400 font-bold">{t('performanceStats.funnelSubtitle')}</p>
              </div>
            </div>
          </div>

          {hasData ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={translatedFunnelData} layout="vertical" margin={{ left: 10, right: 60 }}>
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="stage" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }}
                    width={100}
                  />
                  <Tooltip cursor={{ fill: '#f8fafc', radius: 8 }} content={<CustomTooltip />} />
                  <Bar 
                    dataKey="count" 
                    fill="#3b82f6" 
                    radius={[0, 8, 8, 0]} 
                    barSize={20}
                    label={{ position: 'right', fontSize: 11, fontWeight: 900, fill: '#1e40af', offset: 15 }}
                  >
                    {metrics.funnelData.map((entry, index) => (
                      <Area key={`cell-${index}`} fillOpacity={0.8 - (index * 0.1)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={Target} label={t('performanceStats.funnelEmpty')} className="h-64" />
          )}
        </Card>

        {/* Lead Trend Chart */}
        <Card variant="floatingPanel" padding="lg" className="group">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-accent-success/10">
                <TrendingUp className="w-5 h-5 text-accent-success" />
              </div>
              <div>
                <h3 className="text-sm font-black text-graphite-900 uppercase tracking-wider">{t('performanceStats.trendTitle')}</h3>
                <p className="text-[10px] text-graphite-400 font-bold">{t('performanceStats.trendSubtitle')}</p>
              </div>
            </div>
          </div>

          {hasData ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.timeSeriesData}>
                  <defs>
                    <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                    dy={12}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} 
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="leads" 
                    stroke="#10b981" 
                    strokeWidth={4}
                    fillOpacity={1} 
                    fill="url(#colorLeads)" 
                    animationDuration={1500}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={Activity} label={t('performanceStats.trendEmpty')} className="h-64" />
          )}
        </Card>
      </div>
    </div>
  );
}
