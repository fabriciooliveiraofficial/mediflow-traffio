import React, { useState, useEffect } from 'react';
import { X, Calendar, User, MapPin, Stethoscope, CheckCircle2, ChevronRight, Loader2, CreditCard, Copy, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';

interface QuickBookingModalProps {
    isOpen: boolean;
    onClose: () => void;
    patientId: string;
    patientName: string;
}

export const QuickBookingModal: React.FC<QuickBookingModalProps> = ({ isOpen, onClose, patientId, patientName }) => {
    const { tenant } = useTenant();
    const { showToast } = useToast();
    
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [doctors, setDoctors] = useState<any[]>([]);
    const [locations, setLocations] = useState<any[]>([]);
    const [services, setServices] = useState<any[]>([]);
    const [availableDates, setAvailableDates] = useState<any[]>([]);
    
    const [selectedDoctor, setSelectedDoctor] = useState<string>('');
    const [selectedLocation, setSelectedLocation] = useState<string>('');
    const [selectedService, setSelectedService] = useState<any>(null);
    const [selectedSlot, setSelectedSlot] = useState<any>(null);
    const [paymentLink, setPaymentLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // 1. Initial Load
    useEffect(() => {
        if (!isOpen || !tenant?.id) return;
        loadInitialData();
    }, [isOpen, tenant?.id]);

    const loadInitialData = async () => {
        setLoading(true);
        try {
            const [docsRes, locsRes] = await Promise.all([
                supabase.from('doctors').select('id, full_name, specialty').eq('tenant_id', tenant!.id).eq('is_active', true),
                supabase.from('locations').select('id, name').eq('tenant_id', tenant!.id)
            ]);
            setDoctors(docsRes.data || []);
            setLocations(locsRes.data || []);
            if (locsRes.data?.length === 1) setSelectedLocation(locsRes.data[0].id);
        } finally {
            setLoading(false);
        }
    };

    // 2. Load Services when Doctor selected
    useEffect(() => {
        if (!selectedDoctor) return;
        loadDoctorServices();
    }, [selectedDoctor]);

    const loadDoctorServices = async () => {
        const { data } = await supabase
            .from('doctor_services')
            .select('service_id, appointment_types(*)')
            .eq('doctor_id', selectedDoctor);
        
        const validServices = data?.map((d: any) => d.appointment_types).filter(Boolean) || [];
        setServices(validServices);
    };

    // 3. Load Slots when Service/Location selected
    useEffect(() => {
        if (!selectedDoctor || !selectedService || !selectedLocation) return;
        loadSlots();
    }, [selectedDoctor, selectedService, selectedLocation]);

    const loadSlots = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('find_next_available_dates', {
                p_doctor_id: selectedDoctor,
                p_duration_minutes: selectedService.duration_minutes || 30,
                p_limit: 7
            });
            setAvailableDates(data || []);
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmBooking = async () => {
        if (!selectedSlot || !selectedService || !tenant?.id) return;
        setLoading(true);
        try {
            const { data: booking, error } = await supabase.from('appointments').insert({
                tenant_id: tenant.id,
                doctor_id: selectedDoctor,
                patient_id: patientId,
                location_id: selectedLocation,
                appointment_type_id: selectedService.id,
                date: selectedSlot.date,
                start_time: selectedSlot.time,
                end_time: calculateEndTime(selectedSlot.time, selectedService.duration_minutes),
                status: 'confirmed'
            }).select().single();

            if (error) throw error;

            showToast('success', 'Agendamento realizado com sucesso!');
            
            // Simular geração de link de pagamento
            setPaymentLink(`https://checkout.traffio.com/pay/${booking.id}`);
            setStep(4);
        } catch (e: any) {
            showToast('error', 'Erro ao agendar: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const calculateEndTime = (start: string, duration: number = 30) => {
        const [h, m] = start.split(':').map(Number);
        const total = h * 60 + m + duration;
        const nh = Math.floor(total / 60);
        const nm = total % 60;
        return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
    };

    const copyToClipboard = () => {
        if (!paymentLink) return;
        navigator.clipboard.writeText(`Olá ${patientName}, aqui está o seu link para confirmação do agendamento: ${paymentLink}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]" />
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                        className="fixed inset-0 z-[110] flex items-center justify-center p-4"
                    >
                        <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden border border-ice-100 flex flex-col max-h-[90vh]">
                            {/* Header */}
                            <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50 shrink-0">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                                        <Calendar size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-graphite-900 tracking-tight">Agendamento Expresso</h3>
                                        <p className="text-sm text-graphite-400 font-medium">Paciente: <span className="text-graphite-900 font-bold">{patientName}</span></p>
                                    </div>
                                </div>
                                <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 transition-all hover:text-red-500">
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Steps Indicator */}
                            <div className="px-8 py-3 bg-white flex items-center gap-1 border-b border-ice-50">
                                {[1, 2, 3, 4].map(s => (
                                    <div key={s} className={clsx("h-1 flex-1 rounded-full", step >= s ? "bg-brand-primary" : "bg-ice-100")} />
                                ))}
                            </div>

                            <div className="flex-1 overflow-y-auto p-8 no-scrollbar">
                                {/* Step 1: Doctor & Location */}
                                {step === 1 && (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-3">
                                                <label className="text-xs font-black text-graphite-700 uppercase tracking-widest flex items-center gap-2">
                                                    <User size={14} className="text-brand-primary" /> Profissional
                                                </label>
                                                <div className="grid gap-2">
                                                    {doctors.map(doc => (
                                                        <button key={doc.id} onClick={() => setSelectedDoctor(doc.id)}
                                                            className={clsx("w-full p-4 rounded-2xl border text-left flex items-center gap-3 transition-all", selectedDoctor === doc.id ? "border-brand-primary bg-brand-primary/5 ring-2 ring-brand-primary/10" : "border-ice-200 bg-ice-50/30 hover:border-brand-primary/30")}
                                                        >
                                                            <div className="w-10 h-10 rounded-full bg-ice-100 flex items-center justify-center">
                                                                <Stethoscope size={18} className="text-graphite-400" />
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-graphite-900">{doc.full_name}</p>
                                                                <p className="text-[10px] text-graphite-400 font-bold uppercase">{doc.specialty || 'Geral'}</p>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="space-y-3">
                                                <label className="text-xs font-black text-graphite-700 uppercase tracking-widest flex items-center gap-2">
                                                    <MapPin size={14} className="text-brand-primary" /> Unidade
                                                </label>
                                                <div className="grid gap-2">
                                                    {locations.map(loc => (
                                                        <button key={loc.id} onClick={() => setSelectedLocation(loc.id)}
                                                            className={clsx("w-full p-4 rounded-2xl border text-left flex items-center gap-3 transition-all", selectedLocation === loc.id ? "border-brand-primary bg-brand-primary/5 ring-2 ring-brand-primary/10" : "border-ice-200 bg-ice-50/30 hover:border-brand-primary/30")}
                                                        >
                                                            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                                                                <MapPin size={18} className="text-brand-primary" />
                                                            </div>
                                                            <p className="text-sm font-bold text-graphite-900">{loc.name}</p>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                        <button disabled={!selectedDoctor || !selectedLocation} onClick={() => setStep(2)} className="w-full bg-brand-primary text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-30">
                                            Próximo Passo <ChevronRight size={18} />
                                        </button>
                                    </div>
                                )}

                                {/* Step 2: Service */}
                                {step === 2 && (
                                    <div className="space-y-6">
                                        <div className="space-y-3">
                                            <label className="text-xs font-black text-graphite-700 uppercase tracking-widest">Procedimento / Categoria</label>
                                            <div className="grid grid-cols-1 gap-2">
                                                {services.length === 0 ? (
                                                    <p className="text-sm text-graphite-400 text-center py-8">Carregando serviços...</p>
                                                ) : services.map(s => (
                                                    <button key={s.id} onClick={() => setSelectedService(s)}
                                                        className={clsx("w-full p-4 rounded-2xl border text-left flex items-center justify-between transition-all", selectedService?.id === s.id ? "border-brand-primary bg-brand-primary/5 ring-2 ring-brand-primary/10" : "border-ice-200 bg-ice-50/30 hover:border-brand-primary/30")}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                                                                <Stethoscope size={18} className="text-brand-primary" />
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-graphite-900">{s.name}</p>
                                                                <p className="text-[10px] text-graphite-400 font-bold uppercase">{s.duration_minutes} min</p>
                                                            </div>
                                                        </div>
                                                        <p className="text-sm font-black text-emerald-600">R$ {s.price || '0,00'}</p>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex gap-3">
                                            <button onClick={() => setStep(1)} className="flex-1 border border-ice-200 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 text-graphite-500">Voltar</button>
                                            <button disabled={!selectedService} onClick={() => setStep(3)} className="flex-[2] bg-brand-primary text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-30">
                                                Ver Disponibilidade <ChevronRight size={18} />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Step 3: Slots */}
                                {step === 3 && (
                                    <div className="space-y-6">
                                        <div className="space-y-3">
                                            <label className="text-xs font-black text-graphite-700 uppercase tracking-widest text-center block">Horários Disponíveis</label>
                                            {loading ? (
                                                <div className="flex flex-col items-center justify-center py-12 gap-3 text-brand-primary">
                                                    <Loader2 className="animate-spin" size={32} />
                                                    <p className="text-sm font-bold animate-pulse">Sincronizando agendas...</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-6">
                                                    {availableDates.map(day => (
                                                        <div key={day.date} className="space-y-2">
                                                            <p className="text-[11px] font-black text-graphite-400 uppercase tracking-widest px-2">{new Date(day.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                {(day.slots || [])
                                                                    .filter((s: any) => s.available)
                                                                    .map((slot: any) => (
                                                                        <button key={slot.time} onClick={() => setSelectedSlot({ date: day.date, time: slot.time })}
                                                                            className={clsx("px-4 py-2 rounded-xl text-xs font-black border transition-all", selectedSlot?.date === day.date && selectedSlot?.time === slot.time ? "bg-brand-primary text-white border-brand-primary shadow-lg shadow-brand-primary/20" : "bg-ice-50 text-graphite-700 border-ice-200 hover:border-brand-primary hover:text-brand-primary")}
                                                                        >
                                                                            {slot.time}
                                                                        </button>
                                                                    ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex gap-3">
                                            <button onClick={() => setStep(2)} className="flex-1 border border-ice-200 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 text-graphite-500">Voltar</button>
                                            <button disabled={!selectedSlot || loading} onClick={handleConfirmBooking} className="flex-[2] bg-brand-primary text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-30">
                                                Confirmar Agendamento <CheckCircle2 size={18} />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Step 4: Payment Link */}
                                {step === 4 && (
                                    <div className="space-y-8 py-4 flex flex-col items-center">
                                        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-2">
                                            <CheckCircle2 size={40} />
                                        </div>
                                        <div className="text-center space-y-2">
                                            <h4 className="text-2xl font-black text-graphite-900">Agendado com Sucesso!</h4>
                                            <p className="text-sm text-graphite-400 max-w-sm">O horário foi reservado. Agora você pode enviar o link de pagamento para o paciente confirmar.</p>
                                        </div>

                                        <div className="w-full bg-ice-50 p-6 rounded-3xl border border-ice-100 space-y-4">
                                            <label className="text-[10px] font-black text-graphite-400 uppercase tracking-widest text-center block">Link de Pagamento Gerado</label>
                                            <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-ice-200">
                                                <CreditCard className="text-brand-primary shrink-0" size={20} />
                                                <p className="text-xs font-bold text-graphite-900 truncate flex-1">{paymentLink}</p>
                                                <button onClick={copyToClipboard} className={clsx("p-2 rounded-xl transition-all", copied ? "bg-emerald-500 text-white" : "bg-ice-50 text-graphite-400 hover:text-brand-primary")}>
                                                    {copied ? <Check size={18} /> : <Copy size={18} />}
                                                </button>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={copyToClipboard} className="flex-1 py-3 bg-white text-graphite-700 border border-ice-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-ice-50 transition-colors">
                                                    Copiar Mensagem
                                                </button>
                                                <button onClick={onClose} className="flex-1 py-3 bg-brand-primary text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-brand-primary/90 transition-colors shadow-lg shadow-brand-primary/20">
                                                    Fechar
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
