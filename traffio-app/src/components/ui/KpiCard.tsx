import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { clsx } from 'clsx';
import { Card } from './Card';

type KpiAccent = 'brand' | 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'indigo' | 'purple';

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  icon: LucideIcon;
  accent?: KpiAccent;
  trend?: number | null;
  variant?: 'interactive' | 'glass' | 'floating';
  onClick?: () => void;
  className?: string;
}

const accentClass: Record<KpiAccent, { bg: string; text: string }> = {
  brand: { bg: 'bg-brand-secondary/30', text: 'text-brand-primary' },
  success: { bg: 'bg-accent-success/10', text: 'text-accent-success' },
  warning: { bg: 'bg-accent-warning/10', text: 'text-accent-warning' },
  error: { bg: 'bg-accent-error/10', text: 'text-accent-error' },
  info: { bg: 'bg-accent-info/10', text: 'text-accent-info' },
  neutral: { bg: 'bg-ice-100', text: 'text-graphite-700' },
  // Categorical (non-semantic) hues for KPI rows that need >4 distinct colors. Standard Tailwind
  // palette, same hues already used in PerformanceStats.tsx — no new hex introduced.
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600' },
};

export function KpiCard({ label, value, subValue, icon: Icon, accent = 'brand', trend, variant = 'interactive', onClick, className }: KpiCardProps) {
  const { bg, text } = accentClass[accent];
  const hasTrend = trend !== undefined && trend !== null;

  return (
    <Card variant={variant} padding="md" onClick={onClick} className={clsx('group', onClick && 'cursor-pointer', className)}>
      <div className="flex justify-between items-start mb-4">
        <div className={clsx('p-3 rounded-2xl transition-colors group-hover:scale-110 duration-300', bg)}>
          <Icon className={clsx('w-5 h-5', text)} />
        </div>
        {hasTrend && (
          <div
            className={clsx(
              'flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg',
              trend! >= 0 ? 'bg-accent-success/10 text-accent-success' : 'bg-accent-error/10 text-accent-error'
            )}
          >
            {trend! >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend!).toFixed(1)}%
          </div>
        )}
      </div>
      <div>
        <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest mb-1">{label}</p>
        <h3 className="text-2xl font-black text-graphite-900 tracking-tight">{value}</h3>
        {subValue && <p className="text-[10px] text-graphite-400 font-bold mt-1 opacity-70">{subValue}</p>}
      </div>
    </Card>
  );
}
