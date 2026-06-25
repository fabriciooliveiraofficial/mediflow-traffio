import { forwardRef, type HTMLAttributes } from 'react';
import { clsx } from 'clsx';

type CardVariant = 'default' | 'panel' | 'interactive' | 'flat';
type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
}

const paddingClass: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

const variantClass: Record<CardVariant, string> = {
  default: 'bg-white rounded-3xl border border-ice-100 shadow-sm',
  panel: 'bg-white rounded-4xl border border-ice-100 shadow-sm',
  interactive:
    'bg-white rounded-3xl border border-ice-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300',
  flat: 'bg-white rounded-3xl border border-ice-100',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', padding = 'md', className, children, ...rest }, ref) => (
    <div ref={ref} className={clsx(variantClass[variant], paddingClass[padding], className)} {...rest}>
      {children}
    </div>
  )
);
Card.displayName = 'Card';
