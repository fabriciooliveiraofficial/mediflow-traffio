import React from 'react';
import { clsx } from 'clsx';

export type ToothPlane = 'vestibular' | 'lingual' | 'mesial' | 'distal' | 'occlusal';

interface ToothProps {
    number: number;
    selectedPlanes: ToothPlane[];
    onPlaneClick: (toothNumber: number, plane: ToothPlane) => void;
    conditions?: Record<ToothPlane, string>;
}

export const Tooth: React.FC<ToothProps> = ({ number, selectedPlanes, onPlaneClick, conditions = {} }) => {
    // Determine if the entire tooth is selected or just specific planes
    const isPlaneSelected = (plane: ToothPlane) => selectedPlanes.includes(plane);

    const getPlaneColor = (plane: ToothPlane) => {
        const condition = conditions[plane];
        if (isPlaneSelected(plane)) return 'fill-brand-primary stroke-brand-primary/20';
        if (condition === 'caries') return 'fill-rose-500 stroke-rose-600/20';
        if (condition === 'restored') return 'fill-emerald-500 stroke-emerald-600/20';
        return 'fill-transparent stroke-ice-300 hover:fill-ice-50';
    };

    return (
        <div className="flex flex-col items-center gap-2 group cursor-pointer">
            <span className="text-[10px] font-black text-graphite-400 group-hover:text-brand-primary transition-colors">
                {number}
            </span>
            
            <svg width="40" height="40" viewBox="0 0 40 40" className="transition-transform group-hover:scale-110">
                {/* Vestibular (Top) */}
                <path
                    d="M 5,5 L 35,5 L 28,12 L 12,12 Z"
                    className={clsx("transition-colors duration-200 cursor-pointer", getPlaneColor('vestibular'))}
                    onClick={() => onPlaneClick(number, 'vestibular')}
                />
                
                {/* Lingual (Bottom) */}
                <path
                    d="M 12,28 L 28,28 L 35,35 L 5,35 Z"
                    className={clsx("transition-colors duration-200 cursor-pointer", getPlaneColor('lingual'))}
                    onClick={() => onPlaneClick(number, 'lingual')}
                />
                
                {/* Mesial (Left/Right depending on quadrant, using generic for now) */}
                <path
                    d="M 5,5 L 12,12 L 12,28 L 5,35 Z"
                    className={clsx("transition-colors duration-200 cursor-pointer", getPlaneColor('mesial'))}
                    onClick={() => onPlaneClick(number, 'mesial')}
                />
                
                {/* Distal */}
                <path
                    d="M 28,12 L 35,5 L 35,35 L 28,28 Z"
                    className={clsx("transition-colors duration-200 cursor-pointer", getPlaneColor('distal'))}
                    onClick={() => onPlaneClick(number, 'distal')}
                />
                
                {/* Occlusal (Center) */}
                <rect
                    x="12" y="12" width="16" height="16"
                    className={clsx("transition-colors duration-200 cursor-pointer", getPlaneColor('occlusal'))}
                    onClick={() => onPlaneClick(number, 'occlusal')}
                />

                {/* Tooth Frame */}
                <rect
                    x="2" y="2" width="36" height="36"
                    fill="none"
                    strokeWidth="1"
                    className="stroke-ice-100 pointer-events-none"
                    rx="4"
                />
            </svg>
        </div>
    );
};
