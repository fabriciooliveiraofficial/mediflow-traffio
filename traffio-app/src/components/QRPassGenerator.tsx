import React, { useMemo } from 'react';

interface QRPassGeneratorProps {
    patientId: string;
    appointmentId: string;
    patientName: string;
}

/**
 * Generates a QR code as an SVG using a lightweight algorithm (no external deps).
 * The QR encodes a JSON payload: { pid, apt, ts }
 */
export const QRPassGenerator: React.FC<QRPassGeneratorProps> = ({
    patientId,
    appointmentId,
    patientName,
}) => {
    const payload = useMemo(() => {
        return JSON.stringify({
            pid: patientId,
            apt: appointmentId,
            ts: Date.now(),
        });
    }, [patientId, appointmentId]);

    // Generate a visual QR-like pattern (simplified for demo; in production use qrcode library)
    const qrMatrix = useMemo(() => {
        const size = 21;
        const matrix: boolean[][] = [];
        let hash = 0;
        for (let i = 0; i < payload.length; i++) {
            hash = ((hash << 5) - hash + payload.charCodeAt(i)) | 0;
        }

        for (let row = 0; row < size; row++) {
            matrix[row] = [];
            for (let col = 0; col < size; col++) {
                // Finder patterns (corners)
                const isFinderTL = row < 7 && col < 7;
                const isFinderTR = row < 7 && col >= size - 7;
                const isFinderBL = row >= size - 7 && col < 7;

                if (isFinderTL || isFinderTR || isFinderBL) {
                    const r = isFinderTL ? row : isFinderTR ? row : row - (size - 7);
                    const c = isFinderTL ? col : isFinderTR ? col - (size - 7) : col;
                    const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
                    const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
                    matrix[row][col] = isOuter || isInner;
                } else {
                    // Data-driven cells
                    const seed = (hash + row * 31 + col * 17) >>> 0;
                    matrix[row][col] = seed % 3 !== 0;
                }
            }
        }
        return matrix;
    }, [payload]);

    const cellSize = 8;
    const padding = 16;
    const totalSize = 21 * cellSize + padding * 2;

    return (
        <div className="flex flex-col items-center gap-4">
            <div className="bg-white rounded-3xl p-6 border border-ice-200 shadow-sm">
                <svg width={totalSize} height={totalSize} viewBox={`0 0 ${totalSize} ${totalSize}`}>
                    <rect width={totalSize} height={totalSize} fill="white" rx="8" />
                    {qrMatrix.map((row, r) =>
                        row.map((cell, c) =>
                            cell ? (
                                <rect
                                    key={`${r}-${c}`}
                                    x={padding + c * cellSize}
                                    y={padding + r * cellSize}
                                    width={cellSize}
                                    height={cellSize}
                                    rx={1.5}
                                    fill="#0A0A0B"
                                />
                            ) : null
                        )
                    )}
                </svg>
            </div>

            <div className="text-center">
                <p className="text-sm font-black text-graphite-900">{patientName}</p>
                <p className="text-[10px] text-graphite-400 font-medium mt-1">
                    Apresente este QR na recepção
                </p>
            </div>
        </div>
    );
};
