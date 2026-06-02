import { useState, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import {
    Calendar as CalendarIcon,
    User,
    Stethoscope,
    ChevronRight,
    ChevronLeft,
    Clock,
    CheckCircle2,
    AlertCircle,
    MapPin,
    Shield
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { smartSchedulingService, type SmartSlot } from '../../services/smartSchedulingService';
import { appointmentService } from '../../services/appointmentService';
import { motion, AnimatePresence } from 'framer-motion';

type Step = 'specialty' | 'location' | 'doctor' | 'datetime' | 'confirm';

interface Specialty {
    name: string;
    count: number;
}

interface Doctor {
    id: string;
    full_name: string;
    specialty: string;
    color?: string;
}

export function PortalBook() {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    // Use context from PatientPortalLayout
    const { tenant: contextTenant } = useOutletContext<{ tenant: any; patient: any }>();

    const [currentStep, setCurrentStep] = useState<Step>('specialty');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tenant, setTenant] = useState<any>(contextTenant);

    // Selection State
    const [specialties, setSpecialties] = useState<Specialty[]>([]);
    const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
    const [locations, setLocations] = useState<any[]>([]);
    const [selectedLocation, setSelectedLocation] = useState<any | null>(null);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [availableSlots, setAvailableSlots] = useState<SmartSlot[]>([]);
    const [selectedSlot, setSelectedSlot] = useState<SmartSlot | null>(null);
    const [bookingLoading, setBookingLoading] = useState(false);

    const [searchParams] = useSearchParams();
    const rescheduleId = searchParams.get('reschedule');
    const [rescheduleApt, setRescheduleApt] = useState<any>(null);

    useEffect(() => {
        if (contextTenant) {
            setTenant(contextTenant);
            fetchSpecialties(contextTenant.id);
        }
        if (rescheduleId) {
            fetchRescheduleApt(rescheduleId);
        }
    }, [contextTenant, rescheduleId]);

    const fetchRescheduleApt = async (id: string) => {
        const { data } = await supabase.from('appointments')
            .select('*, doctor:doctors(*)')
            .eq('id', id)
            .single();
        if (data) setRescheduleApt(data);
    };

    const fetchSpecialties = async (tenantId: string) => {
        try {
            setLoading(true);
            // Get Unique Specialties from active doctors
            const { data: docData, error: dError } = await supabase
                .from('doctors')
                .select('specialty')
                .eq('tenant_id', tenantId)
                .eq('is_active', true);

            if (dError) throw dError;

            const specMap = new Map<string, number>();
            docData.forEach(d => {
                if (d.specialty) {
                    specMap.set(d.specialty, (specMap.get(d.specialty) || 0) + 1);
                }
            });

            const specList = Array.from(specMap.entries()).map(([name, count]) => ({ name, count }));
            setSpecialties(specList);
        } catch (err: any) {
            console.error('Error fetching specialties:', err);
            setError('Erro ao carregar especialidades.');
        } finally {
            setLoading(false);
        }
    };

    const handleSpecialtySelect = async (specialty: string) => {
        setSelectedSpecialty(specialty);
        setLoading(true);
        try {
            // 1. Get IDs of active doctors for this specialty
            const { data: doctorData } = await supabase
                .from('doctors')
                .select('id')
                .eq('tenant_id', tenant.id)
                .eq('specialty', specialty)
                .eq('is_active', true);

            const docIds = doctorData?.map(d => d.id) || [];

            if (docIds.length === 0) {
                setLocations([]);
                setCurrentStep('location');
                return;
            }

            // 2. Get IDs of locations where these doctors are available
            const { data: availabilityData } = await supabase
                .from('doctor_availability')
                .select('location_id')
                .eq('tenant_id', tenant.id)
                .in('doctor_id', docIds);

            const locIds = Array.from(new Set(availabilityData?.map(a => a.location_id).filter(Boolean))) as string[];

            if (locIds.length === 0) {
                setLocations([]);
                setCurrentStep('location');
                return;
            }

            // 3. Fetch location details
            const { data, error: lError } = await supabase
                .from('locations')
                .select('*')
                .eq('tenant_id', tenant.id)
                .eq('is_active', true)
                .in('id', locIds);

            if (lError) throw lError;
            setLocations(data || []);

            // If only one location, skip to doctor
            if (data && data.length === 1) {
                handleLocationSelect(data[0], specialty);
            } else {
                setCurrentStep('location');
            }
        } catch (err) {
            console.error('Error in handleSpecialtySelect:', err);
            setError('Erro ao carregar localidades.');
        } finally {
            setLoading(false);
        }
    };

    const handleLocationSelect = async (location: any, specialtyOverride?: string) => {
        const specialtyToUse = specialtyOverride || selectedSpecialty;

        setSelectedLocation(location);
        setLoading(true);
        try {
            // Fetch doctors with selected specialty AT this location
            // We join via doctor_availability to ensure the doctor works there
            const { data: availabilityData, error: aError } = await supabase
                .from('doctor_availability')
                .select('doctor_id')
                .eq('tenant_id', tenant.id)
                .eq('location_id', location.id);

            if (aError) throw aError;

            const docIds = Array.from(new Set(availabilityData?.map(a => a.doctor_id)));

            const { data, error } = await supabase
                .from('doctors')
                .select('id, full_name, specialty, color')
                .eq('tenant_id', tenant.id)
                .eq('specialty', specialtyToUse)
                .eq('is_active', true)
                .in('id', docIds);

            if (error) throw error;
            setDoctors(data || []);
            setCurrentStep('doctor');
        } catch (err) {
            console.error('Error in handleLocationSelect:', err);
            setError('Erro ao carregar profissionais.');
        } finally {
            setLoading(false);
        }
    };

    const handleDoctorSelect = async (doctor: Doctor) => {
        setSelectedDoctor(doctor);
        setCurrentStep('datetime');
        fetchSlots(doctor.id, selectedDate);
    };

    const fetchSlots = async (doctorId: string, date: string) => {
        setLoading(true);
        try {
            const slots = await smartSchedulingService.getAvailableSlots(doctorId, date, tenant.id);
            // Filter slots by selected location
            const filteredSlots = slots.filter(s => s.location_id === selectedLocation?.id);
            setAvailableSlots(filteredSlots);
        } catch (err) {
            setError('Erro ao carregar horários disponíveis.');
        } finally {
            setLoading(false);
        }
    };

    const handleDateChange = (date: string) => {
        setSelectedDate(date);
        if (selectedDoctor) {
            fetchSlots(selectedDoctor.id, date);
        }
    };

    const handleSlotLock = async (slot: SmartSlot) => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('lock_slot', {
                p_tenant_id: tenant.id,
                p_doctor_id: selectedDoctor?.id,
                p_date: selectedDate,
                p_time: slot.slot_time
            });

            if (error) throw error;
            if (!data.success) {
                setError(data.message || 'Este horário acabou de ser reservado. Por favor, escolha outro.');
                // Refresh slots
                if (selectedDoctor) fetchSlots(selectedDoctor.id, selectedDate);
                return;
            }

            setSelectedSlot(slot);
            setCurrentStep('confirm');
        } catch (err) {
            setError('Erro ao reservar horário.');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmBooking = async () => {
        if (!selectedDoctor || !selectedSlot || !tenant) return;

        setBookingLoading(true);
        try {
            // 1. Get current patient profile
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Usuário não autenticado');

            const { data: patient, error: pError } = await supabase
                .from('patients')
                .select('id, insurance_provider, phone')
                .eq('user_id', user.id)
                .single();

            if (pError) throw pError;

            // 2. Book appointment
            await smartSchedulingService.bookAppointment({
                tenant_id: tenant.id,
                doctor_id: selectedDoctor.id,
                patient_id: patient.id,
                date: selectedDate,
                start_time: selectedSlot.slot_time,
                end_time: selectedSlot.slot_end,
                patient_type: patient.insurance_provider ? 'insurance' : 'private',
                slot_type: selectedSlot.block_type === 'prime' ? 'prime' : 'regular'
            });

            // 3. Cancel old appointment if rescheduling
            if (rescheduleId && rescheduleApt) {
                const phone = patient.phone || '';
                await appointmentService.cancelAppointment(
                    rescheduleId,
                    phone,
                    rescheduleApt.doctor?.cancellation_policy,
                    rescheduleApt.date,
                    rescheduleApt.start_time
                );
            }

            setCurrentStep('confirm'); // Could show success screen
            navigate(`/portal/${slug}/dashboard`, { state: { bookingSuccess: true, rescheduled: !!rescheduleId } });
        } catch (err) {
            console.error('Booking error:', err);
            setError('Erro ao confirmar agendamento.');
        } finally {
            setBookingLoading(false);
        }
    };

    if (loading && currentStep === 'specialty') {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto py-8 px-4">
            {/* Step Progress */}
            <div className="mb-12">
                <div className="flex items-center justify-between relative">
                    <div className="absolute top-1/2 left-0 w-full h-0.5 bg-gray-100 -translate-y-1/2 z-0" />
                    <div
                        className="absolute top-1/2 left-0 h-0.5 bg-brand-primary -translate-y-1/2 z-0 transition-all duration-500"
                        style={{
                            width: currentStep === 'specialty' ? '0%' :
                                currentStep === 'location' ? '25%' :
                                    currentStep === 'doctor' ? '50%' :
                                        currentStep === 'datetime' ? '75%' : '100%'
                        }}
                    />

                    {[
                        { id: 'specialty', icon: Stethoscope, label: 'Especialidade' },
                        { id: 'location', icon: MapPin, label: 'Unidade' },
                        { id: 'doctor', icon: User, label: 'Profissional' },
                        { id: 'datetime', icon: CalendarIcon, label: 'Data e Hora' },
                        { id: 'confirm', icon: CheckCircle2, label: 'Confirmação' }
                    ].map((s, idx) => {
                        const Icon = s.icon;
                        const isCompleted = idx < ['specialty', 'location', 'doctor', 'datetime', 'confirm'].indexOf(currentStep);
                        const isActive = s.id === currentStep;

                        return (
                            <div key={s.id} className="relative z-10 flex flex-col items-center">
                                <div className={`
                  w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300
                  ${isCompleted ? 'bg-brand-primary text-white' :
                                        isActive ? 'bg-white border-2 border-brand-primary text-brand-primary shadow-lg shadow-brand-primary/20 scale-110' :
                                            'bg-white border-2 border-gray-200 text-gray-400'}
                `}>
                                    {isCompleted ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                                </div>
                                <span className={`mt-2 text-xs font-medium ${isActive ? 'text-brand-primary' : 'text-gray-500'}`}>
                                    {s.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {error && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700"
                >
                    <AlertCircle className="shrink-0 mt-0.5" size={20} />
                    <div className="flex-1">
                        <p className="text-sm font-medium">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
                        <ChevronRight size={20} className="rotate-90" />
                    </button>
                </motion.div>
            )}

            {/* Wizard Content */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={currentStep}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                >
                    {currentStep === 'specialty' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {specialties.map((s) => (
                                <button
                                    key={s.name}
                                    onClick={() => handleSpecialtySelect(s.name)}
                                    className="group relative p-6 bg-white border border-gray-100 rounded-2xl hover:border-brand-primary/50 hover:shadow-xl hover:shadow-brand-primary/5 transition-all text-left overflow-hidden"
                                >
                                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                        <Stethoscope size={64} />
                                    </div>
                                    <div className="w-12 h-12 bg-brand-primary/10 rounded-xl flex items-center justify-center text-brand-primary mb-4 group-hover:scale-110 transition-transform">
                                        <Stethoscope size={24} />
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-900 mb-1">{s.name}</h3>
                                    <p className="text-sm text-gray-500 font-medium">{s.count} {s.count === 1 ? 'profissional' : 'profissionais'}</p>
                                    <div className="mt-4 flex items-center text-brand-primary text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                                        Selecionar <ChevronRight size={16} className="ml-1" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {currentStep === 'location' && (
                        <div className="space-y-6">
                            <button
                                onClick={() => setCurrentStep('specialty')}
                                className="flex items-center text-sm font-medium text-gray-500 hover:text-brand-primary transition-colors"
                            >
                                <ChevronLeft size={16} className="mr-1" /> Voltar para especialidades
                            </button>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                {locations.map((loc) => (
                                    <button
                                        key={loc.id}
                                        onClick={() => handleLocationSelect(loc)}
                                        className="group relative p-6 bg-white border border-gray-100 rounded-2xl hover:border-brand-primary/50 hover:shadow-xl hover:shadow-brand-primary/5 transition-all text-left overflow-hidden flex items-center gap-4"
                                    >
                                        <div className="w-12 h-12 bg-brand-primary/10 rounded-xl flex items-center justify-center text-brand-primary group-hover:scale-110 transition-transform">
                                            <MapPin size={24} />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-lg font-bold text-gray-900">{loc.name}</h3>
                                                {loc.type && (
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${loc.type === 'hospital' ? 'bg-rose-100 text-rose-600' :
                                                        loc.type === 'clinica' ? 'bg-sky-100 text-sky-600' :
                                                            'bg-amber-100 text-amber-600'
                                                        }`}>
                                                        {loc.type}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-gray-500 font-medium">{loc.address}</p>
                                            {loc.objectives && loc.objectives.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {loc.objectives.map((obj: string, i: number) => (
                                                        <span key={i} className="text-[10px] font-bold text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded italic">
                                                            {obj}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <ChevronRight className="text-gray-300" size={20} />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {currentStep === 'doctor' && (
                        <div className="space-y-6">
                            <button
                                onClick={() => setCurrentStep('location')}
                                className="flex items-center text-sm font-medium text-gray-500 hover:text-brand-primary transition-colors"
                            >
                                <ChevronLeft size={16} className="mr-1" /> Voltar para unidades
                            </button>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                {doctors.map((d) => (
                                    <button
                                        key={d.id}
                                        onClick={() => handleDoctorSelect(d)}
                                        className="flex items-center gap-4 p-5 bg-white border border-gray-100 rounded-2xl hover:border-brand-primary/50 hover:shadow-xl hover:shadow-brand-primary/5 transition-all text-left"
                                    >
                                        <div
                                            className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg flex-shrink-0"
                                            style={{ backgroundColor: d.color || '#CBD5E1' }}
                                        >
                                            {d.full_name?.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="text-lg font-bold text-gray-900">{d.full_name}</h3>
                                            <p className="text-sm text-gray-500 font-medium">{d.specialty}</p>
                                        </div>
                                        <ChevronRight className="text-gray-300" size={20} />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {currentStep === 'datetime' && (
                        <div className="space-y-8">
                            <button
                                onClick={() => setCurrentStep('doctor')}
                                className="flex items-center text-sm font-medium text-gray-500 hover:text-brand-primary transition-colors"
                            >
                                <ChevronLeft size={16} className="mr-1" /> Voltar para profissionais
                            </button>

                            <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
                                <div className="flex flex-col md:flex-row gap-8">
                                    {/* Miniature Date Picker */}
                                    <div className="md:w-1/3">
                                        <label className="block text-sm font-bold text-gray-900 mb-4">Selecione a Data</label>
                                        <input
                                            type="date"
                                            value={selectedDate}
                                            min={new Date().toISOString().split('T')[0]}
                                            onChange={(e) => handleDateChange(e.target.value)}
                                            className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all"
                                        />
                                        <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                                            <div className="flex items-center gap-2 text-blue-700 font-bold mb-1">
                                                <Clock size={16} />
                                                <span className="text-xs uppercase tracking-wider">Lembrete</span>
                                            </div>
                                            <p className="text-xs text-blue-600 leading-relaxed font-medium">
                                                Agendamentos levam cerca de 10 minutos para serem confirmados.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Slots Grid */}
                                    <div className="flex-1">
                                        <label className="block text-sm font-bold text-gray-900 mb-4">Horários Disponíveis</label>
                                        {loading ? (
                                            <div className="flex items-center justify-center py-12">
                                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
                                            </div>
                                        ) : availableSlots.length > 0 ? (
                                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                                {availableSlots.map((slot) => (
                                                    <button
                                                        key={slot.slot_time}
                                                        onClick={() => handleSlotLock(slot)}
                                                        className="p-3 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 hover:border-brand-primary hover:text-brand-primary hover:bg-brand-primary/5 transition-all text-center"
                                                    >
                                                        {slot.slot_time.substring(0, 5)}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center py-12 px-4 bg-gray-50 border border-dashed border-gray-200 rounded-2xl">
                                                <CalendarIcon className="mx-auto text-gray-300 mb-3" size={32} />
                                                <p className="text-sm font-bold text-gray-900 mb-1">Nenhum horário disponível</p>
                                                <p className="text-xs text-gray-500 font-medium">Tente selecionar outra data ou profissional.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {currentStep === 'confirm' && (
                        <div className="max-w-md mx-auto">
                            <div className="bg-white border border-gray-100 rounded-3xl p-8 shadow-xl text-center">
                                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <CheckCircle2 size={32} />
                                </div>
                                <h2 className="text-2xl font-black text-gray-900 mb-2">Quase lá!</h2>
                                <p className="text-gray-500 font-medium mb-8">Confirme os detalhes do seu agendamento abaixo.</p>

                                <div className="text-left space-y-4 mb-8">
                                    <div className="p-4 bg-gray-50 rounded-2xl flex items-center gap-4">
                                        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-brand-primary shadow-sm">
                                            <Stethoscope size={24} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Especialidade</p>
                                            <p className="text-sm font-bold text-gray-900">{selectedSpecialty}</p>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-gray-50 rounded-2xl flex items-center gap-4">
                                        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-brand-primary shadow-sm">
                                            <User size={24} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Profissional</p>
                                            <p className="text-sm font-bold text-gray-900">{selectedDoctor?.full_name}</p>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-gray-50 rounded-2xl flex items-center gap-4">
                                        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-brand-primary shadow-sm">
                                            <CalendarIcon size={24} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Data e Hora</p>
                                            <p className="text-sm font-bold text-gray-900">
                                                {new Date(selectedDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                                            </p>
                                            <p className="text-xs text-gray-500 font-medium">às {selectedSlot?.slot_time.substring(0, 5)}</p>
                                        </div>
                                    </div>

                                    {selectedSlot?.location_name && (
                                        <div className="p-4 bg-gray-50 rounded-2xl flex items-center gap-4">
                                            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-brand-primary shadow-sm">
                                                <MapPin size={24} />
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Local</p>
                                                <p className="text-sm font-bold text-gray-900">{selectedSlot.location_name}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {rescheduleApt && (
                                    <div className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-2xl mb-8 text-left">
                                        <div className="flex items-start gap-3">
                                            <AlertCircle size={20} className="text-orange-500 shrink-0 mt-0.5" />
                                            <div>
                                                <p className="font-bold text-orange-700 text-sm mb-1">Aviso de Reagendamento</p>
                                                <p className="text-orange-600 text-sm leading-relaxed">
                                                    Ao confirmar este novo horário, sua consulta original do dia <strong>{new Date(rescheduleApt.date).toLocaleDateString('pt-BR')}</strong> às <strong>{rescheduleApt.start_time?.substring(0, 5)}</strong> será cancelada automaticamente.
                                                </p>
                                                {appointmentService.checkPenalty(rescheduleApt.doctor?.cancellation_policy, rescheduleApt.date, rescheduleApt.start_time).applies && (
                                                    <div className="mt-3 p-3 bg-rose-50 border border-rose-100 rounded-xl">
                                                        <p className="text-rose-700 font-bold text-sm mb-1">Taxa de Cancelamento Tardio</p>
                                                        <p className="text-rose-600 font-medium text-xs leading-relaxed">
                                                            Como o reagendamento está sendo feito fora do prazo gratuito, será aplicada uma multa de <strong>{rescheduleApt.doctor.cancellation_policy.late_penalty_percent}%</strong> sobre o agendamento anterior.
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="flex flex-col gap-3">
                                    <button
                                        onClick={handleConfirmBooking}
                                        disabled={bookingLoading}
                                        className="w-full py-4 bg-brand-primary text-white rounded-2xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {bookingLoading ? (
                                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                        ) : (
                                            <>Confirmar Agendamento <ChevronRight size={20} /></>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => setCurrentStep('datetime')}
                                        disabled={bookingLoading}
                                        className="w-full py-4 bg-white border border-gray-200 text-gray-600 rounded-2xl font-bold hover:bg-gray-50 transition-all text-sm"
                                    >
                                        Alterar horário
                                    </button>
                                </div>

                                <div className="mt-8 flex items-center justify-center gap-2 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                    <Shield size={12} />
                                    Conexão Segura
                                </div>
                            </div>
                        </div>
                    )}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
