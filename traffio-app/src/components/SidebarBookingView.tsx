import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Stethoscope, CheckCircle2, ChevronRight, Loader2, Copy, Check, ChevronLeft, MapPin, X, CreditCard, Link2, MessageSquare, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { SidebarCalendar } from './shared/SidebarCalendar';
import { format, startOfMonth } from 'date-fns';
import { getTenantNow, getTenantTodayString } from '../lib/timezoneUtils';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { useLocaleFormat } from '../hooks/useLocaleFormat';

const DEFAULT_BOOKING_CAPTIONS = {
    pt: 'Olá {{nome_paciente}}! 😊\nSeu agendamento foi realizado com sucesso!\n\n---------------------------------------------------------------------\n📝 Detalhes da Consulta:\n📅 Data: {{data_agendamento}}\n🕒 Horário: {{horario_agendamento}}\n👨‍⚕️ Profissional: {{nome_do_profissional}}\n📍 Local: {{nome_local}}\n🗺️ Como Chegar: {{link_endereco}}\n\n🔗 SALA DE ESPERA VIRTUAL:\nAcesse para fazer seu check-in na hora da consulta:\n{{link_sala_espera}}\n\n💳 PAGAMENTO / CONFIRMAÇÃO:\nPara garantir sua vaga, realize o pagamento no link:\n{{link_pagamento}}\n\nNos vemos em breve! 💙\n---------------------------------------------------------------------',
    en: 'Hi {{nome_paciente}}! 😊\nYour appointment has been successfully booked!\n\n---------------------------------------------------------------------\n📝 Appointment Details:\n📅 Date: {{data_agendamento}}\n🕒 Time: {{horario_agendamento}}\n👨‍⚕️ Professional: {{nome_do_profissional}}\n📍 Location: {{nome_local}}\n🗺️ How to Get There: {{link_endereco}}\n\n🔗 VIRTUAL WAITING ROOM:\nAccess this link to check-in at the time of your appointment:\n{{link_sala_espera}}\n\n💳 PAYMENT / CONFIRMATION:\nTo secure your spot, please complete the payment here:\n{{link_pagamento}}\n\nSee you soon! 💙\n---------------------------------------------------------------------',
    es: '¡Hola {{nome_paciente}}! 😊\n¡Tu cita ha sido reservada con éxito!\n\n---------------------------------------------------------------------\n📝 Detalles de la Cita:\n📅 Fecha: {{data_agendamento}}\n🕒 Hora: {{horario_agendamento}}\n👨‍⚕️ Profesional: {{nome_do_profissional}}\n📍 Lugar: {{nome_local}}\n🗺️ Cómo llegar: {{link_endereco}}\n\n🔗 SALA DE ESPERA VIRTUAL:\nAccede para hacer tu check-in a la hora de tu cita:\n{{link_sala_espera}}\n\n💳 PAGO / CONFIRMACIÓN:\nPara asegurar tu turno, realiza el pago en el siguiente enlace:\n{{link_pagamento}}\n\n¡Nos vemos pronto! 💙\n---------------------------------------------------------------------',
};

interface SidebarBookingViewProps {
  onBack: () => void;
  patientId: string;
  patientName: string;
  onSendMessage: (text: string) => Promise<void>;
  // Quando presente, a mensagem de confirmação não é enviada direto na conversa:
  // é entregue ao chamador, que abre o seletor de canal (WhatsApp/SMS/Meta/E-mail).
  onConfirmationReady?: (text: string) => void;
  rescheduleFrom?: any;
  preFill?: {
    doctorId: string;
    locationId: string;
    service: any;
    date: string;
    slotTime: string;
  } | null;
  onSuccess?: () => void;
}

export function SidebarBookingView({ onBack, patientId, patientName, onSendMessage, onConfirmationReady, rescheduleFrom, preFill, onSuccess }: SidebarBookingViewProps) {
    const { t } = useTranslation('agenda');
    const { tenant } = useTenant();
    const { showToast } = useToast();
    const { formatSlot } = useLocaleFormat();
    // Quando vem do preFill (Consultar Disponibilidade), já inicia no passo de
    // confirmação — nunca renderiza os passos do Agendamento Expresso, nem por um instante.
    const [step, setStep] = useState(() => preFill ? 4 : 1);
    const [loading, setLoading] = useState(() => !!preFill);
    // When opened from the "Consultar Disponibilidade" flow, professional/procedure/unit/date/slot
    // are already chosen. We then show a confirmation summary instead of repeating the pickers.
    const isPreFilled = !!preFill;

    // Data
    const [doctors, setDoctors] = useState<any[]>([]);
    const [services, setServices] = useState<any[]>([]);
    const [slots, setSlots] = useState<any[]>([]); // Slots for the selected date
    const [availableDates, setAvailableDates] = useState<string[]>([]); // Dates with markers
    
    // Selection
    const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
    const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
    const [selectedService, setSelectedService] = useState<any | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [selectedSlot, setSelectedSlot] = useState<any | null>(null);
    const [paymentLink, setPaymentLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [locations, setLocations] = useState<any[]>([]);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [nowMin, setNowMin] = useState(new Date().getHours() * 60 + new Date().getMinutes());
    const [agendaRange, setAgendaRange] = useState({ start: 0, end: 23 });
    const [includeCheckin, setIncludeCheckin] = useState(false);
    const [includePayment, setIncludePayment] = useState(false);
    const [includeMaps, setIncludeMaps] = useState(false);
    const GRID_PADDING = 16;

    useEffect(() => {
        const interval = setInterval(() => {
            setNowMin(new Date().getHours() * 60 + new Date().getMinutes());
        }, 60000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (tenant?.id) {
            loadDoctors();
            
            if (preFill) {
                handlePreFillInit(preFill);
            } else if (rescheduleFrom) {
                // Pre-fill for rescheduling
                setSelectedDoctor(rescheduleFrom.doctor_id);
                setSelectedLocation(rescheduleFrom.location_id);
                // We need the full service object, but we'll load it via loadServices
                // For now just set the IDs if we can, but loadServices needs to run
                handleRescheduleInit();
            }
        }
    }, [tenant?.id, preFill]);

    const handlePreFillInit = async (data: any) => {
        setLoading(true);
        try {
            // 1. Fetch locations for the doctor to populate the locations list
            const { data: officialMappings } = await supabase
                .from('doctor_locations')
                .select('locations(id, name, google_maps_url)')
                .eq('doctor_id', data.doctorId);
            
            let locs = officialMappings?.map((d: any) => d.locations).filter(Boolean) || [];
            if (locs.length === 0) {
                const { data: serviceMappings } = await supabase
                    .from('doctor_services')
                    .select('locations(id, name, google_maps_url)')
                    .eq('doctor_id', data.doctorId);
                const seen = new Set();
                locs = (serviceMappings?.map((d: any) => d.locations).filter(Boolean) || []).filter(l => {
                    if (seen.has(l.id)) return false;
                    seen.add(l.id);
                    return true;
                });
            }
            if (locs.length === 0) {
                const { data: allLocs } = await supabase
                    .from('locations')
                    .select('id, name, google_maps_url')
                    .eq('tenant_id', tenant?.id)
                    .eq('is_active', true);
                locs = allLocs || [];
            }
            setLocations(locs);

            // 2. Fetch services for the doctor/location to populate the services list
            let query = supabase
                .from('doctor_services')
                .select('appointment_types(*)')
                .eq('doctor_id', data.doctorId);
            if (data.locationId) {
                query = query.eq('location_id', data.locationId);
            }
            const { data: servicesData } = await query;
            const activeServices = (servicesData?.map((d: any) => d.appointment_types).filter(Boolean) || [])
                .filter((s: any) => s.is_active !== false)
                .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
            setServices(activeServices);

            // 3. Hydrate slots calendar markers
            const { data: datesData, error: datesError } = await supabase.rpc('find_next_available_dates', {
                p_doctor_id: data.doctorId,
                p_location_id: data.locationId,
                p_duration_minutes: data.service?.duration_minutes || 15,
                p_limit: 60,
                p_from_date: format(startOfMonth(currentMonth), 'yyyy-MM-dd')
            });
            if (datesError) throw datesError;
            const tz = tenant?.timezone || 'America/Sao_Paulo';
            const todayStr = getTenantTodayString(tz);
            const dates = (datesData || [])
                .map((d: any) => d.date)
                .filter((d: string) => d >= todayStr);
            setAvailableDates(dates);

            // 4. Hydrate slot grid
            const { data: slotsData, error: slotsError } = await supabase.rpc('find_next_available_dates', {
                p_doctor_id: data.doctorId,
                p_location_id: data.locationId,
                p_duration_minutes: data.service?.duration_minutes || 15,
                p_limit: 1,
                p_from_date: data.date
            });
            if (slotsError) throw slotsError;
            
            const dayData = (slotsData || []).find((d: any) => d.date === data.date);
            if (dayData) {
                const now = getTenantNow(tz);
                const currentHours = now.getHours();
                const currentMinutes = now.getMinutes();

                const filteredSlots = (dayData.slots || []).filter((slot: any) => {
                    if (data.date < todayStr) return false;
                    if (data.date === todayStr) {
                        const [h, m] = slot.time.split(':').map(Number);
                        if (h > currentHours) return true;
                        if (h === currentHours && m > currentMinutes) return true;
                        return false;
                    }
                    return true;
                });

                setSlots(filteredSlots);
                
                if (dayData.start_hour !== undefined && dayData.end_hour !== undefined) {
                    setAgendaRange({ 
                        start: Math.max(0, dayData.start_hour),
                        end: Math.min(23, dayData.end_hour + 1)
                    });
                }
            } else {
                setSlots([]);
                setAgendaRange({ start: 7, end: 20 });
            }

            // Set final selections
            setSelectedDoctor(data.doctorId);
            setSelectedLocation(data.locationId);
            setSelectedService(data.service);
            setSelectedDate(data.date);
            setSelectedSlot({ time: data.slotTime, type: 'regular' });
            setStep(4);

        } catch (err) {
            console.error('Error pre-filling booking view:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleRescheduleInit = async () => {
        if (!rescheduleFrom) return;
        setLoading(true);
        try {
            // Load locations for the doctor
            const { data: locs } = await supabase.from('locations').select('id, name, google_maps_url').eq('id', rescheduleFrom.location_id);
            setLocations(locs || []);
            
            // Load the specific service
            const { data: svc } = await supabase
                .from('appointment_types')
                .select('*')
                .eq('id', rescheduleFrom.type_id)
                .single();
            
            setSelectedService(svc);
            setStep(4); // Skip to date selection
        } catch (err) {
            console.error('Error initializing reschedule:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleStepBack = () => {
        switch (step) {
            case 5:
                setStep(4);
                break;
            case 4:
                if (isPreFilled) { onBack(); } else { setStep(3); }
                break;
            case 3:
                setStep(locations.length > 1 ? 2 : 1);
                break;
            case 2:
                setStep(1);
                break;
            case 1:
            default:
                onBack();
                break;
        }
    };

    useEffect(() => {
        if (step === 4 && selectedDoctor && selectedLocation) {
            loadAvailableDatesMarkers();
        }
    }, [step, selectedDoctor, selectedLocation, currentMonth]);

    // Sincronização em tempo real (Supabase Realtime)
    useEffect(() => {
        if (!selectedDoctor || !selectedLocation || !selectedDate) return;

        const channel = supabase
            .channel('sidebar-booking-appointments')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'appointments'
                },
                () => {
                    loadSlotsForDate(selectedDate);
                    loadAvailableDatesMarkers();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [selectedDoctor, selectedLocation, selectedDate]);

    const loadDoctors = async () => {
        const { data } = await supabase
            .from('doctors')
            .select('id, full_name, role, specialty')
            .eq('tenant_id', tenant?.id)
            .eq('is_active', true);
        setDoctors(data || []);
    };

    const loadLocationsForDoctor = async (docId: string) => {
        setLoading(true);
        setSelectedLocation(null);
        setSelectedService(null);
        setSelectedSlot(null);
        setLocations([]);
        setServices([]);
        setSlots([]);
        
        const { data: officialMappings } = await supabase
            .from('doctor_locations')
            .select('locations(id, name, google_maps_url)')
            .eq('doctor_id', docId);
        
        let locs = officialMappings?.map((d: any) => d.locations).filter(Boolean) || [];
        
        if (locs.length === 0) {
            const { data: serviceMappings } = await supabase
                .from('doctor_services')
                .select('locations(id, name, google_maps_url)')
                .eq('doctor_id', docId);
            
            const seen = new Set();
            locs = (serviceMappings?.map((d: any) => d.locations).filter(Boolean) || []).filter(l => {
                if (seen.has(l.id)) return false;
                seen.add(l.id);
                return true;
            });
        }
        
        if (locs.length === 0) {
            const { data: allLocs } = await supabase
                .from('locations')
                .select('id, name, google_maps_url')
                .eq('tenant_id', tenant?.id)
                .eq('is_active', true);
            locs = allLocs || [];
        }

        setLocations(locs);
        
        if (locs.length === 1) {
            setSelectedLocation(locs[0].id);
            loadServices(docId, locs[0].id);
            setStep(3);
        } else {
            setStep(2);
        }
        setLoading(false);
    };

    const loadServices = async (docId: string, locId?: string) => {
        setLoading(true);
        let query = supabase
            .from('doctor_services')
            .select('appointment_types(*)')
            .eq('doctor_id', docId);
        
        if (locId) {
            query = query.eq('location_id', locId);
        }

        const { data } = await query;
        const activeServices = (data?.map((d: any) => d.appointment_types).filter(Boolean) || [])
            .filter((s: any) => s.is_active !== false)
            .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
        setServices(activeServices);
        setLoading(false);
    };

    const loadAvailableDatesMarkers = async () => {
        if (!selectedDoctor || !selectedLocation) return;
        try {
            console.log('[DEBUG] loadAvailableDatesMarkers inputs:', {
                p_doctor_id: selectedDoctor,
                p_location_id: selectedLocation,
                p_duration_minutes: selectedService?.duration_minutes || 15,
                p_from_date: format(startOfMonth(currentMonth), 'yyyy-MM-dd')
            });
            const { data, error } = await supabase.rpc('find_next_available_dates', {
                p_doctor_id: selectedDoctor,
                p_location_id: selectedLocation,
                p_duration_minutes: selectedService?.duration_minutes || 15,
                p_limit: 60,
                p_from_date: format(startOfMonth(currentMonth), 'yyyy-MM-dd')
            });
            console.log('[DEBUG] loadAvailableDatesMarkers result:', { data, error });
            if (error) throw error;
            const tz = tenant?.timezone || 'America/Sao_Paulo';
            const todayStr = getTenantTodayString(tz);
            const dates = (data || [])
                .map((d: any) => d.date)
                .filter((d: string) => d >= todayStr);
            setAvailableDates(dates);
        } catch (err) {
            console.error('Erro ao buscar marcadores:', err);
        }
    };

    const [dragMode, setDragMode] = useState<'selecting' | 'moving' | 'resizing' | null>(null);
    const [dragStartMinutes, setDragStartMinutes] = useState<number | null>(null);
    const [dragInitialBoxStart, setDragInitialBoxStart] = useState<number>(0);
    const [dragInitialMouseMinutes, setDragInitialMouseMinutes] = useState<number>(0);
    const gridContainerRef = useRef<HTMLDivElement>(null);

    const loadSlotsForDate = async (date: string) => {
        setLoading(true);
        setSelectedDate(date);
        setSelectedSlot(null);
        setDragMode(null);
        try {
            console.log('[DEBUG] loadSlotsForDate inputs:', {
                p_doctor_id: selectedDoctor,
                p_location_id: selectedLocation,
                p_duration_minutes: selectedService?.duration_minutes || 15,
                p_from_date: date
            });
            // 1. Fetch available slots using the dense grid RPC
            const { data, error } = await supabase.rpc('find_next_available_dates', {
                p_doctor_id: selectedDoctor,
                p_location_id: selectedLocation,
                p_duration_minutes: selectedService?.duration_minutes || 15,
                p_limit: 1,
                p_from_date: date
            });
            console.log('[DEBUG] loadSlotsForDate RPC response:', { data, error });
            if (error) throw error;
            
            const dayData = (data || []).find((d: any) => d.date === date);
            console.log('[DEBUG] loadSlotsForDate dayData:', dayData);
            if (dayData) {
                const tz = tenant?.timezone || 'America/Sao_Paulo';
                const todayStr = getTenantTodayString(tz);
                const now = getTenantNow(tz);
                const currentHours = now.getHours();
                const currentMinutes = now.getMinutes();

                const filteredSlots = (dayData.slots || []).filter((slot: any) => {
                    if (date < todayStr) return false;
                    if (date === todayStr) {
                        const [h, m] = slot.time.split(':').map(Number);
                        if (h > currentHours) return true;
                        if (h === currentHours && m > currentMinutes) return true;
                        return false;
                    }
                    return true;
                });

                // The updated RPC returns a unified 'slots' array including blocked/occupied status
                setSlots(filteredSlots);
                
                // Use bounds directly from RPC to ensure grid sync
                if (dayData.start_hour !== undefined && dayData.end_hour !== undefined) {
                    setAgendaRange({ 
                        start: Math.max(0, dayData.start_hour), // Start exactly at the first block
                        end: Math.min(23, dayData.end_hour + 1) // End 1 hour after the last block
                    });
                }
            } else {
                setSlots([]);
                setAgendaRange({ start: 7, end: 20 });
            }
        } catch (err) {
            console.error('Erro ao buscar slots e range:', err);
            setSlots([]);
            setAgendaRange({ start: 7, end: 20 });
        } finally {
            setLoading(false);
        }
    };

    const findNextSlot = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('find_next_available_dates', {
                p_doctor_id: selectedDoctor,
                p_location_id: selectedLocation,
                p_duration_minutes: selectedService?.duration_minutes || 15,
                p_limit: 1,
                p_from_date: format(new Date(selectedDate + 'T23:59:59'), 'yyyy-MM-dd')
            });
            if (error) throw error;
            
            if (data && data.length > 0) {
                const nextDate = data[0].date;
                setCurrentMonth(new Date(nextDate + 'T12:00:00'));
                loadSlotsForDate(nextDate);
                showToast('info', t('sidebarBookingView.toasts.skippingToDate', { date: format(new Date(nextDate + 'T12:00:00'), "dd/MM") }));
            } else {
                showToast('warning', t('sidebarBookingView.toasts.noOtherSlotsAvailable'));
            }
        } catch (err) {
            console.error('Erro ao buscar próximo horário:', err);
        } finally {
            setLoading(false);
        }
    };

    const getMinutesFromEvent = (e: React.MouseEvent) => {
      if (!gridContainerRef.current) return 0;
      const rect = gridContainerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - rect.top + gridContainerRef.current.scrollTop - GRID_PADDING;
      const rawMinutes = (relativeY / 80) * 60;
      const absoluteMinutes = rawMinutes + (agendaRange.start * 60);
      return Math.floor(absoluteMinutes / 15) * 15;
    };

    const handleGridMouseDown = (e: React.MouseEvent) => {
      const minutes = getMinutesFromEvent(e);
      const hour = Math.floor(minutes / 60);
      const min = minutes % 60;
      
      const minStr = (Math.floor(min / 15) * 15).toString().padStart(2, '0');
      const timeStr = `${hour.toString().padStart(2, '0')}:${minStr}`;
      const slot = slots.find(s => s.time === timeStr);
      
      // Block selection if slot is missing (blocked/lunch) or occupied
      if (!slot || !slot.available) return;

      setDragMode('selecting');
      setDragStartMinutes(minutes);
      
      setSelectedSlot({ time: timeStr, type: 'regular' });
      // Preserve the existing service duration if it exists, otherwise use 15
      if (selectedService && !selectedService.duration_minutes) {
        setSelectedService({ ...selectedService, duration_minutes: 15 });
      }
    };

    const handleStartMove = (e: React.MouseEvent, startTime: string) => {
      e.stopPropagation();
      const [h, m] = startTime.split(':').map(Number);
      const startMinutes = (h * 60) + m;
      const mouseMinutes = getMinutesFromEvent(e);
      
      setDragMode('moving');
      setDragInitialBoxStart(startMinutes);
      setDragInitialMouseMinutes(mouseMinutes);
    };

    const handleStartResize = (e: React.MouseEvent, startTime: string) => {
      e.stopPropagation();
      const [h, m] = startTime.split(':').map(Number);
      const startMinutes = (h * 60) + m;
      setDragMode('resizing');
      setDragStartMinutes(startMinutes);
    };

    const handleGlobalMouseMove = (e: React.MouseEvent) => {
      if (!dragMode) return;
      const currentMouseMinutes = getMinutesFromEvent(e);
      
      if ((dragMode === 'selecting' || dragMode === 'resizing') && dragStartMinutes !== null) {
        const rawDuration = currentMouseMinutes - dragStartMinutes + 15;
        const snappedDuration = Math.max(15, Math.floor(rawDuration / 15) * 15);
        
        // Validate each 15-min block covered by the new duration
        let isBlocked = false;
        for (let offset = 0; offset < snappedDuration; offset += 15) {
          const checkTime = calculateTimeFromMinutes(dragStartMinutes + offset);
          const [h, m] = checkTime.split(':').map(Number);
          const snappedM = (Math.floor(m / 15) * 15).toString().padStart(2, '0');
          const slotKey = `${h.toString().padStart(2, '0')}:${snappedM}`;
          const slot = slots.find(s => s.time === slotKey);
          if (!slot || !slot.available) {
            isBlocked = true;
            break;
          }
        }

        if (!isBlocked && selectedService) {
          setSelectedService({ ...selectedService, duration_minutes: snappedDuration });
        }
      } else if (dragMode === 'moving') {
        const delta = currentMouseMinutes - dragInitialMouseMinutes;
        const newStart = Math.max(0, dragInitialBoxStart + delta);
        const timeStr = calculateTimeFromMinutes(Math.floor(newStart / 15) * 15); // Snap to 15 mins to match new selection resolution
        
        const slot = slots.find(s => s.time === timeStr);
        if (slot?.available) {
          setSelectedSlot({ time: timeStr, type: 'regular' });
        }
      }
    };

    const handleGridMouseUp = () => {
      setDragMode(null);
      setDragStartMinutes(null);
    };

    const calculateTimeFromMinutes = (totalMinutes: number) => {
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    const calculateEndTime = (startTime: string, durationMinutes: number) => {
        const [hours, minutes] = startTime.split(':').map(Number);
        const date = new Date(2000, 0, 1, hours, minutes);
        date.setMinutes(date.getMinutes() + durationMinutes);
        return format(date, 'HH:mm');
    };

    const handleConfirmBooking = async () => {
        if (!selectedSlot || !selectedService || !tenant?.id) return;
        setLoading(true);
        try {

            // 2. If rescheduling, clear the old slot FIRST to avoid overlap constraint violation
            // Note: Postgres constraint now unified to 'canceled' (American spelling)
            if (rescheduleFrom?.id) {
                await supabase.from('appointments').update({
                    status: 'canceled',
                    notes: t('sidebarBookingView.rescheduleNote', { date: selectedDate, time: selectedSlot.time })
                }).eq('id', rescheduleFrom.id);
            }

            let bookingId = '';

            // 3. Insert new appointment using concurrency-safe RPC
            const { data, error } = await supabase.rpc('book_appointment', {
                p_tenant_id: tenant.id,
                p_patient_id: patientId,
                p_doctor_id: selectedDoctor,
                p_location_id: selectedLocation,
                p_type_id: selectedService.id,
                p_date: selectedDate,
                p_start_time: selectedSlot.time,
                p_booked_by: 'user'
            });

            if (error) throw error;

            if (data && typeof data === 'object') {
                const res = data as { success: boolean; appointment_id?: string; reason?: string };
                if (!res.success) {
                    if (res.reason === 'slot_taken') {
                        throw new Error(t('sidebarBookingView.errors.slotTaken'));
                    }
                    throw new Error(res.reason || t('sidebarBookingView.errors.unknown'));
                }
                bookingId = res.appointment_id || '';
            } else {
                throw new Error(t('sidebarBookingView.errors.invalidResponse'));
            }

            const baseUrl = window.location.origin;
            const payLink = `https://checkout.traffio.com/pay/${bookingId}`;
            const checkinLink = `${baseUrl}/checkin?apt=${bookingId}&loc=${selectedLocation}`;
            
            setPaymentLink(payLink);
            setStep(5);
            showToast('success', rescheduleFrom ? t('sidebarBookingView.toasts.rescheduleCompleted') : t('sidebarBookingView.toasts.bookingCompleted'));

            const firstName = patientName.split(' ')[0];
            const dateStr = format(new Date(selectedDate + 'T12:00:00'), "dd/MM/yyyy");
            const doctorName = doctors.find(d => d.id === selectedDoctor)?.full_name || t('sidebarBookingView.professionalFallback');
            const location = locations.find(l => l.id === selectedLocation);
            const locationName = location?.name || '';
            const mapsUrl = location?.google_maps_url;

            const botConfig = tenant?.bot_config;
            const outboundLocale = botConfig?.notification_locale || 'pt';
            const templates = botConfig?.booking_confirmation_captions || DEFAULT_BOOKING_CAPTIONS;
            let template = templates[outboundLocale] || templates['pt'];

            // Adjust template if rescheduling
            if (rescheduleFrom) {
                template = template
                    .replace(/agendamento foi realizado com sucesso/gi, 'reagendamento foi realizado com sucesso')
                    .replace(/appointment has been successfully booked/gi, 'appointment has been successfully rescheduled')
                    .replace(/cita ha sido reservada con éxito/gi, 'cita ha sido reprogramada con éxito');
            }

            // Split template into blocks by double newlines to filter checkin/payment/maps sections
            const blocks = template.split('\n\n');
            const filteredBlocks = blocks.map(block => {
                if (block.includes('{{link_sala_espera}}') && !includeCheckin) {
                    return null;
                }
                if (block.includes('{{link_pagamento}}') && !includePayment) {
                    return null;
                }
                
                let lines = block.split('\n');
                if (!includeMaps || !mapsUrl) {
                    lines = lines.filter(line => !line.includes('{{link_endereco}}'));
                }
                return lines.join('\n');
            }).filter(b => b !== null);

            let message = filteredBlocks.join('\n\n');

            // Replace variables
            const replacements: Record<string, string> = {
                '{{nome_paciente}}': firstName,
                '{{data_agendamento}}': dateStr,
                '{{horario_agendamento}}': selectedSlot.time,
                '{{nome_do_profissional}}': doctorName,
                '{{nome_local}}': locationName,
                '{{nome_clinica}}': tenant?.name || '',
                '{{link_endereco}}': mapsUrl || '',
                '{{link_sala_espera}}': checkinLink || '',
                '{{link_pagamento}}': payLink || '',
            };

            Object.entries(replacements).forEach(([key, val]) => {
                message = message.replace(new RegExp(key, 'g'), val);
            });

            message = message.trim();

            if (onConfirmationReady) {
                onConfirmationReady(message);
            } else {
                await onSendMessage(message);
            }
            onSuccess?.();
        } catch (err: any) {
            showToast('error', err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = () => {
        if (paymentLink) {
            navigator.clipboard.writeText(paymentLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            showToast('success', t('sidebarBookingView.toasts.linkCopied'));
        }
    };

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-blue-600">
                <div className="flex items-center gap-3 text-white">
                    <button onClick={handleStepBack} className="p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer border-0 bg-transparent">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <p className="text-xs font-bold opacity-80 uppercase tracking-tighter">{isPreFilled ? t('sidebarBookingView.confirmAppointment') : t('sidebarBookingView.headerLabel')}</p>
                        <p className="text-sm font-bold truncate max-w-[150px]">{patientName}</p>
                    </div>
                </div>
                {!isPreFilled && (
                    <div className="flex items-center gap-1.5">
                        {[1, 2, 3, 4].map(s => (
                            <div
                                key={s}
                                className={clsx(
                                    "w-1.5 h-1.5 rounded-full transition-all",
                                    step === s ? "bg-white w-4" : "bg-white/30"
                                )}
                            />
                        ))}
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* Step 1: Professional */}
                {step === 1 && (
                    <div className="p-4 space-y-4">
                        <section className="space-y-4">
                            <p className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">{t('sidebarBookingView.steps.selectProfessional')}</p>
                            <div className="grid grid-cols-1 gap-2">
                                {doctors.map(doc => (
                                    <button
                                        key={doc.id}
                                        onClick={() => {
                                            setSelectedDoctor(doc.id);
                                            loadLocationsForDoctor(doc.id);
                                        }}
                                        className="flex items-center gap-3 p-3 rounded-2xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-all text-left bg-white cursor-pointer group"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 shrink-0 group-hover:bg-blue-100 transition-colors">
                                            <User size={20} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-gray-900 truncate">{doc.full_name}</p>
                                            <p className="text-[10px] text-gray-400 uppercase font-black">{doc.specialty || t('sidebarBookingView.generalSpecialtyFallback')}</p>
                                        </div>
                                        <ChevronRight className="ml-auto w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
                                    </button>
                                ))}
                            </div>
                        </section>
                    </div>
                )}

                {/* Step 2: Location */}
                {step === 2 && (
                    <div className="p-4 space-y-4">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">{t('sidebarBookingView.steps.selectLocationQuestion')}</p>
                            <button onClick={() => setStep(1)} className="text-[10px] font-black text-blue-600 uppercase border-none bg-transparent cursor-pointer">{t('sidebarBookingView.changeProfessional')}</button>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                            {locations.map(loc => (
                                <button
                                    key={loc.id}
                                    onClick={() => {
                                        setSelectedLocation(loc.id);
                                        setSelectedService(null);
                                        setSelectedDate('');
                                        setSelectedSlot(null);
                                        setServices([]);
                                        setSlots([]);
                                        loadServices(selectedDoctor!, loc.id);
                                        setStep(3);
                                    }}
                                    className="flex items-center gap-3 p-4 rounded-2xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-all text-left bg-white cursor-pointer group"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 shrink-0 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                                        <MapPin className="w-5 h-5" />
                                    </div>
                                    <span className="text-sm font-black text-gray-700">{loc.name}</span>
                                    <ChevronRight className="ml-auto w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 3: Service */}
                {step === 3 && (
                    <div className="p-4 space-y-4">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">{t('sidebarBookingView.steps.selectProcedure')}</p>
                            <button onClick={() => setStep(locations.length > 1 ? 2 : 1)} className="text-[10px] font-black text-blue-600 uppercase border-none bg-transparent cursor-pointer">{locations.length > 1 ? t('sidebarBookingView.changeUnit') : t('sidebarBookingView.changeProfessional')}</button>
                        </div>
                        {loading ? (
                            <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>
                        ) : (
                            <div className="grid grid-cols-1 gap-2">
                                {services.map(s => (
                                    <button
                                        key={s.id}
                                        onClick={() => {
                                            setSelectedService(s);
                                            setStep(4);
                                        }}
                                        className="flex items-center gap-3 p-4 rounded-2xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-all text-left bg-white cursor-pointer group"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 shrink-0 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                                            <Stethoscope size={20} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm font-black text-gray-900 truncate">{s.name}</p>
                                          <p className="text-[11px] text-blue-600 font-black">R$ {s.price_cents ? (s.price_cents / 100).toLocaleString('pt-BR', {minimumFractionDigits: 2}) : '0,00'}</p>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
                                    </button>
                                ))}
                                {services.length === 0 && (
                                    <p className="text-xs text-gray-400 italic py-8 text-center bg-gray-50 rounded-2xl">{t('sidebarBookingView.noProceduresFound')}</p>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Step 4: Slots with Calendar */}
                {step === 4 && (
                    <div className="p-4 space-y-6">
                        {isPreFilled ? (
                            loading ? (
                                <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-blue-600 w-6 h-6" /></div>
                            ) : (
                            <div className="space-y-3">
                                <p className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">{t('sidebarBookingView.confirmSummaryTitle')}</p>
                                <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center text-blue-600 shrink-0 shadow-sm"><User size={18} /></div>
                                        <div className="min-w-0">
                                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">{t('sidebarBookingView.summary.professional')}</p>
                                            <p className="text-sm font-bold text-gray-800 truncate">{doctors.find(d => d.id === selectedDoctor)?.full_name || t('sidebarBookingView.professionalFallback')}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center text-emerald-600 shrink-0 shadow-sm"><Stethoscope size={18} /></div>
                                        <div className="min-w-0">
                                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">{t('sidebarBookingView.summary.procedure')}</p>
                                            <p className="text-sm font-bold text-gray-800 truncate">{selectedService?.name}{selectedService?.duration_minutes ? ` (${selectedService.duration_minutes} min)` : ''}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center text-amber-600 shrink-0 shadow-sm"><MapPin size={18} /></div>
                                        <div className="min-w-0">
                                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">{t('sidebarBookingView.summary.unit')}</p>
                                            <p className="text-sm font-bold text-gray-800 truncate">{locations.find(l => l.id === selectedLocation)?.name || '—'}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center text-indigo-600 shrink-0 shadow-sm"><Calendar size={18} /></div>
                                        <div className="min-w-0">
                                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">{t('sidebarBookingView.summary.dateTime')}</p>
                                            <p className="text-sm font-bold text-gray-800">
                                                {selectedDate ? format(new Date(selectedDate + 'T12:00:00'), "dd 'de' MMMM", { locale: ptBR }) : ''}
                                                {selectedSlot ? ` · ${formatSlot(selectedSlot.time)}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <button onClick={onBack} className="text-[10px] font-black text-blue-600 uppercase border-none bg-transparent cursor-pointer pl-1">
                                    {t('sidebarBookingView.changeAvailability')}
                                </button>
                            </div>
                            )
                        ) : (
                            <>
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">{t('sidebarBookingView.steps.selectDateTime')}</p>
                                    <button onClick={() => setStep(3)} className="text-[10px] font-black text-blue-600 uppercase border-none bg-transparent cursor-pointer">{t('sidebarBookingView.changeService')}</button>
                                </div>

                                <SidebarCalendar
                                    selectedDate={selectedDate}
                                    onDateSelect={(date) => loadSlotsForDate(date)}
                                    availableDates={availableDates}
                                    currentMonth={currentMonth}
                                    onMonthChange={setCurrentMonth}
                                    timezone={tenant?.timezone}
                                />
                            </>
                        )}

                        {selectedDate && (
                            <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                {!isPreFilled && (<>
                                <div className="flex items-center justify-between px-1">
                                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                      {t('sidebarBookingView.agendaForDate', { date: format(new Date(selectedDate + 'T12:00:00'), "dd 'de' MMMM", { locale: ptBR }) })}
                                  </p>
                                  {selectedSlot && (
                                    <p className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                      {formatSlot(selectedSlot.time)} ({selectedService?.duration_minutes || 15} min)
                                    </p>
                                  )}
                                </div>
                                
                                {loading ? (
                                    <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-blue-600 w-6 h-6" /></div>
                                ) : (slots.length === 0 || !slots.some(s => s.available)) ? (
                                    <div className="p-8 text-center bg-ice-50 rounded-2xl border border-ice-100 space-y-4">
                                        <p className="text-xs text-graphite-400 italic">{t('sidebarBookingView.noSlotsForDay')}</p>
                                        <button
                                            onClick={findNextSlot}
                                            disabled={loading}
                                            className="w-full py-3 bg-white border border-ice-200 rounded-xl text-xs font-black text-brand-primary uppercase hover:bg-brand-primary hover:text-white transition-all cursor-pointer shadow-sm"
                                        >
                                            {t('sidebarBookingView.findNextAvailableDay')}
                                        </button>
                                    </div>
                                ) : (
                                    <div 
                                      className="relative bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden h-[450px] flex flex-col"
                                      onMouseMove={handleGlobalMouseMove}
                                      onMouseLeave={handleGridMouseUp}
                                      onMouseUp={handleGridMouseUp}
                                    >
                                        {/* Time Grid Header */}
                                        <div className="flex border-b border-gray-200 bg-white sticky top-0 z-10 px-4 py-2">
                                          <div className="w-10"></div>
                                          <div className="flex-1 text-[10px] font-black text-gray-400 uppercase tracking-tighter">{t('sidebarBookingView.dailyAgenda')}</div>
                                        </div>

                                        {/* Scrollable Grid */}
                                        <div 
                                          ref={gridContainerRef}
                                          className="flex-1 overflow-y-auto custom-scrollbar relative p-4 select-none"
                                          onMouseDown={handleGridMouseDown}
                                        >
                                          {/* Hour Rows */}
                                          {Array.from({ length: agendaRange.end - agendaRange.start + 1 }).map((_, i) => {
                                            const hour = agendaRange.start + i;
                                            return (
                                              <div 
                                                key={hour} 
                                                className="h-20 border-t border-gray-100 relative group pointer-events-none"
                                              >
                                                <span className="absolute -top-2.5 -left-1 text-[10px] font-black text-gray-500 group-hover:text-blue-400 transition-colors">
                                                  {formatSlot(`${hour.toString().padStart(2, '0')}:00`)}
                                                </span>
                                              </div>
                                            );
                                          })}

                                            {/* Unified Occupied/Blocked Layer */}
                                            <div className="absolute inset-x-4 top-0 bottom-0 pointer-events-none">
                                              {(() => {
                                                const overlays: { time: string; label: string; color: string; border: string; text?: string }[] = [];
                                                for (let h = agendaRange.start; h <= agendaRange.end; h++) {
                                                  ['00', '15', '30', '45'].forEach(m => {
                                                    const timeStr = `${h.toString().padStart(2, '0')}:${m}`;
                                                    const slot = slots.find(s => s.time === timeStr);
                                                    
                                                    if (!slot) {
                                                      overlays.push({ time: timeStr, label: t('sidebarBookingView.unavailable'), color: 'bg-gray-200/40', border: 'border-gray-200/30' });
                                                    } else if (!slot.available) {
                                                      if (slot.block_type === 'blocked') {
                                                        overlays.push({ time: timeStr, label: t('sidebarBookingView.blocked'), color: 'bg-amber-50/50', border: 'border-amber-100', text: 'text-amber-600' });
                                                      } else {
                                                        overlays.push({ time: timeStr, label: t('sidebarBookingView.occupied'), color: 'bg-gray-100', border: 'border-gray-200', text: 'text-gray-400' });
                                                      }
                                                    }
                                                  });
                                                }
                                                return overlays.map((ov, i) => {
                                                  const [h, m] = ov.time.split(':').map(Number);
                                                  const topPos = ((h - agendaRange.start) * 80) + (m * 80 / 60) + GRID_PADDING;
                                                  return (
                                                    <div
                                                      key={i}
                                                      style={{ top: `${topPos}px`, height: '20px' }}
                                                      className={clsx(
                                                        "absolute left-0 right-0 border-2 rounded-lg flex items-center px-3 transition-opacity",
                                                        ov.color,
                                                        ov.border
                                                      )}
                                                    >
                                                      <span className={clsx("text-[9px] font-black tracking-tighter uppercase", ov.text || "text-gray-400 opacity-60")}>
                                                          {ov.label}
                                                      </span>
                                                    </div>
                                                  );
                                                });
                                              })()}
                                            </div>
                                            
                                            {/* Selection / Draft Appointment Layer */}
                                            {selectedSlot && (
                                              <div 
                                                className={clsx(
                                                  "absolute inset-x-4 top-0 bottom-0",
                                                  dragMode && "pointer-events-none" // Essential to let mouse events reach grid underlying cells
                                                )}
                                              >
                                                {(() => {
                                                  const [h, m] = selectedSlot.time.split(':').map(Number);
                                                  const duration = selectedService?.duration_minutes || 15;
                                                  const topPos = ((h - agendaRange.start) * 80) + (m * 80 / 60) + GRID_PADDING;
                                                  const height = (duration * 80 / 60);
                                                  
                                                  // Only render if within visible range
                                                  if (h < agendaRange.start || h > agendaRange.end) return null;

                                                  return (
                                                    <div
                                                      style={{ top: `${topPos}px`, height: `${height}px` }}
                                                      onMouseDown={(e) => handleStartMove(e, selectedSlot.time)}
                                                      className={clsx(
                                                        "absolute left-0 right-0 bg-blue-600 border-2 border-blue-400 rounded-xl shadow-2xl shadow-blue-500/40 z-30 pointer-events-auto flex flex-col p-3 group/box transition-all duration-75",
                                                        dragMode === 'moving' ? "cursor-grabbing scale-[1.01]" : "cursor-grab"
                                                      )}
                                                    >
                                                      <div className="flex items-center justify-between text-white pointer-events-none mb-1">
                                                        <span className="text-[11px] font-black">{formatSlot(selectedSlot.time)} - {formatSlot(calculateEndTime(selectedSlot.time, duration))}</span>
                                                        <div className="w-2 h-2 rounded-full bg-white/50 group-hover/box:bg-white animate-pulse" />
                                                      </div>

                                                      <div className="absolute top-2 right-2 flex items-center gap-1">
                                                        <button 
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedSlot(null);
                                                          }}
                                                          className="w-6 h-6 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center transition-all cursor-pointer border-none"
                                                        >
                                                           <X size={12} strokeWidth={3} />
                                                        </button>
                                                      </div>

                                                      <div className="mt-auto flex justify-center">
                                                        {/* Resize Handle */}
                                                        <div 
                                                          className="w-12 h-1.5 bg-white/30 rounded-full cursor-ns-resize hover:bg-white hover:h-2 transition-all"
                                                          onMouseDown={(e) => handleStartResize(e, selectedSlot.time)}
                                                        />
                                                      </div>
                                                    </div>
                                                  );
                                                })()}
                                              </div>
                                            )}

                                            {/* Current Time Indicator */}
                                            {selectedDate === format(new Date(), 'yyyy-MM-dd') && nowMin >= agendaRange.start * 60 && nowMin <= (agendaRange.end + 1) * 60 && (
                                              <div 
                                                className="absolute left-0 right-0 z-40 pointer-events-none flex items-center px-4" 
                                                style={{ top: ((nowMin - agendaRange.start * 60) * 80 / 60) + GRID_PADDING }}
                                              >
                                                <div className="flex-1 h-[2px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] relative">
                                                  <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm" />
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                )}
                                </>)}

                                {/* Message Customization Panel */}
                                {selectedSlot && (
                                    <div className="bg-blue-50/50 rounded-2xl border border-blue-100 p-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                        <div className="flex items-center gap-2 mb-1">
                                            <MessageSquare className="w-4 h-4 text-blue-600" />
                                            <p className="text-[10px] font-black text-blue-800 uppercase tracking-widest">{t('sidebarBookingView.messageCustomizationTitle')}</p>
                                        </div>

                                        <div className="grid grid-cols-1 gap-2">
                                            <button 
                                                onClick={() => setIncludeCheckin(!includeCheckin)}
                                                className={clsx(
                                                    "flex items-center gap-3 p-3 rounded-xl border transition-all text-left bg-white cursor-pointer",
                                                    includeCheckin ? "border-blue-200 shadow-sm" : "border-gray-200 opacity-60"
                                                )}
                                            >
                                                <div className={clsx(
                                                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                                    includeCheckin ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"
                                                )}>
                                                    <Link2 size={16} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[11px] font-bold text-gray-900">{t('sidebarBookingView.checkinOption.title')}</p>
                                                    <p className="text-[9px] text-gray-500">{t('sidebarBookingView.checkinOption.subtitle')}</p>
                                                </div>
                                                <div className={clsx(
                                                    "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
                                                    includeCheckin ? "bg-blue-600 border-blue-600" : "border-gray-300"
                                                )}>
                                                    {includeCheckin && <Check size={10} className="text-white" strokeWidth={4} />}
                                                </div>
                                            </button>

                                            <button 
                                                onClick={() => setIncludePayment(!includePayment)}
                                                className={clsx(
                                                    "flex items-center gap-3 p-3 rounded-xl border transition-all text-left bg-white cursor-pointer",
                                                    includePayment ? "border-blue-200 shadow-sm" : "border-gray-200 opacity-60"
                                                )}
                                            >
                                                <div className={clsx(
                                                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                                    includePayment ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"
                                                )}>
                                                    <CreditCard size={16} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[11px] font-bold text-gray-900">{t('sidebarBookingView.paymentOption.title')}</p>
                                                    <p className="text-[9px] text-gray-500">{t('sidebarBookingView.paymentOption.subtitle')}</p>
                                                </div>
                                                <div className={clsx(
                                                    "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
                                                    includePayment ? "bg-blue-600 border-blue-600" : "border-gray-300"
                                                )}>
                                                    {includePayment && <Check size={10} className="text-white" strokeWidth={4} />}
                                                </div>
                                            </button>

                                            <button 
                                                onClick={() => setIncludeMaps(!includeMaps)}
                                                className={clsx(
                                                    "flex items-center gap-3 p-3 rounded-xl border transition-all text-left bg-white cursor-pointer",
                                                    includeMaps ? "border-blue-200 shadow-sm" : "border-gray-200 opacity-60"
                                                )}
                                            >
                                                <div className={clsx(
                                                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                                    includeMaps ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"
                                                )}>
                                                    <MapPin size={16} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[11px] font-bold text-gray-900">{t('sidebarBookingView.mapsOption.title')}</p>
                                                    <p className="text-[9px] text-gray-500">{t('sidebarBookingView.mapsOption.subtitle')}</p>
                                                </div>
                                                <div className={clsx(
                                                    "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
                                                    includeMaps ? "bg-blue-600 border-blue-600" : "border-gray-300"
                                                )}>
                                                    {includeMaps && <Check size={10} className="text-white" strokeWidth={4} />}
                                                </div>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Step 5: Final */}
                {step === 5 && (
                    <div className="p-6 text-center space-y-6">
                        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600 mb-4 animate-bounce">
                            <CheckCircle2 size={40} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900">{t('sidebarBookingView.successTitle')}</h3>
                            <p className="text-xs text-gray-500 mt-1">{t('sidebarBookingView.successSubtitle')}</p>
                        </div>

                        <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{t('sidebarBookingView.paymentLinkLabel')}</p>
                            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl p-2">
                                <span className="text-[10px] text-gray-400 truncate flex-1">{paymentLink}</span>
                                <button 
                                    onClick={handleCopy}
                                    className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors cursor-pointer border-0"
                                >
                                    {copied ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={onBack}
                            className="w-full bg-gray-900 text-white rounded-xl py-4 text-sm font-bold hover:bg-black transition-all cursor-pointer shadow-lg border-0"
                        >
                            {t('sidebarBookingView.backToService')}
                        </button>
                    </div>
                )}
            </div>

            {step === 4 && (
                <div className="p-4 border-t border-gray-100 bg-gray-50">
                    <button
                        onClick={handleConfirmBooking}
                        disabled={loading || !selectedSlot}
                        className="w-full bg-blue-600 text-white rounded-2xl py-4 text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 disabled:opacity-50 cursor-pointer border-0"
                    >
                        {loading ? <Loader2 className="animate-spin w-5 h-5" /> : t('sidebarBookingView.confirmAppointment')}
                    </button>
                </div>
            )}
        </div>
    );
}
