import React from 'react';
import { Clock, Users, Stethoscope, Wifi } from 'lucide-react';
import { useRealtimeQueue } from '../../hooks/useRealtimeQueue';
import { QueueStatusBadge } from '../../components/QueueStatusBadge';

/**
 * Public-facing page: Patients open this link (via WhatsApp) to see their
 * real-time queue position without needing to log in.
 *
 * URL format: /waiting-room?tenant=<id>&apt=<appointment_id>
 */
export const WaitingRoom: React.FC = () => {
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('tenant') || '';
    const _appointmentId = params.get('apt') || '';
    // Patient ID would be resolved from appointment in production
    const patientId = params.get('pid') || '';

    const { queue, loading } = useRealtimeQueue(
        { tenantId },
        patientId
    );

    if (!tenantId) {
        return (
            <div className="min-h-screen bg-ice-50 flex items-center justify-center p-6">
                <p className="text-graphite-400 font-medium">Link inválido.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-ice-50 to-white flex flex-col items-center justify-center px-6 py-12">
            {/* Header */}
            <div className="text-center mb-10">
                <div className="w-16 h-16 rounded-2xl bg-brand-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Stethoscope size={28} className="text-brand-primary" />
                </div>
                <h1 className="text-2xl font-black text-graphite-900 tracking-tight mb-1">
                    Sala de Espera Virtual
                </h1>
                <p className="text-sm text-graphite-400 font-medium flex items-center justify-center gap-1.5">
                    <Wifi size={14} className="text-emerald-500" />
                    Atualização em tempo real
                </p>
            </div>

            {loading ? (
                <div className="w-full max-w-sm animate-pulse space-y-4">
                    <div className="h-32 bg-ice-100 rounded-3xl" />
                    <div className="h-20 bg-ice-100 rounded-2xl" />
                </div>
            ) : (
                <div className="w-full max-w-sm space-y-6">
                    {/* Position Card */}
                    <div className="bg-white rounded-3xl border border-ice-200 p-8 shadow-sm text-center relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-primary via-brand-secondary to-emerald-400" />

                        <p className="text-xs font-black text-graphite-400 uppercase tracking-widest mb-2">
                            Sua posição
                        </p>
                        <div className="text-6xl font-black text-brand-primary mb-1">
                            {queue.position}º
                        </div>
                        <p className="text-sm text-graphite-500 font-medium">
                            de {queue.total} na fila
                        </p>
                    </div>

                    {/* Wait Time */}
                    <div className="bg-white rounded-2xl border border-ice-200 p-5 shadow-sm flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-brand-primary/5 flex items-center justify-center shrink-0">
                            <Clock size={24} className="text-brand-primary" />
                        </div>
                        <div>
                            <p className="text-xs font-black text-graphite-400 uppercase tracking-wider">
                                Tempo Estimado
                            </p>
                            <p className="text-xl font-black text-graphite-900">
                                ~{queue.estimatedWaitMinutes} min
                            </p>
                        </div>
                    </div>

                    {/* Doctor Status */}
                    <QueueStatusBadge status={queue.doctorStatus} />

                    {/* People ahead */}
                    <div className="bg-white rounded-2xl border border-ice-200 p-5 shadow-sm flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                            <Users size={24} className="text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-xs font-black text-graphite-400 uppercase tracking-wider">
                                Pacientes à frente
                            </p>
                            <p className="text-xl font-black text-graphite-900">
                                {Math.max(0, queue.position - 1)}
                            </p>
                        </div>
                    </div>

                    {/* Footer */}
                    <p className="text-center text-[10px] text-graphite-300 font-medium pt-4">
                        Powered by Traffio Medical • Atualizado automaticamente
                    </p>
                </div>
            )}
        </div>
    );
};
