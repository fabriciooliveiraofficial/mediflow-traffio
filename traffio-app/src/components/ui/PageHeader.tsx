import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';

type PageHeaderAccent = 'brand' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
type PageHeaderSize = 'compact' | 'large';

interface PageHeaderProps {
  icon: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  accent?: PageHeaderAccent;
  size?: PageHeaderSize;
  actions?: ReactNode;
  className?: string;
}

const chipClass: Record<PageHeaderAccent, string> = {
  brand: 'bg-brand-primary shadow-brand-primary/20',
  success: 'bg-accent-success shadow-accent-success/20',
  warning: 'bg-accent-warning shadow-accent-warning/20',
  error: 'bg-accent-error shadow-accent-error/20',
  info: 'bg-accent-info shadow-accent-info/20',
  neutral: 'bg-graphite-700 shadow-graphite-700/20',
};

const sizeClass = {
  compact: { chip: 'w-12 h-12 rounded-2xl', icon: 'w-6 h-6', title: 'text-xl tracking-tight' },
  large: { chip: 'w-14 h-14 rounded-2xl', icon: 'w-7 h-7', title: 'text-3xl md:text-4xl tracking-tighter' },
};

export function PageHeader({ icon: Icon, title, subtitle, accent = 'brand', size = 'compact', actions, className }: PageHeaderProps) {
  const s = sizeClass[size];
  return (
    <div className={clsx('flex flex-col md:flex-row md:items-center justify-between gap-6', className)}>
      <div className="flex items-center gap-4">
        <div className={clsx('flex items-center justify-center shrink-0 shadow-lg', s.chip, chipClass[accent])}>
          <Icon className={clsx(s.icon, 'text-white')} />
        </div>
        <div>
          <h1 className={clsx('font-black text-graphite-900', s.title)}>{title}</h1>
          {subtitle && <div className="text-sm text-graphite-500 font-medium">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
