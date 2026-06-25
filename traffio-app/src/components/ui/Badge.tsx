import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';

type BadgeAccent = 'brand' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
type BadgeVariant = 'pill' | 'tag';
type BadgeSize = 'sm' | 'md';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  accent?: BadgeAccent;
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const accentClass: Record<BadgeAccent, string> = {
  brand: 'bg-brand-secondary/30 text-brand-primary border-brand-secondary/40',
  success: 'bg-accent-success/10 text-accent-success border-accent-success/20',
  warning: 'bg-accent-warning/10 text-accent-warning border-accent-warning/20',
  error: 'bg-accent-error/10 text-accent-error border-accent-error/20',
  info: 'bg-accent-info/10 text-accent-info border-accent-info/20',
  neutral: 'bg-ice-100 text-graphite-500 border-ice-200',
};

const variantClass: Record<BadgeVariant, string> = {
  pill: 'font-black uppercase tracking-wide',
  tag: 'font-medium',
};

const sizeClass: Record<BadgeSize, string> = {
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
};

export function Badge({ accent = 'neutral', variant = 'pill', size = 'md', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border',
        accentClass[accent],
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
