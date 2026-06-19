import React, { useState } from 'react';
import {
    Maximize2,
    ZoomIn,
    ZoomOut,
    Sun,
    RotateCcw,
    ChevronLeft,
    ChevronRight,
    FileSearch
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DicomViewerProps {
    fileUrl?: string;
}

export const DicomViewer: React.FC<DicomViewerProps> = ({ fileUrl }) => {
    const { t } = useTranslation('medical');
    const [zoom, setZoom] = useState(1);
    const [brightness, setBrightness] = useState(100);
    const [contrast, setContrast] = useState(100);

    // Initial check for empty state
    if (!fileUrl) {
        return (
            <div className="bg-graphite-900 rounded-[32px] aspect-video flex flex-col items-center justify-center border border-graphite-800 text-graphite-500 gap-4">
                <FileSearch size={48} className="opacity-20" />
                <p className="font-black text-xs uppercase tracking-widest">{t('medical.dicomViewer.emptyState')}</p>
            </div>
        );
    }

    return (
        <div className="bg-graphite-900 rounded-[32px] overflow-hidden border border-graphite-800 flex flex-col h-[600px] shadow-2xl animate-in fade-in duration-700">
            {/* Toolbar */}
            <div className="p-4 bg-graphite-950/50 border-b border-graphite-800 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 bg-graphite-900 p-1 rounded-xl">
                        <button onClick={() => setZoom(prev => Math.min(prev + 0.1, 3))} className="p-2 hover:bg-graphite-800 text-graphite-400 rounded-lg transition-colors border-none cursor-pointer">
                            <ZoomIn size={18} />
                        </button>
                        <button onClick={() => setZoom(prev => Math.max(prev - 0.1, 0.5))} className="p-2 hover:bg-graphite-800 text-graphite-400 rounded-lg transition-colors border-none cursor-pointer">
                            <ZoomOut size={18} />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 px-3 border-l border-graphite-800">
                        <Sun size={16} className="text-graphite-400" />
                        <input 
                            type="range" 
                            min="50" max="200" 
                            value={brightness}
                            onChange={(e) => setBrightness(parseInt(e.target.value))}
                            className="w-24 accent-brand-primary h-1 bg-graphite-800 rounded-full appearance-none outline-none cursor-pointer"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={() => { setZoom(1); setBrightness(100); setContrast(100); }} className="flex items-center gap-2 px-4 py-2 hover:bg-graphite-800 text-graphite-400 rounded-xl transition-all text-xs font-black uppercase border-none cursor-pointer">
                        <RotateCcw size={16} />
                        <span>Reset</span>
                    </button>
                    <button className="p-2 hover:bg-graphite-800 text-brand-primary rounded-xl transition-all border-none cursor-pointer">
                        <Maximize2 size={20} />
                    </button>
                </div>
            </div>

            {/* Viewer Area */}
            <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center p-8">
                {/* Mock Image for now - In production, this would be cornerstone canvas */}
                <div 
                    className="relative transition-transform duration-200 ease-out"
                    style={{ 
                        transform: `scale(${zoom})`,
                        filter: `brightness(${brightness}%) contrast(${contrast}%)`
                    }}
                >
                    <img 
                        src="https://images.unsplash.com/photo-1579154235828-4019a5ca884c?q=80&w=1000&auto=format&fit=crop" 
                        alt="X-ray DICOM Mock" 
                        className="max-h-[450px] rounded-lg shadow-2xl border border-graphite-800"
                    />
                    
                    {/* Measurement Overlay (Aesthetic Mock) */}
                    <div className="absolute top-4 left-4 border-l-2 border-t-2 border-emerald-500/50 w-8 h-8 pointer-events-none" />
                    <div className="absolute top-4 right-4 border-r-2 border-t-2 border-emerald-500/50 w-8 h-8 pointer-events-none" />
                    <div className="absolute bottom-4 right-4 border-r-2 border-b-2 border-emerald-500/50 w-8 h-8 pointer-events-none" />
                    <div className="absolute bottom-4 left-4 border-l-2 border-b-2 border-emerald-500/50 w-8 h-8 pointer-events-none" />
                </div>

                {/* Patient / Exam Data Overlay */}
                <div className="absolute top-8 left-8 p-4 bg-black/40 backdrop-blur-md rounded-2xl border border-white/5 text-[10px] font-bold text-white/60 space-y-1 pointer-events-none">
                    <p className="text-white">ID: #DX-99281</p>
                    <p>DATE: 2026-03-23</p>
                    <p>METHOD: CT-PANORAMIC</p>
                    <p>HOSPITAL: TRAFFIO DENTAL HQ</p>
                </div>
            </div>

            {/* Navigation / Footer */}
            <div className="p-6 bg-graphite-950/80 border-t border-graphite-800 flex items-center justify-between">
                <div className="flex gap-2">
                    <button className="p-3 bg-graphite-900 border border-graphite-800 text-graphite-400 rounded-2xl hover:bg-graphite-800 transition-colors border-none cursor-pointer">
                        <ChevronLeft size={20} />
                    </button>
                    <button className="p-3 bg-graphite-900 border border-graphite-800 text-graphite-400 rounded-2xl hover:bg-graphite-800 transition-colors border-none cursor-pointer">
                        <ChevronRight size={20} />
                    </button>
                </div>
                
                <div className="flex flex-col items-end">
                    <span className="text-[10px] font-black text-graphite-600 uppercase tracking-widest leading-tight">{t('medical.dicomViewer.seriesImages')}</span>
                    <span className="text-sm font-black text-white leading-tight">1 / 1</span>
                </div>
            </div>
        </div>
    );
};
