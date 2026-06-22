import React from 'react';
import { clsx } from 'clsx';

interface PageWrapperProps {
    children: React.ReactNode;
    maxWidth?: '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';
    className?: string;
}

export const PageWrapper = ({
    children,
    maxWidth = 'full',
    className,
}: PageWrapperProps) => {
    const maxWidthClass = {
        '3xl': 'max-w-3xl mx-auto',
        '4xl': 'max-w-4xl mx-auto',
        '5xl': 'max-w-5xl mx-auto',
        '6xl': 'max-w-6xl mx-auto',
        '7xl': 'max-w-7xl mx-auto',
        'full': 'w-full',
    }[maxWidth];

    return (
        <div className={clsx(
            'space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12',
            maxWidthClass,
            className
        )}>
            {children}
        </div>
    );
};
