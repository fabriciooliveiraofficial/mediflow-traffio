import { TrendingUp, TrendingDown, Users, DollarSign, Calendar, CalendarX, Target, Activity } from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, AreaChart, Area 
} from 'recharts';
import type { PerformanceMetrics } from '../../hooks/useFollowUpMetrics';
import { useTranslation } from 'react-i18next';

interface PerformanceStatsProps {
  metrics: PerformanceMetrics | null;
  isLoading: boolean;
}

const CustomTooltip = ({ active, payload, label, prefix = '' }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">{label}</p>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-600"></div>
          <p className="text-sm font-black text-gray-900">
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

  if (isLoading || !metrics) {
    return (
      <div className="space-y-6 mb-10 animate-pulse">
        {/* KPI Cards Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-[124px] bg-white rounded-3xl border border-gray-100 shadow-sm"></div>
          ))}
        </div>
        
        {/* Charts Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-[386px] bg-white rounded-[2rem] border border-gray-100 shadow-sm"></div>
          <div className="h-[386px] bg-white rounded-[2rem] border border-gray-100 shadow-sm"></div>
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
      color: 'blue',
      bg: 'bg-blue-50',
      text: 'text-blue-600'
    },
    {
      label: t('performanceStats.kpis.conversionRate'),
      value: `${metrics.conversionRate.toFixed(1)}%`,
      trend: metrics.trends.conversion,
      icon: Target,
      color: 'emerald',
      bg: 'bg-emerald-50',
      text: 'text-emerald-600'
    },
    {
      label: t('performanceStats.kpis.sales'),
      value: `R$ ${metrics.totalRevenue.toLocaleString('pt-BR')}`,
      trend: metrics.trends.revenue,
      icon: DollarSign,
      color: 'amber',
      bg: 'bg-amber-50',
      text: 'text-amber-600'
    },
    {
      label: t('performanceStats.kpis.appointments'),
      value: metrics.appointmentsCount,
      subValue: t('performanceStats.evaluationsSuffix', { count: metrics.evaluationsCount }),
      icon: Calendar,
      color: 'indigo',
      bg: 'bg-indigo-50',
      text: 'text-indigo-600'
    },
    {
      label: t('performanceStats.kpis.noShow'),
      value: metrics.noShowCount,
      subValue: t('performanceStats.noShowRateSuffix', { rate: metrics.noShowRate.toFixed(1) }),
      trend: metrics.trends.noShows,
      icon: CalendarX,
      color: 'rose',
      bg: 'bg-rose-50',
      text: 'text-rose-600'
    }
  ];

  const hasData = metrics.totalLeads > 0;

  return (
    <div className="space-y-6 mb-10">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map((kpi, idx) => (
          <div key={idx} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-2xl ${kpi.bg} transition-colors group-hover:scale-110 duration-300`}>
                <kpi.icon className={`w-5 h-5 ${kpi.text}`} />
              </div>
              {kpi.trend !== undefined && kpi.trend !== null && (
                <div className={`flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg ${kpi.trend >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                  {kpi.trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(kpi.trend).toFixed(1)}%
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{kpi.label}</p>
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">{kpi.value}</h3>
              {kpi.subValue && <p className="text-[10px] text-gray-400 font-bold mt-1 opacity-70">{kpi.subValue}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funnel Chart */}
        <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm relative overflow-hidden group">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-50">
                <Activity className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">{t('performanceStats.funnelTitle')}</h3>
                <p className="text-[10px] text-gray-400 font-bold">{t('performanceStats.funnelSubtitle')}</p>
              </div>
            </div>
          </div>
          
          {hasData ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.funnelData} layout="vertical" margin={{ left: 10, right: 60 }}>
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
            <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-gray-100 rounded-3xl bg-gray-50/50">
               <Target className="w-8 h-8 text-gray-200 mb-2" />
               <p className="text-xs font-bold text-gray-400 uppercase">{t('performanceStats.funnelEmpty')}</p>
            </div>
          )}
        </div>

        {/* Lead Trend Chart */}
        <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm group">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-50">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">{t('performanceStats.trendTitle')}</h3>
                <p className="text-[10px] text-gray-400 font-bold">{t('performanceStats.trendSubtitle')}</p>
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
            <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-gray-100 rounded-3xl bg-gray-50/50">
               <Activity className="w-8 h-8 text-gray-200 mb-2" />
               <p className="text-xs font-bold text-gray-400 uppercase">{t('performanceStats.trendEmpty')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
