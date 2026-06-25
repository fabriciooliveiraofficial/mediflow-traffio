import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';

type PageHeaderAccent = 'brand' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface PageHeaderProps {
  icon: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  accent?: PageHeaderAccent;
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

export function PageHeader({ icon: Icon, title, subtitle, accent = 'brand', actions, className }: PageHeaderProps) {
  return (
    <div className={clsx('flex flex-col md:flex-row md:items-center justify-between gap-6', className)}>
      <div className="flex items-center gap-4">
        <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg', chipClass[accent])}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-black text-graphite-900 tracking-tight">{title}</h1>
          {subtitle && <div className="text-sm text-graphite-500 font-medium">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
