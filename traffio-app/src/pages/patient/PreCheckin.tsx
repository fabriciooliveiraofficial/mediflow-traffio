import React, { useState, useEffect } from 'react';
import {
    CheckCircle2,
    ChevronRight,
    MapPin,
    ShieldCheck,
    User,
    Smartphone,
    Navigation,
    Loader2,
    AlertTriangle,
    RefreshCw,
    Locate,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { QRPassGenerator } from '../../components/QRPassGenerator';
import { useGeofence } from '../../hooks/useGeofence';
import type { Patient, Appointment } from '../../types/patient';

type Step = 'loading' | 'geofence_check' | 'verify_data' | 'verify_insurance' | 'complete';

const STEPS_ORDER: Step[] = ['geofence_check', 'verify_data', 'verify_insurance', 'complete'];

function formatDistance(meters: number): string {
    if (meters < 1000) return `${meters}m`;
    return `${(meters / 1000).toFixed(1)}km`;
}

function stepIndex(step: Step): number {
    return STEPS_ORDER.indexOf(step);
}

/**
 * Public pre-checkin page. Patient receives this link via WhatsApp
 * 2 hours before their scheduled appointment.
 *
 * Flow: Geofence → Verify Data → Verify Insurance → QR Code
 * URL: /checkin?apt=<appointment_id>
 */
export const PreCheckin: React.FC = () => {
    const params = new URLSearchParams(window.location.search);
    const appointmentId = params.get('apt') || '';
    const locIdParam = params.get('loc') || '';

    const [step, setStep] = useState<Step>('loading');
    const [patient, setPatient] = useState<Patient | null>(null);
    const [appointment, setAppointment] = useState<Appointment | null>(null);
    const [tenantId, setTenantId] = useState<string>('');

    const { result: geoResult, loading: geoLoading, error: geoError, check: geoCheck } = useGeofence(tenantId, locIdParam);

    // Fetch appointment data
    useEffect(() => {
        if (!appointmentId) return;

        (async () => {
            const { data: apt } = await supabase
                .from('appointments')
                .select('*, patient:patients(*)')
                .eq('id', appointmentId)
                .single();

            if (apt) {
                setAppointment(apt as unknown as Appointment);
                setPatient(apt.patient as unknown as Patient);
                setTenantId((apt as any).tenant_id || '');
                setStep('geofence_check');
            }
        })();
    }, [appointmentId]);

    // Auto-check geofence when entering the step
    useEffect(() => {
        if (step === 'geofence_check' && tenantId && !geoResult && !geoLoading) {
            geoCheck();
        }
    }, [step, tenantId, geoResult, geoLoading, geoCheck]);

    // Auto-advance if geofence passes
    useEffect(() => {
        if (geoResult?.allowed) {
            setStep('verify_data');
        }
    }, [geoResult]);

    const handleConfirmData = () => {
        if (patient?.type === 'insurance') {
            setStep('verify_insurance');
        } else {
            handleComplete();
        }
    };

    const handleConfirmInsurance = () => {
        handleComplete();
    };

    const handleComplete = async () => {
        if (appointment) {
            await supabase
                .from('appointments')
                .update({ status: 'confirmed', updated_at: new Date().toISOString() })
                .eq('id', appointment.id);
        }
        setStep('complete');
    };

    if (!appointmentId) {
        return (
            <div className="min-h-screen bg-ice-50 flex items-center justify-center p-6">
                <p className="text-graphite-400 font-medium">Link de check-in inválido.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-ice-50 to-white flex flex-col items-center px-6 py-12">
            {/* Logo / Brand */}
            <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-2xl bg-brand-primary flex items-center justify-center mx-auto mb-3 shadow-lg shadow-brand-primary/20">
                    <Smartphone size={24} className="text-white" />
                </div>
                <h1 className="text-xl font-black text-graphite-900 tracking-tight">
                    Check-in Express
                </h1>
                <p className="text-xs text-graphite-400 font-medium mt-1">
                    Confirme seus dados e evite filas
                </p>
            </div>

            {/* Progress Bar */}
            <div className="w-full max-w-sm flex items-center gap-2 mb-10">
                {STEPS_ORDER.map((s, i) => (
                    <div key={s} className="flex-1">
                        <div className={`h-1.5 rounded-full transition-all duration-500 ${stepIndex(step) >= i ? 'bg-brand-primary' : 'bg-ice-200'
                            }`} />
                    </div>
                ))}
            </div>

            {/* Steps */}
            <div className="w-full max-w-sm">
                {/* Loading */}
                {step === 'loading' && (
                    <div className="animate-pulse space-y-4">
                        <div className="h-40 bg-ice-100 rounded-3xl" />
                        <div className="h-12 bg-ice-100 rounded-xl" />
                    </div>
                )}

                {/* ========== GEOFENCE CHECK ========== */}
                {step === 'geofence_check' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white rounded-3xl border border-ice-200 p-6 shadow-sm">
                            <div className="flex items-center gap-3 mb-5">
                                <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                                    <Navigation size={20} className="text-sky-600" />
                                </div>
                                <div>
                                    <h2 className="font-black text-graphite-900 text-base">Verificação de Proximidade</h2>
                                    <p className="text-[10px] text-graphite-400 font-medium">
                                        Confirme que você está na clínica
                                    </p>
                                </div>
                            </div>

                            {/* Checking State */}
                            {geoLoading && (
                                <div className="flex flex-col items-center py-8 gap-4">
                                    <div className="relative">
                                        <div className="w-20 h-20 rounded-full bg-sky-50 flex items-center justify-center">
                                            <Locate size={32} className="text-sky-500 animate-pulse" />
                                        </div>
                                        <div className="absolute inset-0 w-20 h-20 rounded-full border-2 border-sky-300 animate-ping opacity-30" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm font-bold text-graphite-700">Localizando...</p>
                                        <p className="text-[10px] text-graphite-400 font-medium mt-1">
                                            Verificando sua proximidade com a clínica
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Error State */}
                            {!geoLoading && geoError && (
                                <div className="flex flex-col items-center py-6 gap-4">
                                    <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
                                        <AlertTriangle size={28} className="text-amber-500" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm font-bold text-graphite-700">Localização indisponível</p>
                                        <p className="text-xs text-graphite-400 font-medium mt-1 max-w-[260px]">
                                            {geoError}
                                        </p>
                                    </div>
                                    <button
                                        onClick={geoCheck}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-brand-primary text-white rounded-xl text-xs font-black border-none cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform"
                                    >
                                        <RefreshCw size={14} />
                                        Tentar Novamente
                                    </button>
                                    <p className="text-[9px] text-graphite-300 text-center font-medium max-w-[240px]">
                                        Ative a localização no navegador ou conecte-se ao WiFi da clínica
                                    </p>
                                </div>
                            )}

                            {/* Out of Range State */}
                            {!geoLoading && geoResult && !geoResult.allowed && (
                                <div className="flex flex-col items-center py-6 gap-4">
                                    <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                                        <MapPin size={28} className="text-red-500" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm font-bold text-graphite-700">Fora da área da clínica</p>
                                        <p className="text-xs text-graphite-400 font-medium mt-1">
                                            Você está a <span className="font-black text-graphite-700">{formatDistance(geoResult.distance)}</span> de:
                                            <br />
                                            <span className="text-brand-primary font-bold">{geoResult.matchedLocation?.name || geoResult.clinicName || 'Unidade Principal'}</span>
                                        </p>
                                        {geoResult.matchedLocation && (
                                            <p className="text-[10px] text-graphite-300 mt-1">
                                                Raio permitido: {formatDistance(geoResult.radiusUsed)}
                                            </p>
                                        )}
                                    </div>

                                    {/* Distance Bar */}
                                    <div className="w-full max-w-[260px]">
                                        <div className="flex items-center justify-between text-[9px] text-graphite-400 font-bold mb-1">
                                            <span>Você</span>
                                            <span>{geoResult.matchedLocation?.name || 'Clínica'}</span>
                                        </div>
                                        <div className="h-2 bg-ice-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-red-400 to-red-500 rounded-full transition-all duration-700"
                                                style={{ width: `${Math.min(100, (geoResult.radiusUsed / geoResult.distance) * 100)}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* Source Badge */}
                                    {geoResult.coordinates && (
                                        <span className="px-2 py-1 bg-ice-50 rounded-lg text-[9px] font-bold text-graphite-400 border border-ice-200">
                                            📡 {geoResult.coordinates.source === 'gps' ? 'GPS Preciso' : `IP (${geoResult.coordinates.source})`}
                                        </span>
                                    )}

                                    <button
                                        onClick={geoCheck}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-brand-primary text-white rounded-xl text-xs font-black border-none cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform mt-2"
                                    >
                                        <RefreshCw size={14} />
                                        Verificar Novamente
                                    </button>
                                    <p className="text-[9px] text-graphite-300 text-center font-medium">
                                        Aproxime-se da unidade para liberar o check-in
                                    </p>
                                </div>
                            )}

                            {/* Success State (auto-advances, shown briefly) */}
                            {!geoLoading && geoResult?.allowed && (
                                <div className="flex flex-col items-center py-6 gap-3">
                                    <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                                        <CheckCircle2 size={28} className="text-emerald-500" />
                                    </div>
                                    <p className="text-sm font-bold text-emerald-700 flex items-center gap-1.5">
                                        <Loader2 size={14} className="animate-spin" />
                                        Chegou em: {geoResult.matchedLocation?.name || geoResult.clinicName}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ========== VERIFY DATA ========== */}
                {step === 'verify_data' && patient && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Geofence Confirmed Badge */}
                        {geoResult?.allowed && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 rounded-xl border border-emerald-200">
                                <Navigation size={14} className="text-emerald-600" />
                                <span className="text-[10px] font-black text-emerald-700 uppercase">
                                    Proximidade confirmada: {geoResult.matchedLocation?.name || geoResult.clinicName}
                                    {geoResult.coordinates && ` • ${geoResult.coordinates.source === 'gps' ? 'GPS' : 'IP'}`}
                                </span>
                            </div>
                        )}

                        <div className="bg-white rounded-3xl border border-ice-200 p-6 shadow-sm">
                            <div className="flex items-center gap-3 mb-5">
                                <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center">
                                    <User size={20} className="text-brand-primary" />
                                </div>
                                <div>
                                    <h2 className="font-black text-graphite-900 text-base">Seus Dados</h2>
                                    <p className="text-[10px] text-graphite-400 font-medium">Confirme se estão corretos</p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between py-2 border-b border-ice-50">
                                    <span className="text-xs font-bold text-graphite-400">Nome</span>
                                    <span className="text-sm font-bold text-graphite-900">{patient.full_name}</span>
                                </div>
                                <div className="flex justify-between py-2 border-b border-ice-50">
                                    <span className="text-xs font-bold text-graphite-400">CPF</span>
                                    <span className="text-sm font-bold text-graphite-900">{patient.cpf || '---'}</span>
                                </div>
                                <div className="flex justify-between py-2 border-b border-ice-50">
                                    <span className="text-xs font-bold text-graphite-400">Celular</span>
                                    <span className="text-sm font-bold text-graphite-900">{patient.mobile || patient.phone || '---'}</span>
                                </div>
                                <div className="flex justify-between py-2">
                                    <span className="text-xs font-bold text-graphite-400">Email</span>
                                    <span className="text-sm font-bold text-graphite-900">{patient.email || '---'}</span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleConfirmData}
                            className="w-full py-4 bg-brand-primary text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-transform border-none cursor-pointer"
                        >
                            <CheckCircle2 size={18} />
                            Dados Corretos, Continuar
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}

                {/* ========== VERIFY INSURANCE ========== */}
                {step === 'verify_insurance' && patient && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-white rounded-3xl border border-ice-200 p-6 shadow-sm">
                            <div className="flex items-center gap-3 mb-5">
                                <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                                    <ShieldCheck size={20} className="text-sky-600" />
                                </div>
                                <div>
                                    <h2 className="font-black text-graphite-900 text-base">Convênio</h2>
                                    <p className="text-[10px] text-graphite-400 font-medium">Confirme os dados do plano</p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between py-2 border-b border-ice-50">
                                    <span className="text-xs font-bold text-graphite-400">Operadora</span>
                                    <span className="text-sm font-bold text-graphite-900">{patient.insurance_provider || '---'}</span>
                                </div>
                                <div className="flex justify-between py-2">
                                    <span className="text-xs font-bold text-graphite-400">Nº Carteirinha</span>
                                    <span className="text-sm font-bold text-graphite-900">{patient.insurance_card || '---'}</span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleConfirmInsurance}
                            className="w-full py-4 bg-brand-primary text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-transform border-none cursor-pointer"
                        >
                            <CheckCircle2 size={18} />
                            Convênio Correto, Finalizar
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}

                {/* ========== COMPLETE ========== */}
                {step === 'complete' && patient && appointment && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-emerald-50 rounded-3xl border border-emerald-200 p-6 text-center">
                            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                                <CheckCircle2 size={28} className="text-emerald-600" />
                            </div>
                            <h2 className="text-lg font-black text-emerald-900 mb-1">
                                Check-in Concluído!
                            </h2>
                            <p className="text-sm text-emerald-700 font-medium">
                                Apresente o QR Code abaixo na recepção.
                            </p>
                        </div>

                        <QRPassGenerator
                            patientId={patient.id}
                            appointmentId={appointment.id}
                            patientName={patient.full_name}
                        />

                        <div className="bg-white rounded-2xl border border-ice-200 p-4 shadow-sm flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-brand-primary/5 flex items-center justify-center shrink-0">
                                <MapPin size={20} className="text-brand-primary" />
                            </div>
                            <div>
                                <p className="text-xs font-black text-graphite-400 uppercase tracking-wider">
                                    Horário Agendado
                                </p>
                                <p className="text-base font-black text-graphite-900">
                                    {appointment.start_time}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
