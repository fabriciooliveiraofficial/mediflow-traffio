import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

interface EmptyStateProps {
  icon?: LucideIcon;
  label: string;
  hint?: string;
  className?: string;
}

export function EmptyState({ icon: Icon, label, hint, className }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center py-12 border-2 border-dashed border-ice-100 rounded-3xl bg-ice-50/30',
        className
      )}
    >
      {Icon && (
        <div className="w-12 h-12 rounded-full bg-ice-50 flex items-center justify-center mb-3">
          <Icon className="w-5 h-5 text-ice-200" />
        </div>
      )}
      <p className="text-[10px] font-black text-graphite-300 uppercase tracking-[0.2em]">{label}</p>
      {hint && <p className="text-xs text-graphite-300 font-medium mt-1">{hint}</p>}
    </div>
  );
}
