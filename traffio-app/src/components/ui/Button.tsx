import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost' | 'dangerGhost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-brand-primary text-white shadow-md shadow-brand-primary/20 hover:scale-105',
  secondary: 'bg-brand-secondary text-brand-primary hover:bg-brand-secondary/80',
  success: 'bg-accent-success text-white shadow-md shadow-accent-success/20 hover:scale-105',
  danger: 'bg-accent-error text-white shadow-md shadow-accent-error/20 hover:scale-105',
  ghost: 'bg-white text-graphite-700 border border-ice-200 hover:bg-ice-50',
  dangerGhost: 'bg-transparent text-accent-error/70 border border-transparent hover:text-accent-error hover:bg-accent-error/5 hover:border-accent-error/20',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-xs',
  md: 'px-5 py-2.5 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, children, ...rest }, ref) => (
    <button
      ref={ref}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-all border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
);
Button.displayName = 'Button';
