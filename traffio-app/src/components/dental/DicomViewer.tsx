import React, { useState } from 'react';
import {
    ZoomIn,
    ZoomOut,
    Sun,
    RotateCcw,
    FileSearch
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DicomViewerProps {
    fileUrl?: string | null;
    fileName?: string;
}

export const DicomViewer: React.FC<DicomViewerProps> = ({ fileUrl, fileName }) => {
    const { t } = useTranslation('medical');
    const [zoom, setZoom] = useState(1);
    const [brightness, setBrightness] = useState(100);

    // Initial check for empty state
    if (!fileUrl) {
        return (
            <div className="bg-graphite-900 rounded-[32px] aspect-video flex flex-col items-center justify-center border border-graphite-800 text-graphite-500 gap-4">
                <FileSearch size={48} className="opacity-20" />
                <p className="font-black text-xs uppercase tracking-widest">{t('dicomViewer.emptyState')}</p>
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

                <button onClick={() => { setZoom(1); setBrightness(100); }} className="flex items-center gap-2 px-4 py-2 hover:bg-graphite-800 text-graphite-400 rounded-xl transition-all text-xs font-black uppercase border-none cursor-pointer">
                    <RotateCcw size={16} />
                    <span>{t('dicomViewer.reset')}</span>
                </button>
            </div>

            {/* Viewer Area */}
            <div className="flex-1 relative overflow-auto bg-black flex items-center justify-center p-8">
                <div
                    className="relative transition-transform duration-200 ease-out"
                    style={{
                        transform: `scale(${zoom})`,
                        filter: `brightness(${brightness}%)`
                    }}
                >
                    <img
                        src={fileUrl}
                        alt={fileName || t('dicomViewer.emptyState')}
                        className="max-h-[450px] rounded-lg shadow-2xl border border-graphite-800"
                    />
                </div>

                {fileName && (
                    <div className="absolute top-8 left-8 p-4 bg-black/40 backdrop-blur-md rounded-2xl border border-white/5 text-[10px] font-bold text-white/60 max-w-[240px] truncate pointer-events-none">
                        <p className="text-white truncate">{fileName}</p>
                    </div>
                )}
            </div>
        </div>
    );
};
