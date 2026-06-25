import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

type IconButtonSize = 'sm' | 'md';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
}

const sizeClass: Record<IconButtonSize, string> = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', className, children, ...rest }, ref) => (
    <button
      ref={ref}
      className={clsx(
        'rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 hover:text-brand-primary transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        sizeClass[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
);
IconButton.displayName = 'IconButton';
