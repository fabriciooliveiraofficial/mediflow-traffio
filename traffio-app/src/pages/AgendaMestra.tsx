import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
    Calendar as CalendarIcon,
    ChevronLeft,
    ChevronRight,
    Clock,
    Plus,
    CheckCircle2,
    X,
    Save,
    XCircle,
    UserCheck,
    AlertTriangle,
    Search,
    Star,
    Unlock,
    FileText,
    Shield,
    User,
    MapPin,
    Stethoscope as StethoscopeIcon,
    Wallet,
    MessageCircle,
    Mail,
    Phone,
    Instagram,
    Send,
    Repeat,
    CreditCard,
    Link2,
    Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { DEFAULT_BOOKING_CAPTIONS } from '../lib/messageDefaults';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';
import { smartSchedulingService } from '../services/smartSchedulingService';
import { locationService } from '../services/locationService';
import { CheckoutModal } from '../components/CheckoutModal';
import { WaitlistDrawer } from '../components/WaitlistDrawer';
import type { SmartSlot, BookAppointmentPayload } from '../services/smartSchedulingService';
import { formatSlot as formatSlotI18n } from '../lib/i18n/formatDateTime';
import { getCountry, DEFAULT_COUNTRY } from '../lib/i18n/countryFormats';
import { format } from 'date-fns';
import { getTenantTodayString, getTenantNow, addDaysToDateString } from '../lib/timezoneUtils';
import { Button, Badge, IconButton } from '../components/ui';

function cn(...inputs: any[]) {
    return twMerge(clsx(inputs));
}

// ─── Calendar Constants ─────────────────────
const DAY_START = 7;   // 07:00
const DAY_END = 21;    // 21:00
const HOUR_PX = 72;    // pixels per hour
const SNAP_MIN = 15;   // snap to 15-minute intervals
const TOTAL_HOURS = DAY_END - DAY_START;
const TOTAL_PX = TOTAL_HOURS * HOUR_PX;
const DEFAULT_DURATION = 30; // minutes

// ─── Time ↔ Pixel helpers ───────────────────
const timeToMin = (t: string): number => {
    const [h, m] = t.substring(0, 5).split(':').map(Number);
    return h * 60 + m;
};
const minToTime = (m: number): string => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
const minToY = (m: number): number => ((m - DAY_START * 60) / 60) * HOUR_PX;
const yToMin = (y: number): number => (y / HOUR_PX) * 60 + DAY_START * 60;
const snap = (m: number): number => Math.round(m / SNAP_MIN) * SNAP_MIN;
const clampMin = (m: number) => Math.max(DAY_START * 60, Math.min(DAY_END * 60, m));

// ─── Types ──────────────────────────────────
interface Doctor {
    id: string;
    full_name: string;
    specialty: string | null;
    color: string | null;
    auto_release_hours: number;
}

interface AvailabilityBlock {
    doctor_id: string;
    location_id: string | null;
    day_of_week: number;
    start_time: string;
    end_time: string;
    block_type: string | null;
}

interface BlockedBand {
    start: number;
    end: number;
    label: 'blocked' | 'outsideHours';
}

interface AppointmentType {
    id: string;
    name: string;
    duration_minutes: number;
    price_cents: number | null;
    color_hex: string | null;
}

interface Patient {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    insurance_provider: string | null;
}

interface DragState {
    type: 'move' | 'resize-top' | 'resize-bottom' | 'create';
    apptId?: string;
    docId: string;
    origStart: number;
    origEnd: number;
    offsetY: number;       // for move: mouse offset within card
    currentDocId: string;
    currentStart: number;
    currentEnd: number;
}

interface GhostState {
    colIndex: number;
    top: number;
    height: number;
    label: string;
}

// ─── Hours array for grid lines ─────────────
const HOURS = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => DAY_START + i);

// ─────────────────────────────────────────────
export const AgendaMestra: React.FC = () => {
    const { t, i18n } = useTranslation('agenda');
    const { showToast } = useToast();
    const { tenant, userRole } = useTenant();
    const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
    const [tenants, setTenants] = useState<any[]>([]);
    const [locations, setLocations] = useState<any[]>([]);
    const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
    const [selectedDateStr, setSelectedDateStr] = useState(() => getTenantTodayString());

    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [selectedDoctors, setSelectedDoctors] = useState<string[]>([]);
    const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
    const [slotsByDoctor, setSlotsByDoctor] = useState<Record<string, SmartSlot[]>>({});
    const [appointmentsByDoctor, setAppointmentsByDoctor] = useState<Record<string, any[]>>({});
    const [availabilityByDoctor, setAvailabilityByDoctor] = useState<Record<string, AvailabilityBlock[]>>({});
    const [loading, setLoading] = useState(false);

    // Booking modal
    const [bookingModal, setBookingModal] = useState<{
        open: boolean;
        doctorId: string;
        slot: SmartSlot | null;
        prefillStart?: string;
        prefillEnd?: string;
    }>({ open: false, doctorId: '', slot: null });
    const [bookingForm, setBookingForm] = useState({
        patientSearch: '',
        selectedPatient: null as Patient | null,
        patientType: 'private' as 'private' | 'insurance',
        insurancePlanId: '',
        typeId: '',
        notes: '',
    });
    const [patientResults, setPatientResults] = useState<Patient[]>([]);
    const [doctorPlans, setDoctorPlans] = useState<any[]>([]);
    const [bookingSaving, setBookingSaving] = useState(false);
    const searchTimeout = useRef<any>(null);
    const [scrollTop, setScrollTop] = useState(0);

    // Edit modal
    const [editingAppt, setEditingAppt] = useState<any>(null);
    const [editNotes, setEditNotes] = useState('');
    const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
    const [waitlistOpen, setWaitlistOpen] = useState(false);
    const [waitlistCount, setWaitlistCount] = useState(0);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [patientNoShowStats, setPatientNoShowStats] = useState<{ total: number; noShows: number; rate: number } | null>(null);
    const [reschedulingFromAppt, setReschedulingFromAppt] = useState<any | null>(null);
    const [doctorServices, setDoctorServices] = useState<any[]>([]);
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurrencePattern, setRecurrencePattern] = useState<'weekly' | 'biweekly' | 'monthly' | 'd60' | 'd90'>('weekly');
    const [occurrencesCount, setOccurrencesCount] = useState(4);
    const [generatedOccurrences, setGeneratedOccurrences] = useState<any[]>([]);
    const [futureScheduleData, setFutureScheduleData] = useState<any>(null);
    const [recurrenceLoading, setRecurrenceLoading] = useState(false);
    const [showNotificationModal, setShowNotificationModal] = useState(false);
    const [notificationChannel, setNotificationChannel] = useState<string>('whatsapp');
    const [recipientId, setRecipientId] = useState('');
    const [notificationPreviewText, setNotificationPreviewText] = useState('');
    const [tempBookedAppointments, setTempBookedAppointments] = useState<any[]>([]);
    const [includeCheckin, setIncludeCheckin] = useState(false);
    const [includePayment, setIncludePayment] = useState(false);
    const [includeMaps, setIncludeMaps] = useState(false);

    // Quick-create patient states
    const [isCreatingPatient, setIsCreatingPatient] = useState(false);
    const [newPatientData, setNewPatientData] = useState({
        phone: '',
        email: '',
    });


    // Drag & Drop
    const gridRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const rafRef = useRef<number>(0);
    const [ghost, setGhost] = useState<GhostState | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Locale must follow the tenant being VIEWED (selectedTenant), not the
    // super-admin's own tenant — this view has no TenantProvider/useTenant().
    const timeFormatOpts = useMemo(() => {
        const t = tenants.find(t => t.id === selectedTenant);
        const locale = t?.locale || getCountry(t?.country || DEFAULT_COUNTRY).locale;
        const hour12 = t?.time_format === '12h' ? true
                     : t?.time_format === '24h' ? false
                     : t ? getCountry(t.country || DEFAULT_COUNTRY).hour12
                     : undefined;
        return { locale, hour12, timezone: t?.timezone };
    }, [tenants, selectedTenant]);

    // Current time indicator
    const [now, setNow] = useState(() => getTenantNow(timeFormatOpts.timezone));
    useEffect(() => {
        setNow(getTenantNow(timeFormatOpts.timezone));
        const iv = setInterval(() => setNow(getTenantNow(timeFormatOpts.timezone)), 60_000);
        return () => clearInterval(iv);
    }, [timeFormatOpts.timezone]);
    const nowMin = now.getHours() * 60 + now.getMinutes();

    // Sync selected date with tenant timezone on load or tenant change
    useEffect(() => {
        if (timeFormatOpts.timezone) {
            setSelectedDateStr(getTenantTodayString(timeFormatOpts.timezone));
        }
    }, [timeFormatOpts.timezone]);

    // Load patient no-show stats when editing modal is opened
    useEffect(() => {
        if (editingAppt?.patient_id && selectedTenant) {
            setPatientNoShowStats(null);
            smartSchedulingService.getPatientNoShowStats(selectedTenant, editingAppt.patient_id)
                .then(stats => setPatientNoShowStats(stats))
                .catch(err => console.error("Error loading no-show stats:", err));
        } else {
            setPatientNoShowStats(null);
        }
    }, [editingAppt, selectedTenant]);

    const formatDateLabel = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return date.toLocaleDateString(getIntlLocale(i18n.language), { weekday: 'short', day: '2-digit', month: 'short' });
    };
    const changeDate = (days: number) => {
        setSelectedDateStr(prev => addDaysToDateString(prev, days));
    };
    const goToToday = () => setSelectedDateStr(getTenantTodayString(timeFormatOpts.timezone));
    const isToday = selectedDateStr === getTenantTodayString(timeFormatOpts.timezone);
    const dateStr = selectedDateStr;

    const visibleDoctors = useMemo(() => doctors.filter(d => selectedDoctors.includes(d.id)), [doctors, selectedDoctors]);

    // ISO day-of-week (1=Mon...7=Sun) for the selected date, matching the
    // convention used by find_next_available_dates (with the 0=Sunday legacy fallback).
    const isoDow = useMemo(() => {
        const [y, m, d] = dateStr.split('-').map(Number);
        const jsDow = new Date(y, m - 1, d).getDay();
        return jsDow === 0 ? 7 : jsDow;
    }, [dateStr]);

    const formatSlot = useCallback((timeStr: string | null | undefined) => formatSlotI18n(timeStr, timeFormatOpts), [timeFormatOpts]);

    // ── Data fetching ──────────────────────
    useEffect(() => {
        if (tenant?.id) {
            setSelectedTenant(tenant.id);
        }
    }, [tenant?.id]);

    useEffect(() => {
        (async () => {
            if (userRole === 'super_admin') {
                const { data } = await supabase.from('tenants').select('*');
                if (data?.length) {
                    setTenants(data);
                }
            } else if (tenant) {
                // For regular users, populate tenants with their own tenant
                // so timeFormatOpts can resolve timezone, locale, etc.
                setTenants([tenant]);
            }
        })();
    }, [userRole, tenant]);

    useEffect(() => {
        if (!selectedTenant) return;
        (async () => {
            const [docs, types, locs, servicesRes] = await Promise.all([
                smartSchedulingService.getActiveDoctors(selectedTenant),
                smartSchedulingService.getAppointmentTypes(selectedTenant),
                locationService.getAll(selectedTenant),
                supabase.from('doctor_services').select('*').eq('tenant_id', selectedTenant)
            ]);
            setDoctors(docs as Doctor[]);
            setAppointmentTypes(types as AppointmentType[]);
            setSelectedDoctors(docs.map((d: any) => d.id));
            setLocations(locs);
            setDoctorServices(servicesRes.data || []);
            if (locs.length > 0) {
                setSelectedLocation(locs[0].id);
            } else {
                setSelectedLocation(null);
            }
        })();
    }, [selectedTenant]);

    const fetchData = useCallback(async () => {
        if (!selectedTenant || selectedDoctors.length === 0) return;
        setLoading(true);
        const defaultDur = SNAP_MIN; // Agenda Mestra precisa de granularidade de 15min para exibir todos os slots
        const dowCandidates = isoDow === 7 ? [7, 0] : [isoDow];
        try {
            const [slotsResults, appts, availability] = await Promise.all([
                Promise.all(selectedDoctors.map(async (docId) => {
                    try {
                        return { docId, slots: await smartSchedulingService.getAvailableSlots(docId, dateStr, selectedTenant, defaultDur, selectedLocation || undefined) };
                    } catch { return { docId, slots: [] }; }
                })),
                smartSchedulingService.getAppointmentsForDate(selectedTenant, dateStr, selectedDoctors),
                (async () => {
                    let query = supabase
                        .from('doctor_availability')
                        .select('doctor_id, location_id, day_of_week, start_time, end_time, block_type')
                        .in('doctor_id', selectedDoctors)
                        .in('day_of_week', dowCandidates);
                    if (selectedLocation) query = query.eq('location_id', selectedLocation);
                    const { data, error } = await query;
                    if (error) { console.error(error); return []; }
                    return (data || []) as AvailabilityBlock[];
                })(),
            ]);
            const sm: Record<string, SmartSlot[]> = {};
            slotsResults.forEach(({ docId, slots }) => { sm[docId] = slots; });
            setSlotsByDoctor(sm);

            const am: Record<string, any[]> = {};
            selectedDoctors.forEach(id => { am[id] = []; });
            (appts || []).forEach((a: any) => {
                if (a.doctor_id && am[a.doctor_id]) {
                    if (!selectedLocation || a.location_id === selectedLocation) {
                        am[a.doctor_id].push(a);
                    }
                }
            });
            setAppointmentsByDoctor(am);

            const avm: Record<string, AvailabilityBlock[]> = {};
            selectedDoctors.forEach(id => { avm[id] = []; });
            availability.forEach((row) => {
                if (row.doctor_id && avm[row.doctor_id]) avm[row.doctor_id].push(row);
            });
            setAvailabilityByDoctor(avm);
        } catch (err) { console.error(err); }
        setLoading(false);
    }, [selectedTenant, selectedDoctors, dateStr, appointmentTypes, selectedLocation, isoDow]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Sincronização em tempo real (Supabase Realtime)
    useEffect(() => {
        const channel = supabase
            .channel('agenda-mestra-appointments')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'appointments'
                },
                () => {
                    fetchData();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchData]);

    // Auto-scroll to current time on load
    // Auto-scroll to current time on load
    useEffect(() => {
        if (!loading && scrollRef.current && isToday) {
            const y = minToY(nowMin);
            scrollRef.current.scrollTop = Math.max(0, y - 200);
        }
    }, [loading]);

    useEffect(() => {
        const handleScroll = () => {
            if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
        };
        const el = scrollRef.current;
        el?.addEventListener('scroll', handleScroll);
        // Initial sync
        if (el) setScrollTop(el.scrollTop);
        return () => el?.removeEventListener('scroll', handleScroll);
    }, [loading]);

    const calculateNextDate = (startDateStr: string, pattern: string, index: number): string => {
        const [y, m, d] = startDateStr.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        if (pattern === 'weekly') {
            date.setDate(date.getDate() + index * 7);
        } else if (pattern === 'biweekly') {
            date.setDate(date.getDate() + index * 14);
        } else if (pattern === 'monthly') {
            date.setMonth(date.getMonth() + index);
        } else if (pattern === 'd60') {
            date.setDate(date.getDate() + index * 60);
        } else if (pattern === 'd90') {
            date.setDate(date.getDate() + index * 90);
        }
        const ry = date.getFullYear();
        const rm = String(date.getMonth() + 1).padStart(2, '0');
        const rd = String(date.getDate()).padStart(2, '0');
        return `${ry}-${rm}-${rd}`;
    };

    const loadDoctorFutureSchedule = async (docId: string, maxDate: string) => {
        if (!selectedTenant) return { absences: [], appts: [], avail: [] };
        
        const [absences, appts, avail] = await Promise.all([
            supabase.from('doctor_absences').select('*').eq('doctor_id', docId).eq('tenant_id', selectedTenant),
            supabase.from('appointments').select('date, start_time, end_time, status').eq('doctor_id', docId).eq('tenant_id', selectedTenant).gte('date', dateStr).lte('date', maxDate).not('status', 'in', '("canceled","cancelled","noshow","no_show")'),
            supabase.from('doctor_availability').select('*').eq('doctor_id', docId).eq('tenant_id', selectedTenant).eq('is_active', true)
        ]);

        return {
            absences: absences.data || [],
            appts: appts.data || [],
            avail: avail.data || []
        };
    };

    const getAllowedAppointmentTypesForDoctor = (doctorId: string, locationId?: string | null) => {
        if (!doctorId) return [];

        const mappedServices = doctorServices.filter(ds => {
            if (ds.doctor_id !== doctorId) return false;
            if (!locationId) return true;
            return !ds.location_id || ds.location_id === locationId;
        });

        const mappedServiceIds = new Set(mappedServices.map(ds => ds.service_id));
        const hasAnyMappings = new Set(doctorServices.map(ds => ds.service_id));

        return appointmentTypes.filter(type => {
            if (!hasAnyMappings.has(type.id)) return true;
            return mappedServiceIds.has(type.id);
        });
    };

    const checkSlotAvailabilityLocal = (
        dateStr: string,
        startTime: string,
        endTime: string,
        _docId: string,
        locId: string,
        scheduleData: any
    ) => {
        const sMin = timeToMin(startTime);
        const eMin = timeToMin(endTime);

        // 1. Check doctor absences
        const isAbsent = scheduleData.absences.some((abs: any) => {
            return dateStr >= abs.start_date && dateStr <= abs.end_date;
        });
        if (isAbsent) return { available: false, reason: 'DOCTOR_ABSENT' };

        // 2. Check general week day availability
        const [y, m, d] = dateStr.split('-').map(Number);
        const jsDow = new Date(y, m - 1, d).getDay();
        const isoDow = jsDow === 0 ? 7 : jsDow;
        const dowCandidates = isoDow === 7 ? [7, 0] : [isoDow];

        const hasAvailability = scheduleData.avail.some((av: any) => {
            if (!dowCandidates.includes(av.day_of_week)) return false;
            if (av.location_id && av.location_id !== locId) return false;
            if (av.block_type === 'blocked') return false;
            const avStart = timeToMin(av.start_time);
            const avEnd = timeToMin(av.end_time);
            return avStart <= sMin && avEnd >= eMin;
        });
        if (!hasAvailability) return { available: false, reason: 'OUTSIDE_AVAILABILITY' };

        // 3. Check if slot overlaps with block_type = 'blocked' block
        const isBlocked = scheduleData.avail.some((av: any) => {
            if (!dowCandidates.includes(av.day_of_week)) return false;
            if (av.location_id && av.location_id !== locId) return false;
            if (av.block_type !== 'blocked') return false;
            const avStart = timeToMin(av.start_time);
            const avEnd = timeToMin(av.end_time);
            return avStart < eMin && avEnd > sMin;
        });
        if (isBlocked) return { available: false, reason: 'OUTSIDE_AVAILABILITY' };

        // 4. Check overlap with existing appointments
        const hasConflict = scheduleData.appts.some((appt: any) => {
            if (appt.date !== dateStr) return false;
            const apptStart = timeToMin(appt.start_time);
            const apptEnd = appt.end_time ? timeToMin(appt.end_time) : apptStart + 30;
            return apptStart < eMin && apptEnd > sMin;
        });
        if (hasConflict) return { available: false, reason: 'SLOT_CONFLICT' };

        return { available: true, reason: null };
    };

    const findSuggestedSlotLocal = (
        dateStr: string,
        duration: number,
        docId: string,
        locId: string,
        scheduleData: any
    ): { date: string; start: string; end: string } | null => {
        const [y, m, d] = dateStr.split('-').map(Number);
        const jsDow = new Date(y, m - 1, d).getDay();
        const isoDow = jsDow === 0 ? 7 : jsDow;
        const dowCandidates = isoDow === 7 ? [7, 0] : [isoDow];

        const blocks = scheduleData.avail.filter((av: any) => {
            return dowCandidates.includes(av.day_of_week) && av.block_type !== 'blocked' && (!av.location_id || av.location_id === locId);
        });

        for (const block of blocks) {
            let current = timeToMin(block.start_time);
            const blockEnd = timeToMin(block.end_time);

            while (current + duration <= blockEnd) {
                const startStr = minToTime(current);
                const endStr = minToTime(current + duration);

                const check = checkSlotAvailabilityLocal(dateStr, startStr, endStr, docId, locId, scheduleData);
                if (check.available) {
                    return { date: dateStr, start: startStr, end: endStr };
                }
                current += 15;
            }
        }

        // Check subsequent days
        for (let offset = 1; offset <= 5; offset++) {
            const nextDate = addDaysToDateString(dateStr, offset);
            const suggestion = findSuggestedSlotLocal(nextDate, duration, docId, locId, scheduleData);
            if (suggestion) return suggestion;
        }

        return null;
    };

    const generateOccurrencesPreview = async (targetDocId?: string, targetTypeId?: string) => {
        if (!selectedTenant) return;
        setRecurrenceLoading(true);

        const typeId = targetTypeId || bookingForm.typeId;
        const selectedType = appointmentTypes.find(t => t.id === typeId);
        const duration = selectedType?.duration_minutes || DEFAULT_DURATION;
        const startTime = bookingModal.slot?.slot_time || bookingModal.prefillStart || '08:00';
        const endTime = minToTime(timeToMin(startTime) + duration);
        const docId = targetDocId || bookingModal.doctorId;
        const locId = bookingModal.slot?.location_id || selectedLocation || '';

        // Calculate max date to fetch future schedule data
        const maxDate = calculateNextDate(dateStr, recurrencePattern, occurrencesCount);

        try {
            const scheduleData = await loadDoctorFutureSchedule(docId, maxDate);
            setFutureScheduleData(scheduleData);

            const occurrences = [];
            for (let i = 0; i < occurrencesCount; i++) {
                const occurrenceDate = calculateNextDate(dateStr, recurrencePattern, i);
                const check = checkSlotAvailabilityLocal(occurrenceDate, startTime, endTime, docId, locId, scheduleData);

                let start_time = startTime;
                let end_time = endTime;
                let is_conflict = !check.available;
                let conflict_reason = check.reason;
                let suggested_slot = null;

                if (is_conflict) {
                    const suggestion = findSuggestedSlotLocal(occurrenceDate, duration, docId, locId, scheduleData);
                    if (suggestion) {
                        suggested_slot = {
                            date: suggestion.date,
                            slot_time: suggestion.start,
                            slot_end: suggestion.end
                        };
                    }
                }

                occurrences.push({
                    index: i,
                    date: occurrenceDate,
                    start_time,
                    end_time,
                    doctor_id: docId,
                    type_id: typeId,
                    doctor_name: doctors.find(d => d.id === docId)?.full_name || '',
                    type_name: selectedType?.name || '',
                    is_conflict,
                    conflict_reason,
                    suggested_slot,
                    is_edited: false
                });
            }
            setGeneratedOccurrences(occurrences);
        } catch (err) {
            console.error("Error generating preview:", err);
            showToast('error', t('mestra.toasts.recurrencePreviewError'));
        } finally {
            setRecurrenceLoading(false);
        }
    };

    const toggleDoctor = (id: string) => {
        setSelectedDoctors(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
    };

    const bookingAppointmentTypes = useMemo(() => {
        if (!bookingModal.open || !bookingModal.doctorId) return [];
        return getAllowedAppointmentTypesForDoctor(
            bookingModal.doctorId,
            bookingModal.slot?.location_id || selectedLocation
        );
    }, [
        bookingModal.open,
        bookingModal.doctorId,
        bookingModal.slot?.location_id,
        selectedLocation,
        appointmentTypes,
        doctorServices
    ]);

    useEffect(() => {
        if (!bookingModal.open) return;

        if (bookingAppointmentTypes.length === 0) {
            if (bookingForm.typeId) {
                setBookingForm(prev => ({ ...prev, typeId: '' }));
            }
            return;
        }

        if (!bookingAppointmentTypes.some(type => type.id === bookingForm.typeId)) {
            setBookingForm(prev => ({ ...prev, typeId: bookingAppointmentTypes[0].id }));
        }
    }, [bookingModal.open, bookingAppointmentTypes, bookingForm.typeId]);

    // ── Booking ─────────────────────────────
    const openBookingModal = (doctorId: string, slot: SmartSlot | null) => {
        const locationId = slot?.location_id || selectedLocation;
        const allowedTypes = getAllowedAppointmentTypesForDoctor(doctorId, locationId);

        if (!reschedulingFromAppt) {
            setBookingForm({
                patientSearch: '',
                selectedPatient: null,
                patientType: 'private',
                insurancePlanId: '',
                typeId: allowedTypes[0]?.id || '',
                notes: ''
            });
            setPatientResults([]);
            setDoctorPlans([]);
        }
        setBookingModal({ open: true, doctorId, slot });
        smartSchedulingService.getDoctorInsurancePlans(doctorId).then(setDoctorPlans);
    };

    const openBookingFromDrag = (doctorId: string, startMin: number, endMin: number) => {
        const allowedTypes = getAllowedAppointmentTypesForDoctor(doctorId, selectedLocation);

        if (!reschedulingFromAppt) {
            setBookingForm({
                patientSearch: '',
                selectedPatient: null,
                patientType: 'private',
                insurancePlanId: '',
                typeId: allowedTypes[0]?.id || '',
                notes: ''
            });
            setPatientResults([]);
            setDoctorPlans([]);
        }
        setBookingModal({
            open: true,
            doctorId,
            slot: null,
            prefillStart: minToTime(startMin),
            prefillEnd: minToTime(endMin),
        });
        smartSchedulingService.getDoctorInsurancePlans(doctorId).then(setDoctorPlans);
    };


    const handlePatientSearch = (query: string) => {
        setBookingForm(prev => ({ ...prev, patientSearch: query, selectedPatient: null }));
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        if (query.length < 2) { setPatientResults([]); return; }
        searchTimeout.current = setTimeout(async () => {
            if (!selectedTenant) return;
            setPatientResults((await smartSchedulingService.searchPatients(selectedTenant, query)) as Patient[]);
        }, 300);
    };

    const handleSaveNewPatient = async () => {
        if (!selectedTenant || !bookingForm.patientSearch.trim()) return;
        try {
            const fullName = bookingForm.patientSearch.trim();
            const { data, error } = await supabase.from('patients').insert({
                tenant_id: selectedTenant,
                full_name: fullName,
                phone: newPatientData.phone.trim() || null,
                email: newPatientData.email.trim() || null,
            }).select('*').single();

            if (error) throw error;

            if (data) {
                const newPat: Patient = {
                    id: data.id,
                    full_name: data.full_name,
                    phone: data.phone,
                    email: data.email,
                    insurance_provider: data.insurance_provider,
                };
                setBookingForm(prev => ({
                    ...prev,
                    selectedPatient: newPat,
                    patientSearch: newPat.full_name,
                    patientType: 'private'
                }));
                setIsCreatingPatient(false);
                setPatientResults([]);
                showToast('success', t('mestra.toasts.patientRegisteredSuccess'));
            }
        } catch (err: any) {
            console.error("Error creating patient:", err);
            showToast('error', t('mestra.toasts.patientRegisterError', { message: err.message }));
        }
    };

    const buildConsolidatedMessage = (patientName: string, appointments: any[]) => {
        const firstName = patientName.split(' ')[0];
        let msg = `Olá, ${firstName}! 😊 Aqui está o resumo das suas consultas confirmadas:\n\n`;
        appointments.forEach((appt) => {
            const dateFormatted = appt.date.split('-').reverse().slice(0, 2).join('/');
            const typeObj = appointmentTypes.find(t => t.id === appt.type_id);
            const docObj = doctors.find(d => d.id === appt.doctor_id);
            msg += `• ${dateFormatted} às ${formatSlot(appt.start_time)} – ${typeObj?.name || 'Consulta'} (Prof. ${docObj?.full_name || 'Profissional'})\n`;
        });
        msg += `\nNos vemos em breve! 💙`;
        return msg;
    };

    const buildSingleMessage = (appt: any) => {
        if (!selectedTenant) return '';
        const currentTenant = tenants.find(t => t.id === selectedTenant);
        const botConfig = currentTenant?.bot_config;
        const outboundLocale = botConfig?.notification_locale || 'pt';
        const templates = botConfig?.booking_confirmation_captions || DEFAULT_BOOKING_CAPTIONS;
        let template = templates[outboundLocale] || templates['pt'];

        if (reschedulingFromAppt) {
            template = template
                .replace(/agendamento foi realizado com sucesso/gi, 'reagendamento foi realizado com sucesso')
                .replace(/appointment has been successfully booked/gi, 'appointment has been successfully rescheduled')
                .replace(/cita ha sido reservada con éxito/gi, 'cita ha sido reprogramada con éxito');
        }

        const baseUrl = window.location.origin;
        const payLink = `https://checkout.traffio.com/pay/${appt.id}`;
        const checkinLink = `${baseUrl}/checkin?apt=${appt.id}&loc=${appt.location_id}`;
        
        const firstName = (bookingForm.selectedPatient?.full_name || appt.patients?.full_name || '').split(' ')[0];
        const dateFormatted = appt.date ? format(new Date(appt.date + 'T12:00:00'), "dd/MM/yyyy") : '';
        const docObj = doctors.find(d => d.id === appt.doctor_id);
        const docName = docObj?.full_name || t('sidebarBookingView.professionalFallback');
        const locObj = locations.find(l => l.id === appt.location_id);
        const locName = locObj?.name || '';
        const mapsUrl = locObj?.google_maps_url || '';

        // Split template into blocks by double newlines to filter checkin/payment/maps sections
        const blocks = template.split('\n\n');
        const filteredBlocks = blocks.map((block: string) => {
            if (block.includes('{{link_sala_espera}}') && !includeCheckin) {
                return null;
            }
            if (block.includes('{{link_pagamento}}') && !includePayment) {
                return null;
            }
            
            let lines = block.split('\n');
            if (!includeMaps || !mapsUrl) {
                lines = lines.filter((line: string) => !line.includes('{{link_endereco}}'));
            }
            return lines.join('\n');
        }).filter((b: string | null) => b !== null);

        let message = filteredBlocks.join('\n\n');

        // Replace variables
        const replacements: Record<string, string> = {
            '{{nome_paciente}}': firstName,
            '{{data_agendamento}}': dateFormatted,
            '{{horario_agendamento}}': appt.start_time || '',
            '{{nome_do_profissional}}': docName,
            '{{nome_local}}': locName,
            '{{nome_clinica}}': currentTenant?.name || '',
            '{{link_endereco}}': mapsUrl || '',
            '{{link_sala_espera}}': checkinLink || '',
            '{{link_pagamento}}': payLink || '',
        };

        Object.entries(replacements).forEach(([key, val]) => {
            message = message.replace(new RegExp(key, 'g'), val);
        });

        return message.trim();
    };

    useEffect(() => {
        if (!bookingForm.selectedPatient) return;
        if (tempBookedAppointments.length === 1) {
            const msg = buildSingleMessage(tempBookedAppointments[0]);
            setNotificationPreviewText(msg);
        } else if (tempBookedAppointments.length > 1) {
            const msg = buildConsolidatedMessage(bookingForm.selectedPatient.full_name, tempBookedAppointments);
            setNotificationPreviewText(msg);
        }
    }, [
        tempBookedAppointments,
        includeCheckin,
        includePayment,
        includeMaps,
        selectedTenant,
        bookingForm.selectedPatient,
        reschedulingFromAppt
    ]);

    const loadPatientPreferences = async (patientId: string) => {
        if (!selectedTenant) return null;
        const { data, error } = await supabase
            .from('patient_channel_preferences')
            .select('*')
            .eq('patient_id', patientId)
            .eq('tenant_id', selectedTenant)
            .maybeSingle();
        if (error) {
            console.error("Error loading patient preference:", error);
            return null;
        }
        return data;
    };

    const closeNotificationModal = () => {
        setShowNotificationModal(false);
        setTempBookedAppointments([]);
        setGeneratedOccurrences([]);
        setIsRecurring(false);
        setIncludeCheckin(false);
        setIncludePayment(false);
        setIncludeMaps(false);
        fetchData();
    };

    const handleSendNotification = async () => {
        if (!bookingForm.selectedPatient || !selectedTenant) return;

        try {
            const recipient = recipientId || bookingForm.selectedPatient.phone || bookingForm.selectedPatient.email || '';

            // Validar o destinatário conforme o canal escolhido
            if (notificationChannel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())) {
                showToast('error', t('mestra.toasts.invalidEmailForChannel'));
                return;
            }
            if (notificationChannel !== 'email' && !recipient.replace(/\D/g, '')) {
                showToast('error', t('mestra.toasts.invalidPhoneForChannel'));
                return;
            }

            const tenantInfo = tenants.find(t => t.id === selectedTenant);

            // is_edited + override_message: o process-outbound envia o texto exatamente
            // como está no preview, por qualquer canal (incl. e-mail)
            const { error } = await supabase.from('outbound_message_queue').insert({
                tenant_id: selectedTenant,
                patient_phone: bookingForm.selectedPatient.phone || recipient,
                message_type: 'booking_confirmed',
                template_key: 'booking_confirmed',
                template_vars: {
                    override_message: notificationPreviewText,
                    clinic_name: tenantInfo?.name || '',
                    locale: tenantInfo?.bot_config?.notification_locale || 'pt',
                },
                is_edited: true,
                scheduled_at: new Date().toISOString(),
                status: 'pending',
                notification_channel: notificationChannel,
                channel_recipient_id: recipient.trim()
            });

            if (error) throw error;

            showToast('success', t('mestra.toasts.reminderQueued'));
            closeNotificationModal();
        } catch (err: any) {
            console.error("Error sending notification:", err);
            showToast('error', t('mestra.toasts.notificationSendError', { message: err.message }));
        }
    };

    const handleBook = async () => {
        if (!bookingForm.selectedPatient || !selectedTenant) return;
        setBookingSaving(true);

        try {
            const startTime = bookingModal.slot?.slot_time || bookingModal.prefillStart || '08:00';
            const selectedType = appointmentTypes.find(t => t.id === bookingForm.typeId);
            const duration = selectedType?.duration_minutes || DEFAULT_DURATION;
            const endTime = minToTime(timeToMin(startTime) + duration);
            const slot = bookingModal.slot;
            const slotType = slot ? (slot.is_auto_released ? 'auto_released' : slot.block_type) : 'regular';

            if (isRecurring) {
                // Check if any occurrence still has conflicts
                const hasConflicts = generatedOccurrences.some(o => o.is_conflict);
                if (hasConflicts) {
                    showToast('error', t('mestra.toasts.resolveConflictsFirst'));
                    setBookingSaving(false);
                    return;
                }

                const payloads = generatedOccurrences.map((occ, idx) => ({
                    doctor_id: occ.doctor_id,
                    location_id: slot?.location_id || selectedLocation || '',
                    type_id: occ.type_id || null,
                    date: occ.date,
                    start_time: occ.start_time,
                    end_time: occ.end_time,
                    notes: bookingForm.notes || null,
                    patient_type: bookingForm.patientType,
                    insurance_plan_id: bookingForm.patientType === 'insurance' ? bookingForm.insurancePlanId || null : null,
                    slot_type: slotType,
                    recurrence_index: idx,
                    recurrence_pattern: recurrencePattern
                }));

                await smartSchedulingService.bookRecurringAppointments(
                    selectedTenant,
                    bookingForm.selectedPatient.id,
                    payloads
                );

                showToast('success', t('mestra.toasts.occurrencesCreatedSuccess', { count: occurrencesCount }));
                setBookingModal({ open: false, doctorId: '', slot: null });

                // Open notification dispatch modal
                setTempBookedAppointments(payloads);
                const initialMsg = buildConsolidatedMessage(bookingForm.selectedPatient.full_name, payloads);
                setNotificationPreviewText(initialMsg);
                
                const pref = await loadPatientPreferences(bookingForm.selectedPatient.id);
                if (pref?.preferred_channel) {
                    setNotificationChannel(pref.preferred_channel);
                } else {
                    setNotificationChannel('whatsapp');
                }
                setRecipientId(bookingForm.selectedPatient.phone || bookingForm.selectedPatient.email || '');
                setShowNotificationModal(true);

            } else {
                const payload: BookAppointmentPayload = {
                    tenant_id: selectedTenant,
                    doctor_id: bookingModal.doctorId,
                    patient_id: bookingForm.selectedPatient.id,
                    type_id: bookingForm.typeId || undefined,
                    date: dateStr,
                    start_time: startTime,
                    end_time: endTime,
                    patient_type: bookingForm.patientType,
                    insurance_plan_id: bookingForm.patientType === 'insurance' ? bookingForm.insurancePlanId || undefined : undefined,
                    slot_type: slotType,
                    notes: bookingForm.notes || undefined,
                    location_id: slot?.location_id || selectedLocation || '',
                };

                const appt = await smartSchedulingService.bookAppointment(payload);
                showToast('success', t('mestra.toasts.bookedFor', { name: bookingForm.selectedPatient.full_name }));

                if (reschedulingFromAppt) {
                    await supabase.from('appointments').update({
                        status: 'canceled',
                        notes: (reschedulingFromAppt.notes || '') + ' - Reagendado'
                    }).eq('id', reschedulingFromAppt.id);
                    setReschedulingFromAppt(null);
                }

                setBookingModal({ open: false, doctorId: '', slot: null });
                
                // Open notification dispatch modal
                setTempBookedAppointments([appt]);
                const pref = await loadPatientPreferences(bookingForm.selectedPatient.id);
                if (pref?.preferred_channel) {
                    setNotificationChannel(pref.preferred_channel);
                } else {
                    setNotificationChannel('whatsapp');
                }
                setRecipientId(bookingForm.selectedPatient.phone || bookingForm.selectedPatient.email || '');
                setShowNotificationModal(true);
            }
        } catch (err: any) {
            const reasonKey: Record<string, string> = {
                SLOT_CONFLICT: 'slotConflict',
                slot_taken: 'slotConflict',
                OUTSIDE_AVAILABILITY: 'outsideAvailability',
            };
            const key = reasonKey[err?.reason];
            showToast('error', key ? t(`mestra.toasts.${key}`) : t('mestra.toasts.bookError', { message: err.message }));
            fetchData();
        }
        setBookingSaving(false);
    };

    // ── Update / Delete ─────────────────────
    const handleUpdateStatus = async (id: string, status: string) => {
        try {
            const updates: any = { status };
            if (status === 'checkin_done') updates.checkin_at = new Date().toISOString();
            await supabase.from('appointments').update(updates).eq('id', id);
            setEditingAppt(null);
            fetchData();
            showToast('success', t('mestra.toasts.statusUpdated'));
        } catch (err: any) { showToast('error', t('mestra.toasts.genericError', { message: err.message })); }
    };

    const handleSaveNotes = async () => {
        if (!editingAppt) return;
        try {
            await supabase.from('appointments').update({ notes: editNotes }).eq('id', editingAppt.id);
            setEditingAppt(null);
            fetchData();
            showToast('success', t('mestra.toasts.notesSaved'));
        } catch (err: any) { showToast('error', t('mestra.toasts.genericError', { message: err.message })); }
    };

    const handleRescheduleClick = () => {
        if (!editingAppt) return;

        setReschedulingFromAppt(editingAppt);

        setBookingForm({
            patientSearch: editingAppt.patients?.full_name || '',
            selectedPatient: editingAppt.patients ? {
                id: editingAppt.patient_id,
                full_name: editingAppt.patients.full_name,
                phone: editingAppt.patients.phone || null,
                email: editingAppt.patients.email || null,
                insurance_provider: editingAppt.patients.insurance_provider || null
            } : null,
            patientType: editingAppt.patient_type || (editingAppt.patients?.insurance_provider ? 'insurance' : 'private'),
            insurancePlanId: editingAppt.insurance_plan_id || '',
            typeId: editingAppt.type_id || '',
            notes: editingAppt.notes || '',
        });

        setEditingAppt(null);
        showToast('info', t('mestra.toasts.selectNewSlotToReschedule'));
    };

    const handleDelete = async (id: string) => {
        try {
            await supabase.from('appointments').delete().eq('id', id);
            setConfirmDelete(null);
            setEditingAppt(null);
            fetchData();
            showToast('success', t('mestra.toasts.appointmentRemoved'));
        } catch (err: any) { showToast('error', t('mestra.toasts.genericError', { message: err.message })); }
    };

    // ── Blocked / outside-hours bands ───────
    // Computed from doctor_availability: any time not covered by a non-'blocked' row
    // is "outside hours"; any time covered by an explicit block_type='blocked' row
    // (lunch break, vacation override, etc.) is "blocked". Both are off-limits for
    // new bookings and for moving/resizing existing appointments into.
    const blockedBandsByDoctor = useMemo(() => {
        const dayStart = DAY_START * 60, dayEnd = DAY_END * 60;
        const clamp = (m: number) => Math.max(dayStart, Math.min(dayEnd, m));
        const result: Record<string, BlockedBand[]> = {};
        visibleDoctors.forEach((doc) => {
            const rows = availabilityByDoctor[doc.id] || [];
            const bands: BlockedBand[] = [];
            if (rows.length === 0) {
                bands.push({ start: dayStart, end: dayEnd, label: 'outsideHours' });
                result[doc.id] = bands;
                return;
            }
            const allIntervals = rows
                .map(r => ({ s: clamp(timeToMin(r.start_time)), e: clamp(timeToMin(r.end_time)) }))
                .sort((a, b) => a.s - b.s);
            const merged: { s: number; e: number }[] = [];
            allIntervals.forEach((iv) => {
                const last = merged[merged.length - 1];
                if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e);
                else merged.push({ ...iv });
            });
            let cursor = dayStart;
            merged.forEach((m) => {
                if (m.s > cursor) bands.push({ start: cursor, end: m.s, label: 'outsideHours' });
                cursor = Math.max(cursor, m.e);
            });
            if (cursor < dayEnd) bands.push({ start: cursor, end: dayEnd, label: 'outsideHours' });
            rows.filter(r => r.block_type === 'blocked').forEach((r) => {
                bands.push({ start: clamp(timeToMin(r.start_time)), end: clamp(timeToMin(r.end_time)), label: 'blocked' });
            });
            result[doc.id] = bands;
        });
        return result;
    }, [visibleDoctors, availabilityByDoctor]);

    // Given a free anchor point (guaranteed not inside any obstacle), returns how far
    // the range around it can stretch before hitting a blocked band or appointment.
    const getFreeBounds = useCallback((docId: string, anchor: number, excludeApptId?: string) => {
        const bands = (blockedBandsByDoctor[docId] || []).map(b => ({ s: b.start, e: b.end }));
        const appts = (appointmentsByDoctor[docId] || [])
            .filter((a: any) => a.id !== excludeApptId)
            .map((a: any) => {
                const s = timeToMin(a.start_time);
                const e = a.end_time ? timeToMin(a.end_time) : s + (a.appointment_types?.duration_minutes || DEFAULT_DURATION);
                return { s, e };
            });
        let lower = DAY_START * 60, upper = DAY_END * 60;
        [...bands, ...appts].forEach((o) => {
            if (o.e <= anchor) lower = Math.max(lower, o.e);
            else if (o.s >= anchor) upper = Math.min(upper, o.s);
        });
        return { lower, upper };
    }, [blockedBandsByDoctor, appointmentsByDoctor]);

    // ── Drag & Drop Engine ──────────────────
    const getGridCoords = useCallback((e: MouseEvent) => {
        if (!gridRef.current || !scrollRef.current) return null;
        const rect = gridRef.current.getBoundingClientRect();
        const scrollTop = scrollRef.current.scrollTop;
        const relX = e.clientX - rect.left;
        const relY = e.clientY - rect.top + scrollTop;
        const colW = rect.width / visibleDoctors.length;
        const colIdx = Math.max(0, Math.min(visibleDoctors.length - 1, Math.floor(relX / colW)));
        const minutes = yToMin(relY);
        return { colIdx, minutes, docId: visibleDoctors[colIdx]?.id || '' };
    }, [visibleDoctors]);

    // Mouse down on APPOINTMENT → start MOVE
    const onApptMouseDown = useCallback((e: React.MouseEvent, appt: any, docId: string) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const startMin = timeToMin(appt.start_time);
        const endMin = appt.end_time ? timeToMin(appt.end_time) : startMin + (appt.appointment_types?.duration_minutes || DEFAULT_DURATION);
        const cardTop = minToY(startMin);

        if (!scrollRef.current || !gridRef.current) return;
        const gridRect = gridRef.current.getBoundingClientRect();
        const scrollTop = scrollRef.current.scrollTop;
        const mouseYInGrid = e.clientY - gridRect.top + scrollTop;
        const offsetY = mouseYInGrid - cardTop;
        const colIdx = visibleDoctors.findIndex(d => d.id === docId);

        dragRef.current = {
            type: 'move', apptId: appt.id, docId, origStart: startMin, origEnd: endMin,
            offsetY, currentDocId: docId, currentStart: startMin, currentEnd: endMin,
        };
        setGhost({ colIndex: colIdx, top: cardTop, height: minToY(endMin) - cardTop, label: `${minToTime(startMin)} – ${minToTime(endMin)}` });
        setIsDragging(true);
    }, [visibleDoctors]);

    // Mouse down on RESIZE HANDLE
    const onResizeMouseDown = useCallback((e: React.MouseEvent, appt: any, docId: string, edge: 'top' | 'bottom') => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const startMin = timeToMin(appt.start_time);
        const endMin = appt.end_time ? timeToMin(appt.end_time) : startMin + (appt.appointment_types?.duration_minutes || DEFAULT_DURATION);

        dragRef.current = {
            type: edge === 'top' ? 'resize-top' : 'resize-bottom',
            apptId: appt.id, docId, origStart: startMin, origEnd: endMin,
            offsetY: 0, currentDocId: docId, currentStart: startMin, currentEnd: endMin,
        };
        const colIdx = visibleDoctors.findIndex(d => d.id === docId);
        setGhost({ colIndex: colIdx, top: minToY(startMin), height: minToY(endMin) - minToY(startMin), label: `${minToTime(startMin)} – ${minToTime(endMin)}` });
        setIsDragging(true);
    }, [visibleDoctors]);

    // Mouse down on EMPTY GRID → start CREATE
    const onGridMouseDown = useCallback((e: React.MouseEvent, docId: string) => {
        if (e.button !== 0 || dragRef.current) return;
        const coords = getGridCoords(e.nativeEvent);
        if (!coords) return;
        const startMin = clampMin(snap(coords.minutes));
        const colIdx = visibleDoctors.findIndex(d => d.id === docId);

        dragRef.current = {
            type: 'create', docId, origStart: startMin, origEnd: startMin + SNAP_MIN,
            offsetY: 0, currentDocId: docId, currentStart: startMin, currentEnd: startMin + SNAP_MIN,
        };
        setGhost({ colIndex: colIdx, top: minToY(startMin), height: minToY(startMin + SNAP_MIN) - minToY(startMin), label: `${minToTime(startMin)} – ${minToTime(startMin + SNAP_MIN)}` });
        setIsDragging(true);
    }, [visibleDoctors, getGridCoords]);

    // Global mousemove + mouseup
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragRef.current) return;
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
                const drag = dragRef.current;
                if (!drag) return;
                const coords = getGridCoords(e);
                if (!coords) return;

                const rawMin = coords.minutes;

                if (drag.type === 'move') {
                    const duration = drag.origEnd - drag.origStart;
                    const newStart = clampMin(snap(rawMin - (drag.offsetY / HOUR_PX) * 60));
                    const newEnd = clampMin(newStart + duration);
                    let s = newEnd > DAY_END * 60 ? DAY_END * 60 - duration : newStart;
                    // Anchor on the last known-valid position (free of obstacles) and clamp
                    // the proposed move so it cannot land on a blocked band or another appointment.
                    const { lower, upper } = getFreeBounds(coords.docId, drag.currentStart, drag.apptId);
                    s = Math.max(lower, Math.min(upper - duration, s));
                    drag.currentStart = s;
                    drag.currentEnd = s + duration;
                    drag.currentDocId = coords.docId;
                    setGhost({
                        colIndex: coords.colIdx,
                        top: minToY(drag.currentStart),
                        height: minToY(drag.currentEnd) - minToY(drag.currentStart),
                        label: `${minToTime(drag.currentStart)} – ${minToTime(drag.currentEnd)}`,
                    });
                } else if (drag.type === 'resize-bottom') {
                    const newEnd = clampMin(Math.max(drag.currentStart + SNAP_MIN, snap(rawMin)));
                    const { upper } = getFreeBounds(drag.docId, drag.currentStart, drag.apptId);
                    drag.currentEnd = Math.min(newEnd, upper);
                    setGhost({
                        colIndex: visibleDoctors.findIndex(d => d.id === drag.docId),
                        top: minToY(drag.currentStart),
                        height: minToY(drag.currentEnd) - minToY(drag.currentStart),
                        label: `${minToTime(drag.currentStart)} – ${minToTime(drag.currentEnd)}`,
                    });
                } else if (drag.type === 'resize-top') {
                    const newStart = clampMin(Math.min(drag.currentEnd - SNAP_MIN, snap(rawMin)));
                    const { lower } = getFreeBounds(drag.docId, drag.currentEnd - 1, drag.apptId);
                    drag.currentStart = Math.max(newStart, lower);
                    setGhost({
                        colIndex: visibleDoctors.findIndex(d => d.id === drag.docId),
                        top: minToY(drag.currentStart),
                        height: minToY(drag.currentEnd) - minToY(drag.currentStart),
                        label: `${minToTime(drag.currentStart)} – ${minToTime(drag.currentEnd)}`,
                    });
                } else if (drag.type === 'create') {
                    const a = drag.origStart;
                    const b = snap(rawMin);
                    const { lower, upper } = getFreeBounds(drag.docId, a);
                    const s = Math.max(lower, clampMin(Math.min(a, b)));
                    const ed = Math.min(upper, clampMin(Math.max(a, b)));
                    drag.currentStart = s;
                    drag.currentEnd = Math.max(ed, s + SNAP_MIN);
                    setGhost({
                        colIndex: visibleDoctors.findIndex(d => d.id === drag.docId),
                        top: minToY(drag.currentStart),
                        height: Math.max(minToY(drag.currentEnd) - minToY(drag.currentStart), SNAP_MIN / 60 * HOUR_PX),
                        label: `${minToTime(drag.currentStart)} – ${minToTime(drag.currentEnd)}`,
                    });
                }
            });
        };

        const handleMouseUp = async () => {
            cancelAnimationFrame(rafRef.current);
            const drag = dragRef.current;
            dragRef.current = null;
            setGhost(null);
            setIsDragging(false);
            if (!drag) return;

            // Ignore micro-drags (less than 1 snap interval of movement)
            const moved = Math.abs(drag.currentStart - drag.origStart) >= SNAP_MIN ||
                          Math.abs(drag.currentEnd - drag.origEnd) >= SNAP_MIN ||
                          drag.currentDocId !== drag.docId;

            if (drag.type === 'move' && drag.apptId && moved) {
                try {
                    await supabase.from('appointments').update({
                        doctor_id: drag.currentDocId,
                        start_time: minToTime(drag.currentStart) + ':00',
                        end_time: minToTime(drag.currentEnd) + ':00',
                    }).eq('id', drag.apptId);
                    showToast('success', t('mestra.toasts.appointmentMoved'));
                    fetchData();
                } catch (err: any) { showToast('error', t('mestra.toasts.moveError', { message: err.message })); }
            } else if ((drag.type === 'resize-top' || drag.type === 'resize-bottom') && drag.apptId && moved) {
                try {
                    await supabase.from('appointments').update({
                        start_time: minToTime(drag.currentStart) + ':00',
                        end_time: minToTime(drag.currentEnd) + ':00',
                    }).eq('id', drag.apptId);
                    showToast('success', t('mestra.toasts.durationUpdated'));
                    fetchData();
                } catch (err: any) { showToast('error', t('mestra.toasts.resizeError', { message: err.message })); }
            } else if (drag.type === 'create' && drag.currentEnd - drag.currentStart >= SNAP_MIN) {
                openBookingFromDrag(drag.docId, drag.currentStart, drag.currentEnd);
            } else if (drag.type === 'move' && drag.apptId && !moved) {
                // Click without drag → open edit modal
                const allAppts = Object.values(appointmentsByDoctor).flat();
                const appt = allAppts.find((a: any) => a.id === drag.apptId);
                if (appt) { setEditingAppt(appt); setEditNotes(appt.notes || ''); }
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [getGridCoords, visibleDoctors, fetchData, appointmentsByDoctor, getFreeBounds]);

    // ── Helpers ──────────────────────────────
    const apptCount = (docId: string) => (appointmentsByDoctor[docId] || []).length;
    const totalAppts = selectedDoctors.reduce((s, id) => s + apptCount(id), 0);
    const totalSlots = selectedDoctors.reduce((s, id) => s + (slotsByDoctor[id] || []).length, 0);

    const statusStyle = (status: string) => {
        const map: Record<string, string> = {
            scheduled: 'bg-white border-l-4 border-l-blue-400 border-y border-r border-ice-200',
            confirmed: 'bg-brand-primary/8 border-l-4 border-l-brand-primary border-y border-r border-brand-primary/20',
            checkin_done: 'bg-emerald-50 border-l-4 border-l-emerald-500 border-y border-r border-emerald-200',
            in_progress: 'bg-blue-50 border-l-4 border-l-blue-500 border-y border-r border-blue-200',
            completed: 'bg-green-50/60 border-l-4 border-l-green-400 border-y border-r border-green-200 opacity-60',
        };
        return map[status] || 'bg-white border-l-4 border-l-gray-300 border-y border-r border-ice-200';
    };

    const slotBg = (slot: SmartSlot) => {
        if (slot.is_auto_released) return 'bg-amber-50/60 border-amber-200';
        if (slot.block_type === 'prime') return 'bg-yellow-50/50 border-yellow-200';
        return 'bg-blue-50/30 border-ice-200';
    };

    // Slot badge inline
    const SlotBadge = ({ slot }: { slot: SmartSlot }) => {
        if (slot.is_auto_released) return <span className="flex items-center gap-0.5 text-[8px] font-black uppercase text-amber-600"><Unlock size={8} />{t('mestra.slotBadge.released')}</span>;
        if (slot.block_type === 'prime') return <span className="flex items-center gap-0.5 text-[8px] font-black uppercase text-yellow-700"><Star size={8} />{t('mestra.slotBadge.prime')}</span>;
        return <span className="flex items-center gap-0.5 text-[8px] font-black uppercase text-graphite-400"><FileText size={8} />{t('mestra.slotBadge.regular')}</span>;
    };

    // ─────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────
    return (
        <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-white">
            {/* ── TOP BAR ── */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-ice-100 shrink-0 bg-white z-20">
                {/* Date nav */}
                <div className="flex items-center bg-ice-50 rounded-xl p-0.5">
                    <button onClick={() => changeDate(-1)} className="p-1.5 hover:bg-white rounded-lg transition-colors border-none bg-transparent cursor-pointer text-graphite-700"><ChevronLeft size={16} /></button>
                    <button onClick={goToToday} className="px-3 py-1.5 flex items-center gap-1.5 border-none bg-transparent cursor-pointer hover:bg-white rounded-lg transition-colors">
                        <CalendarIcon size={14} className="text-brand-primary" />
                        <span className={cn("text-sm font-black whitespace-nowrap", isToday && "text-brand-primary")}>
                            {isToday ? t('mestra.today') : formatDateLabel(selectedDateStr)}
                        </span>
                    </button>
                    <button onClick={() => changeDate(1)} className="p-1.5 hover:bg-white rounded-lg transition-colors border-none bg-transparent cursor-pointer text-graphite-700"><ChevronRight size={16} /></button>
                </div>

                <div className="w-px h-6 bg-ice-200" />

                {/* Doctor pills */}
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1 min-w-0">
                    {doctors.map(doc => {
                        const isSel = selectedDoctors.includes(doc.id);
                        const c = doc.color || '#1152d4';
                        const cnt = apptCount(doc.id);
                        return (
                            <button key={doc.id} onClick={() => toggleDoctor(doc.id)}
                                className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all border cursor-pointer whitespace-nowrap shrink-0",
                                    isSel ? "text-white shadow-sm" : "bg-white text-graphite-600 border-ice-200 hover:border-ice-300"
                                )} style={isSel ? { backgroundColor: c, borderColor: c } : {}}>
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: isSel ? 'rgba(255,255,255,0.5)' : c }} />
                                {doc.full_name.split(' ').slice(0, 2).join(' ')}
                                {isSel && cnt > 0 && <span className="bg-white/25 text-[9px] font-black px-1.5 py-0.5 rounded-md">{cnt}</span>}
                            </button>
                        );
                    })}
                </div>

                <div className="w-px h-6 bg-ice-200" />

                {userRole === 'super_admin' && tenants.length > 1 && (
                    <>
                        <div className="flex bg-ice-50 p-0.5 rounded-xl shrink-0">
                            {tenants.map(t => (
                                <button key={t.id} onClick={() => setSelectedTenant(t.id)}
                                    className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border-none cursor-pointer",
                                        selectedTenant === t.id ? "bg-white text-brand-primary shadow-sm" : "text-graphite-400 bg-transparent"
                                    )}>{t.name?.split(' ').slice(0, 2).join(' ')}</button>
                            ))}
                        </div>
                        {locations.length > 0 && <div className="w-px h-6 bg-ice-200" />}
                    </>
                )}

                {locations.length > 0 && (
                    <div className="flex bg-ice-50 p-0.5 rounded-xl shrink-0">
                        {locations.map(loc => (
                            <button key={loc.id} onClick={() => setSelectedLocation(loc.id)}
                                className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border-none cursor-pointer",
                                    selectedLocation === loc.id ? "bg-white text-brand-primary shadow-sm" : "text-graphite-400 bg-transparent"
                                )}>{loc.name}</button>
                        ))}
                    </div>
                )}

                <div className="flex items-center gap-2 shrink-0 text-[10px] font-bold text-graphite-400">
                    <span className="bg-brand-primary/10 text-brand-primary px-2 py-1 rounded-lg">{t('mestra.appointmentsCount', { count: totalAppts })}</span>
                    <span className="bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg">{t('mestra.freeSlotsCount', { count: totalSlots })}</span>
                    <button
                        onClick={() => setWaitlistOpen(true)}
                        className="flex items-center gap-1.5 bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20 px-2 py-1 rounded-lg transition-colors border-none cursor-pointer text-[10px] font-bold"
                        title={t('waitlistDrawer.title')}
                    >
                        <Clock size={12} />
                        {t('waitlistDrawer.buttonLabel')}
                        {waitlistCount > 0 && (
                            <span className="bg-brand-primary text-white text-[9px] font-black px-1.5 py-0.5 rounded-md min-w-[18px] text-center">{waitlistCount}</span>
                        )}
                    </button>
                </div>
            </div>

            {/* ── CALENDAR BODY ── */}
            {loading ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
                </div>
            ) : visibleDoctors.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <StethoscopeIcon size={48} className="mx-auto text-graphite-200 mb-4" />
                        <p className="text-graphite-400 font-bold">{t('mestra.selectProfessional')}</p>
                    </div>
                </div>
            ) : (
                <>
                    {/* Column Headers (sticky) */}
                    <div className="flex shrink-0 border-b border-ice-200 bg-ice-50/80 backdrop-blur-sm z-10">
                        <div className="w-14 shrink-0" />
                        {visibleDoctors.map(doc => (
                            <div key={doc.id} className="flex-1 min-w-[180px] px-3 py-2 border-l border-ice-100">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: doc.color || '#1152d4' }} />
                                    <span className="text-[11px] font-black text-graphite-900 truncate">{doc.full_name}</span>
                                    {doc.specialty && <span className="text-[9px] text-graphite-400 font-medium truncate">{doc.specialty}</span>}
                                    <span className="ml-auto text-[9px] font-bold text-graphite-300">{apptCount(doc.id)}/{(slotsByDoctor[doc.id] || []).length + apptCount(doc.id)}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Scrollable Time Grid */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto" style={{ userSelect: isDragging ? 'none' : 'auto' }}>
                        <div className="flex" style={{ height: TOTAL_PX, minWidth: 180 * visibleDoctors.length + 56 }}>
                            {/* Time Gutter */}
                            <div className="w-16 shrink-0 relative border-r border-ice-100 bg-ice-50/50">
                                {HOURS.map(h => (
                                    <div key={h} className="absolute w-full flex items-start justify-end pr-3" style={{ top: (h - DAY_START) * HOUR_PX }}>
                                        <span className={cn("text-[11px] font-black -mt-[7px]", h === DAY_START ? "text-transparent" : "text-graphite-700")}>
                                            {formatSlot(`${String(h).padStart(2, '0')}:00`)}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Doctor Columns */}
                            <div ref={gridRef} className="flex-1 flex relative">
                                {visibleDoctors.map((doc) => {
                                    const docSlots = slotsByDoctor[doc.id] || [];
                                    const docAppts = appointmentsByDoctor[doc.id] || [];

                                    return (
                                        <div
                                            key={doc.id}
                                            className="flex-1 min-w-[180px] relative border-l border-ice-100"
                                            style={{ height: TOTAL_PX }}
                                            onMouseDown={(e) => {
                                                // Only trigger create if clicking on empty, bookable space
                                                const target = e.target as HTMLElement;
                                                if (target.closest('[data-appt]') || target.closest('[data-slot]') || target.closest('[data-blocked]')) return;
                                                onGridMouseDown(e, doc.id);
                                            }}
                                        >
                                            {/* Hour grid lines */}
                                            {HOURS.map(h => (
                                                <React.Fragment key={h}>
                                                    <div className="absolute left-0 right-0 border-b border-ice-200" style={{ top: (h - DAY_START) * HOUR_PX }} />
                                                    <div className="absolute left-0 right-0 border-b border-ice-100" style={{ top: (h - DAY_START) * HOUR_PX + HOUR_PX / 2 }} />
                                                </React.Fragment>
                                            ))}

                                            {/* Blocked / outside-hours bands — not selectable */}
                                            {(blockedBandsByDoctor[doc.id] || []).map((band, i) => {
                                                const top = minToY(band.start);
                                                const h = minToY(band.end) - top;
                                                if (h <= 0) return null;
                                                const label = band.label === 'blocked' ? t('mestra.blockedLabel') : t('mestra.outsideHoursLabel');
                                                return (
                                                    <div
                                                        key={`blocked-${i}`}
                                                        data-blocked
                                                        className="absolute left-0 right-0 cursor-not-allowed"
                                                        style={{
                                                            top, height: h,
                                                            background: 'repeating-linear-gradient(135deg, rgba(148,163,184,0.16) 0px, rgba(148,163,184,0.16) 7px, transparent 7px, transparent 14px)'
                                                        }}
                                                        title={label}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            showToast('info', band.label === 'blocked' ? t('mestra.toasts.blockedSlotClick') : t('mestra.toasts.outsideHoursClick'));
                                                        }}
                                                    >
                                                        {h >= 28 && (
                                                            <span className="absolute top-1 left-1.5 text-[8px] font-black uppercase tracking-wide text-graphite-400/70 select-none">
                                                                {label}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {/* Available Slots (background indicators) */}
                                            {docSlots.map((slot, i) => {
                                                const sMin = timeToMin(slot.slot_time);
                                                const eMin = timeToMin(slot.slot_end);
                                                const top = minToY(sMin);
                                                const h = minToY(eMin) - top;
                                                return (
                                                    <div
                                                        key={i}
                                                        data-slot
                                                        className={cn("absolute left-1 right-1 rounded-lg border border-dashed cursor-pointer transition-all hover:opacity-90 group/slot overflow-hidden", slotBg(slot))}
                                                        style={{ top, height: h }}
                                                        onClick={(e) => { e.stopPropagation(); openBookingModal(doc.id, slot); }}
                                                        title={slot.location_name ? `${slot.block_type === 'prime' ? t('mestra.slotBadge.prime') : slot.is_auto_released ? t('mestra.slotBadge.released') : t('mestra.slotBadge.regular')} · ${slot.location_name}` : undefined}
                                                    >
                                                        <div className={cn("flex items-center justify-between px-2", h < 36 ? "py-0.5" : "py-1")}>
                                                            <div className="flex items-center gap-1 min-w-0">
                                                                <SlotBadge slot={slot} />
                                                                {h < 48 && h >= 36 && slot.location_name && (
                                                                    <span className="text-[8px] text-graphite-400 truncate font-medium shrink min-w-0">
                                                                        · {slot.location_name}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <Plus size={h < 36 ? 10 : 12} className="text-brand-primary opacity-0 group-hover/slot:opacity-100 transition-opacity shrink-0" />
                                                        </div>
                                                        {h >= 48 && slot.location_name && (
                                                            <div className="flex items-center gap-0.5 px-2 text-[8px] text-graphite-400 truncate">
                                                                <MapPin size={7} className="shrink-0" />
                                                                <span className="truncate">{slot.location_name}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {/* Appointments */}
                                            {docAppts.map((appt: any) => {
                                                const sMin = timeToMin(appt.start_time);
                                                const eMin = appt.end_time ? timeToMin(appt.end_time) : sMin + (appt.appointment_types?.duration_minutes || DEFAULT_DURATION);
                                                const top = minToY(sMin);
                                                const h = Math.max(minToY(eMin) - top, 24);
                                                const isBeingDragged = isDragging && dragRef.current?.apptId === appt.id;

                                                return (
                                                    <div
                                                        key={appt.id}
                                                        data-appt
                                                        className={cn(
                                                            "absolute left-1.5 right-1.5 rounded-xl shadow-sm transition-shadow hover:shadow-md group/card",
                                                            statusStyle(appt.status),
                                                            isBeingDragged && "opacity-30",
                                                            isDragging ? "pointer-events-none" : "cursor-grab active:cursor-grabbing"
                                                        )}
                                                        style={{ top, height: h, zIndex: isBeingDragged ? 1 : 5 }}
                                                        onMouseDown={(e) => onApptMouseDown(e, appt, doc.id)}
                                                    >
                                                        {/* Resize handle TOP */}
                                                        <div
                                                            className="absolute top-0 left-2 right-2 h-2 cursor-n-resize z-10 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity"
                                                            onMouseDown={(e) => onResizeMouseDown(e, appt, doc.id, 'top')}
                                                        >
                                                            <div className="w-8 h-1 rounded-full bg-graphite-300/50" />
                                                        </div>

                                                        {/* Content */}
                                                        <div className="px-2.5 py-1.5 overflow-hidden h-full flex flex-col justify-center">
                                                            <div className="flex items-center gap-1.5">
                                                                {appt.status === 'confirmed' && <CheckCircle2 size={10} className="text-brand-primary shrink-0" />}
                                                                {appt.status === 'checkin_done' && <UserCheck size={10} className="text-emerald-500 shrink-0" />}
                                                                <span className="text-[11px] font-black text-graphite-900 truncate leading-tight">
                                                                    {appt.patients?.full_name || t('mestra.patientFallback')}
                                                                </span>
                                                                {appt.patient_type === 'insurance' && <Shield size={9} className="text-emerald-400 shrink-0" />}
                                                                {appt.recurring_group_id && <span title="Agendamento Recorrente"><Repeat size={9} className="text-brand-primary shrink-0" /></span>}
                                                            </div>
                                                            {h > 36 && (
                                                                <div className="flex items-center gap-1 mt-0.5">
                                                                    <span className="text-[9px] text-graphite-400 font-medium truncate">
                                                                        {appt.appointment_types?.name || appt.notes || t('mestra.consultaFallback')}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {h > 52 && (
                                                                <span className="text-[9px] text-graphite-300 font-medium mt-0.5">
                                                                    {formatSlot(appt.start_time)} – {appt.end_time ? formatSlot(appt.end_time) : ''}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Resize handle BOTTOM */}
                                                        <div
                                                            className="absolute bottom-0 left-2 right-2 h-2 cursor-s-resize z-10 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity"
                                                            onMouseDown={(e) => onResizeMouseDown(e, appt, doc.id, 'bottom')}
                                                        >
                                                            <div className="w-8 h-1 rounded-full bg-graphite-300/50" />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })}

                                {/* ── Current Time Indicator ── */}
                                {isToday && nowMin >= DAY_START * 60 && nowMin <= DAY_END * 60 && (
                                    <div className="absolute left-0 right-0 z-20 pointer-events-none flex items-center" style={{ top: minToY(nowMin) }}>
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1 shrink-0 shadow-sm" />
                                        <div className="flex-1 h-[2px] bg-red-500 shadow-sm" />
                                    </div>
                                )}

                                {/* ── Drag Ghost ── */}
                                {ghost && (
                                    <div
                                        className="absolute rounded-xl bg-brand-primary/15 border-2 border-brand-primary/40 z-30 pointer-events-none backdrop-blur-[1px] flex items-center justify-center"
                                        style={{
                                            top: ghost.top,
                                            height: ghost.height,
                                            left: `calc(${(ghost.colIndex / visibleDoctors.length) * 100}% + 4px)`,
                                            width: `calc(${100 / visibleDoctors.length}% - 8px)`,
                                        }}
                                    >
                                        <span className="text-[11px] font-black text-brand-primary bg-white/80 px-2 py-0.5 rounded-lg shadow-sm">
                                            {ghost.label}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* ========== BOOKING MODAL ========== */}
            <AnimatePresence>
                {bookingModal.open && (
                    <>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]"
                            onClick={() => setBookingModal({ open: false, doctorId: '', slot: null })} />
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                            <div className="bg-white pointer-events-auto w-full max-w-lg rounded-4xl shadow-2xl overflow-hidden border border-white/20">
                                <div className="px-8 py-5 border-b border-ice-100 bg-ice-50/50 flex justify-between items-center">
                                    <div>
                                        <h3 className="text-lg font-black text-graphite-900">{t('mestra.bookingModal.title')}</h3>
                                        <div className="flex items-center gap-3 mt-1">
                                            {(() => {
                                                const sTime = bookingModal.slot?.slot_time || bookingModal.prefillStart || '08:00';
                                                const selType = appointmentTypes.find(t => t.id === bookingForm.typeId);
                                                const dur = selType?.duration_minutes || DEFAULT_DURATION;
                                                const eTime = minToTime(timeToMin(sTime) + dur);
                                                return (
                                                    <span className="text-xs text-graphite-500 font-medium flex items-center gap-1">
                                                        <Clock size={12} />
                                                        {`${formatSlot(sTime)} – ${formatSlot(eTime)}`}
                                                    </span>
                                                );
                                            })()}
                                            {bookingModal.slot && <SlotBadge slot={bookingModal.slot} />}
                                        </div>
                                    </div>
                                    <IconButton onClick={() => setBookingModal({ open: false, doctorId: '', slot: null })}>
                                        <X size={20} />
                                    </IconButton>
                                </div>

                                <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
                                    {/* Patient Search */}
                                    <div>
                                        <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">{t('mestra.bookingModal.patientLabel')}</label>
                                        {bookingForm.selectedPatient ? (
                                            <div className="flex items-center gap-3 p-3 bg-brand-primary/5 border border-brand-primary/20 rounded-xl">
                                                <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary"><User size={18} /></div>
                                                <div className="flex-1">
                                                    <p className="text-sm font-black text-graphite-900">{bookingForm.selectedPatient.full_name}</p>
                                                    <p className="text-xs text-graphite-400">{bookingForm.selectedPatient.phone || bookingForm.selectedPatient.email || ''}</p>
                                                </div>
                                                <button onClick={() => setBookingForm(prev => ({ ...prev, selectedPatient: null, patientSearch: '' }))}
                                                    className="p-1.5 hover:bg-white rounded-lg transition-colors border-none bg-transparent cursor-pointer text-graphite-400"><X size={16} /></button>
                                            </div>
                                        ) : isCreatingPatient ? (
                                            <div className="p-4 bg-ice-50/50 border border-ice-200 rounded-2xl space-y-3">
                                                <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">{t('mestra.bookingModal.newPatient.heading')}</p>
                                                <div>
                                                    <label className="text-[10px] text-graphite-400 font-bold block mb-1">{t('mestra.bookingModal.newPatient.fullNameLabel')}</label>
                                                    <input
                                                        type="text"
                                                        value={bookingForm.patientSearch}
                                                        onChange={(e) => setBookingForm(prev => ({ ...prev, patientSearch: e.target.value }))}
                                                        className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand-primary"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-[10px] text-graphite-400 font-bold block mb-1">{t('mestra.bookingModal.newPatient.phoneLabel')}</label>
                                                        <input
                                                            type="text"
                                                            value={newPatientData.phone}
                                                            onChange={(e) => setNewPatientData(prev => ({ ...prev, phone: e.target.value }))}
                                                            placeholder="(00) 99999-9999"
                                                            className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand-primary"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] text-graphite-400 font-bold block mb-1">{t('mestra.bookingModal.newPatient.emailLabel')}</label>
                                                        <input
                                                            type="email"
                                                            value={newPatientData.email}
                                                            onChange={(e) => setNewPatientData(prev => ({ ...prev, email: e.target.value }))}
                                                            placeholder="email@provedor.com"
                                                            className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand-primary"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 pt-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsCreatingPatient(false)}
                                                        className="flex-1 py-2 bg-white border border-ice-200 rounded-xl text-xs font-bold text-graphite-600 hover:bg-ice-50 transition-all cursor-pointer"
                                                    >
                                                        {t('mestra.bookingModal.cancel')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleSaveNewPatient}
                                                        className="flex-1 py-2 bg-brand-primary text-white border border-brand-primary rounded-xl text-xs font-bold hover:bg-brand-primary-dark transition-all cursor-pointer"
                                                    >
                                                        {t('mestra.bookingModal.newPatient.saveAndSelect')}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
                                                <input type="text" value={bookingForm.patientSearch} onChange={(e) => handlePatientSearch(e.target.value)}
                                                    placeholder={t('mestra.bookingModal.patientSearchPlaceholder')} autoFocus
                                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-10 pr-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors" />
                                                {bookingForm.patientSearch.length >= 2 && (
                                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-ice-200 rounded-xl shadow-lg z-10 max-h-56 overflow-y-auto">
                                                        {patientResults.map(p => (
                                                            <button key={p.id} onClick={() => { setBookingForm(prev => ({ ...prev, selectedPatient: p, patientSearch: p.full_name, patientType: p.insurance_provider ? 'insurance' : 'private' })); setPatientResults([]); }}
                                                                className="w-full text-left px-4 py-2.5 hover:bg-ice-50 transition-colors border-none bg-transparent cursor-pointer flex items-center gap-3">
                                                                <User size={14} className="text-graphite-300" />
                                                                <div>
                                                                    <p className="text-sm font-bold text-graphite-900">{p.full_name}</p>
                                                                    <p className="text-xs text-graphite-400">{p.phone || p.email || ''}</p>
                                                                </div>
                                                                {p.insurance_provider && <Shield size={12} className="ml-auto text-emerald-400" />}
                                                            </button>
                                                        ))}
                                                        <button 
                                                            type="button"
                                                            onClick={() => {
                                                                setNewPatientData({ phone: '', email: '' });
                                                                setIsCreatingPatient(true);
                                                            }}
                                                            className="w-full text-left px-4 py-3 hover:bg-brand-primary/5 transition-colors border-t border-ice-100 bg-white cursor-pointer flex items-center gap-2 text-brand-primary font-bold text-xs"
                                                        >
                                                            <Plus size={14} />
                                                            Cadastrar novo: "{bookingForm.patientSearch}"
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Patient Type */}
                                    <div>
                                        <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">{t('mestra.bookingModal.patientTypeLabel')}</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={() => setBookingForm(prev => ({ ...prev, patientType: 'private' }))}
                                                className={cn("py-2.5 rounded-xl text-xs font-bold border cursor-pointer transition-all flex items-center justify-center gap-2",
                                                    bookingForm.patientType === 'private' ? "bg-brand-primary text-white border-brand-primary" : "bg-white text-graphite-600 border-ice-200")}>
                                                <User size={14} /> {t('mestra.bookingModal.private')}
                                            </button>
                                            <button onClick={() => setBookingForm(prev => ({ ...prev, patientType: 'insurance' }))}
                                                className={cn("py-2.5 rounded-xl text-xs font-bold border cursor-pointer transition-all flex items-center justify-center gap-2",
                                                    bookingForm.patientType === 'insurance' ? "bg-emerald-500 text-white border-emerald-500" : "bg-white text-graphite-600 border-ice-200")}>
                                                <Shield size={14} /> {t('mestra.bookingModal.insurance')}
                                            </button>
                                        </div>
                                    </div>

                                    {bookingForm.patientType === 'insurance' && (
                                        <div>
                                            <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">{t('mestra.bookingModal.insurance')}</label>
                                            {doctorPlans.length === 0 ? (
                                                <p className="text-xs text-amber-500 font-medium bg-amber-50 p-3 rounded-xl border border-amber-200">{t('mestra.bookingModal.noInsurancePlans')}</p>
                                            ) : (
                                                <select value={bookingForm.insurancePlanId} onChange={(e) => setBookingForm(prev => ({ ...prev, insurancePlanId: e.target.value }))}
                                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium cursor-pointer focus:outline-none focus:border-brand-primary transition-colors">
                                                    <option value="">{t('mestra.bookingModal.selectInsurancePlaceholder')}</option>
                                                    {doctorPlans.map((dp: any) => <option key={dp.insurance_plan_id} value={dp.insurance_plan_id}>{dp.insurance_plans?.name || t('mestra.bookingModal.insurance')}</option>)}
                                                </select>
                                            )}
                                        </div>
                                    )}

                                    <div>
                                        <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">{t('mestra.bookingModal.appointmentTypeLabel')}</label>
                                        <select value={bookingForm.typeId} onChange={(e) => {
                                            const newTypeId = e.target.value;
                                            setBookingForm(prev => ({ ...prev, typeId: newTypeId }));
                                            
                                            // Auto-assign professional if only 1 is mapped
                                            const linkedDocIds = doctorServices
                                                .filter(ds => ds.service_id === newTypeId)
                                                .map(ds => ds.doctor_id);
                                            let currentDocId = bookingModal.doctorId;
                                            if (linkedDocIds.length === 1) {
                                                currentDocId = linkedDocIds[0];
                                                setBookingModal(prev => ({ ...prev, doctorId: linkedDocIds[0] }));
                                                showToast('info', t('mestra.toasts.autoSelectedProfessional'));
                                            }
                                            
                                            if (isRecurring) {
                                                setTimeout(() => generateOccurrencesPreview(currentDocId, newTypeId), 50);
                                            }
                                        }}
                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium cursor-pointer focus:outline-none focus:border-brand-primary transition-colors">
                                            <option value="">{t('mestra.bookingModal.selectTypePlaceholder')}</option>
                                            {bookingAppointmentTypes.map(t => <option key={t.id} value={t.id}>{t.name} ({t.duration_minutes}min)</option>)}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">{t('mestra.bookingModal.notesLabel')}</label>
                                        <textarea value={bookingForm.notes || ''} onChange={(e) => setBookingForm(prev => ({ ...prev, notes: e.target.value }))}
                                            placeholder={t('mestra.bookingModal.notesPlaceholder')}
                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors resize-none min-h-[60px]" />
                                    </div>

                                    {/* Toggle Recurrence */}
                                    <div className="flex items-center justify-between p-3 bg-ice-50 rounded-xl border border-ice-100">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-black text-graphite-850">Agendamento Recorrente</span>
                                            <span className="text-[10px] text-graphite-400">Marcar várias consultas de forma automática</span>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={isRecurring}
                                            onChange={(e) => {
                                                setIsRecurring(e.target.checked);
                                                if (e.target.checked) {
                                                    setTimeout(() => generateOccurrencesPreview(), 50);
                                                } else {
                                                    setGeneratedOccurrences([]);
                                                }
                                            }}
                                            className="w-4 h-4 text-brand-primary border-ice-300 rounded focus:ring-brand-primary cursor-pointer font-bold"
                                        />
                                    </div>

                                    {/* Recurrence Panel */}
                                    {isRecurring && (
                                        <div className="p-4 bg-ice-50/50 border border-ice-200 rounded-2xl space-y-4">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-[10px] font-black text-graphite-400 uppercase mb-1.5 block">Frequência</label>
                                                    <select
                                                        value={recurrencePattern}
                                                        onChange={(e) => {
                                                            const val = e.target.value as any;
                                                            setRecurrencePattern(val);
                                                            setTimeout(() => generateOccurrencesPreview(), 50);
                                                        }}
                                                        className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand-primary"
                                                    >
                                                        <option value="weekly">Semanal</option>
                                                        <option value="biweekly">Quinzenal</option>
                                                        <option value="monthly">Mensal</option>
                                                        <option value="d60">A cada 60 dias</option>
                                                        <option value="d90">A cada 90 dias</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black text-graphite-400 uppercase mb-1.5 block">Nº de Consultas</label>
                                                    <input
                                                        type="number"
                                                        min={2}
                                                        max={24}
                                                        value={occurrencesCount}
                                                        onChange={(e) => {
                                                            const val = Math.max(2, Math.min(24, Number(e.target.value)));
                                                            setOccurrencesCount(val);
                                                            setTimeout(() => generateOccurrencesPreview(), 50);
                                                        }}
                                                        className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-brand-primary"
                                                    />
                                                </div>
                                            </div>

                                            {/* Preview Header */}
                                            <div className="flex items-center justify-between border-t border-ice-200 pt-3">
                                                <span className="text-[10px] font-black text-graphite-400 uppercase">Preview dos Agendamentos ({generatedOccurrences.length})</span>
                                                <button type="button" className="text-brand-primary bg-transparent border-none text-[10px] font-black cursor-pointer hover:underline" onClick={() => generateOccurrencesPreview()}>
                                                    🔄 Atualizar
                                                </button>
                                            </div>

                                            {/* Occurrences List */}
                                            {recurrenceLoading ? (
                                                <div className="flex justify-center py-4">
                                                    <div className="w-5 h-5 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
                                                </div>
                                            ) : (
                                                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                                    {generatedOccurrences.map((occ, idx) => (
                                                        <div key={idx} className={cn("p-2.5 rounded-xl border text-xs space-y-1.5 bg-white transition-all",
                                                            occ.is_conflict ? "border-amber-200 bg-amber-50/20" : "border-ice-200"
                                                        )}>
                                                            <div className="flex items-center justify-between font-black text-graphite-850">
                                                                <span>Consulta #{idx + 1}</span>
                                                                <span className={occ.is_conflict ? "text-amber-600 font-black" : "text-graphite-500"}>
                                                                    {occ.date.split('-').reverse().slice(0, 2).join('/')} · {formatSlot(occ.start_time)}
                                                                </span>
                                                            </div>
                                                            
                                                            <div className="flex flex-col gap-1 text-[10px] text-graphite-500 font-medium">
                                                                <div>Procedimento: <span className="font-bold text-graphite-800">{occ.type_name}</span></div>
                                                                <div>Profissional: <span className="font-bold text-graphite-800">{occ.doctor_name}</span></div>
                                                            </div>

                                                            {occ.is_conflict && (
                                                                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-[10px] font-semibold text-amber-900 space-y-1">
                                                                    <div className="flex items-center gap-1">
                                                                        <AlertTriangle size={10} className="text-amber-500" />
                                                                        <span>Conflito: {occ.conflict_reason === 'DOCTOR_ABSENT' ? 'Profissional ausente (férias/licença)' : occ.conflict_reason === 'OUTSIDE_AVAILABILITY' ? 'Fora do horário do profissional' : 'Horário ocupado'}</span>
                                                                    </div>
                                                                    {occ.suggested_slot && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const updated = [...generatedOccurrences];
                                                                                updated[idx] = {
                                                                                    ...updated[idx],
                                                                                    date: occ.suggested_slot.date,
                                                                                    start_time: occ.suggested_slot.slot_time,
                                                                                    end_time: occ.suggested_slot.slot_end,
                                                                                    is_conflict: false,
                                                                                    conflict_reason: null,
                                                                                    suggested_slot: null,
                                                                                    is_edited: true
                                                                                };
                                                                                setGeneratedOccurrences(updated);
                                                                            }}
                                                                            className="w-full text-left p-1 bg-white border border-amber-200 rounded-md hover:bg-amber-50 text-[9px] font-bold text-brand-primary cursor-pointer flex items-center justify-between"
                                                                        >
                                                                            <span>💡 Aceitar sugestão: {occ.suggested_slot.date.split('-').reverse().slice(0, 2).join('/')} às {formatSlot(occ.suggested_slot.slot_time)}</span>
                                                                            <ChevronRight size={10} className="text-brand-primary" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}

                                                            <div className="flex gap-1.5 pt-1">
                                                                <select
                                                                    value={occ.doctor_id}
                                                                    onChange={(e) => {
                                                                        const docId = e.target.value;
                                                                        const updated = [...generatedOccurrences];
                                                                        updated[idx] = {
                                                                            ...updated[idx],
                                                                            doctor_id: docId,
                                                                            doctor_name: doctors.find(d => d.id === docId)?.full_name || '',
                                                                            is_edited: true
                                                                        };
                                                                        if (futureScheduleData) {
                                                                            const check = checkSlotAvailabilityLocal(occ.date, occ.start_time, occ.end_time, docId, bookingModal.slot?.location_id || selectedLocation || '', futureScheduleData);
                                                                            updated[idx].is_conflict = !check.available;
                                                                            updated[idx].conflict_reason = check.reason;
                                                                        }
                                                                        setGeneratedOccurrences(updated);
                                                                    }}
                                                                    className="flex-1 bg-ice-50 border border-ice-200 rounded-lg px-1.5 py-0.5 text-[9px] font-bold cursor-pointer"
                                                                >
                                                                    {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                                                                </select>

                                                                <select
                                                                    value={occ.type_id}
                                                                    onChange={(e) => {
                                                                        const tId = e.target.value;
                                                                        const typeObj = bookingAppointmentTypes.find(t => t.id === tId);
                                                                        const updated = [...generatedOccurrences];
                                                                        updated[idx] = {
                                                                            ...updated[idx],
                                                                            type_id: tId,
                                                                            type_name: typeObj?.name || '',
                                                                            is_edited: true
                                                                        };
                                                                        setGeneratedOccurrences(updated);
                                                                    }}
                                                                    className="flex-1 bg-ice-50 border border-ice-200 rounded-lg px-1.5 py-0.5 text-[9px] font-bold cursor-pointer"
                                                                >
                                                                    {bookingAppointmentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                                                </select>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex gap-3 pt-2">
                                        <Button variant="ghost" className="flex-1 justify-center" onClick={() => setBookingModal({ open: false, doctorId: '', slot: null })}>
                                            {t('mestra.bookingModal.cancel')}
                                        </Button>
                                        <Button variant="primary" className="flex-[2] justify-center" disabled={!bookingForm.selectedPatient || bookingSaving} onClick={handleBook}>
                                            {bookingSaving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><CheckCircle2 size={16} /> {t('mestra.bookingModal.confirm')}</>}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* ========== CONSOLIDATED NOTIFICATION MODAL ========== */}
            <AnimatePresence>
                {showNotificationModal && bookingForm.selectedPatient && (
                    <>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[120]"
                            onClick={closeNotificationModal} />
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="fixed inset-0 z-[130] flex items-center justify-center p-4 pointer-events-none">
                            <div className="bg-white pointer-events-auto w-full max-w-md rounded-4xl shadow-2xl overflow-hidden border border-white/20">
                                <div className="px-8 py-5 border-b border-ice-100 bg-ice-50/50 flex justify-between items-center">
                                    <div>
                                        <h3 className="text-sm font-black text-graphite-900">Enviar Resumo de Agendamentos</h3>
                                        <p className="text-xs text-graphite-400 font-medium">Notifique o paciente sobre as datas reservadas</p>
                                    </div>
                                    <IconButton onClick={closeNotificationModal}><X size={18} /></IconButton>
                                </div>
                                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                                    {/* Channel Selector */}
                                    <div>
                                        <label className="text-[10px] font-black text-graphite-400 uppercase mb-2 block">Canal de Envio</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {[
                                                { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, color: 'text-green-600 border-green-200 bg-green-50/10' },
                                                { id: 'email', label: 'E-mail', icon: Mail, color: 'text-violet-650 border-violet-200 bg-violet-50/10' },
                                                { id: 'sms', label: 'SMS', icon: Phone, color: 'text-graphite-700 border-ice-300 bg-ice-50/15' },
                                                { id: 'instagram', label: 'Instagram DM', icon: Instagram, color: 'text-pink-600 border-pink-200 bg-pink-50/10' },
                                            ].map(ch => {
                                                const isSel = notificationChannel === ch.id;
                                                return (
                                                    <button key={ch.id} onClick={() => {
                                                        setNotificationChannel(ch.id);
                                                        if (ch.id === 'email') {
                                                            setRecipientId(bookingForm.selectedPatient?.email || '');
                                                        } else {
                                                            setRecipientId(bookingForm.selectedPatient?.phone || '');
                                                        }
                                                    }}
                                                        className={cn("flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer",
                                                            isSel ? "bg-brand-primary text-white border-brand-primary" : "bg-white text-graphite-600 border-ice-200 hover:border-ice-300"
                                                        )}>
                                                        <ch.icon size={14} className={isSel ? 'text-white' : ch.color.split(' ')[0]} />
                                                        {ch.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Destination Identifier */}
                                    <div>
                                        <label className="text-[10px] font-black text-graphite-400 uppercase mb-1.5 block">
                                            {notificationChannel === 'email' ? 'Endereço de E-mail' : 'Número de Telefone'}
                                        </label>
                                        <input
                                            type="text"
                                            value={recipientId}
                                            onChange={(e) => setRecipientId(e.target.value)}
                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-2.5 text-xs font-semibold focus:outline-none focus:border-brand-primary"
                                        />
                                    </div>

                                    {/* Link Customization Options */}
                                    {tempBookedAppointments.length === 1 && (
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-graphite-400 uppercase block">Incluir Links na Confirmação</label>
                                            <div className="grid grid-cols-1 gap-2">
                                                <button
                                                    onClick={() => setIncludeCheckin(!includeCheckin)}
                                                    className={cn(
                                                        "flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left bg-white cursor-pointer w-full",
                                                        includeCheckin ? "border-brand-primary/30 shadow-sm" : "border-ice-200 opacity-60"
                                                    )}
                                                >
                                                    <div className={cn(
                                                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                                        includeCheckin ? "bg-brand-primary/10 text-brand-primary" : "bg-ice-50 text-graphite-400"
                                                    )}>
                                                        <Link2 size={16} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[11px] font-black text-graphite-900">{t('sidebarBookingView.checkinOption.title')}</p>
                                                        <p className="text-[9px] text-graphite-400">{t('sidebarBookingView.checkinOption.subtitle')}</p>
                                                    </div>
                                                    <div className={cn(
                                                        "w-4 h-4 rounded-full border flex items-center justify-center transition-colors shrink-0",
                                                        includeCheckin ? "bg-brand-primary border-brand-primary" : "border-ice-300"
                                                    )}>
                                                        {includeCheckin && <Check size={10} className="text-white" strokeWidth={4} />}
                                                    </div>
                                                </button>

                                                <button
                                                    onClick={() => setIncludePayment(!includePayment)}
                                                    className={cn(
                                                        "flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left bg-white cursor-pointer w-full",
                                                        includePayment ? "border-brand-primary/30 shadow-sm" : "border-ice-200 opacity-60"
                                                    )}
                                                >
                                                    <div className={cn(
                                                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                                        includePayment ? "bg-brand-primary/10 text-brand-primary" : "bg-ice-50 text-graphite-400"
                                                    )}>
                                                        <CreditCard size={16} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[11px] font-black text-graphite-900">{t('sidebarBookingView.paymentOption.title')}</p>
                                                        <p className="text-[9px] text-graphite-400">{t('sidebarBookingView.paymentOption.subtitle')}</p>
                                                    </div>
                                                    <div className={cn(
                                                        "w-4 h-4 rounded-full border flex items-center justify-center transition-colors shrink-0",
                                                        includePayment ? "bg-brand-primary border-brand-primary" : "border-ice-300"
                                                    )}>
                                                        {includePayment && <Check size={10} className="text-white" strokeWidth={4} />}
                                                    </div>
                                                </button>

                                                <button
                                                    onClick={() => setIncludeMaps(!includeMaps)}
                                                    className={cn(
                                                        "flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left bg-white cursor-pointer w-full",
                                                        includeMaps ? "border-brand-primary/30 shadow-sm" : "border-ice-200 opacity-60"
                                                    )}
                                                >
                                                    <div className={cn(
                                                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                                        includeMaps ? "bg-brand-primary/10 text-brand-primary" : "bg-ice-50 text-graphite-400"
                                                    )}>
                                                        <MapPin size={16} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[11px] font-black text-graphite-900">{t('sidebarBookingView.mapsOption.title')}</p>
                                                        <p className="text-[9px] text-graphite-400">{t('sidebarBookingView.mapsOption.subtitle')}</p>
                                                    </div>
                                                    <div className={cn(
                                                        "w-4 h-4 rounded-full border flex items-center justify-center transition-colors shrink-0",
                                                        includeMaps ? "bg-brand-primary border-brand-primary" : "border-ice-300"
                                                    )}>
                                                        {includeMaps && <Check size={10} className="text-white" strokeWidth={4} />}
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Message Preview */}
                                    <div>
                                        <label className="text-[10px] font-black text-graphite-400 uppercase mb-1.5 block">Visualização da Mensagem</label>
                                        <textarea
                                            value={notificationPreviewText}
                                            onChange={(e) => setNotificationPreviewText(e.target.value)}
                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-xs font-medium text-graphite-900 focus:outline-none focus:border-brand-primary resize-none min-h-[140px]"
                                        />
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex gap-3 pt-2">
                                        <Button variant="ghost" className="flex-1 justify-center rounded-xl text-xs cursor-pointer" onClick={closeNotificationModal}>
                                            Pular
                                        </Button>
                                        <Button variant="primary" className="flex-[2] justify-center rounded-xl text-xs cursor-pointer" onClick={handleSendNotification}>
                                            <Send size={14} /> Enviar Mensagem
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* ========== EDIT MODAL ========== */}
            {editingAppt && (
                <>
                    <div className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]" onClick={() => setEditingAppt(null)} />
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                        <div className="bg-white pointer-events-auto w-full max-w-md rounded-4xl shadow-2xl overflow-hidden border border-white/20">
                            <div className="px-8 py-5 border-b border-ice-100 flex justify-between items-center bg-ice-50/50">
                                <div>
                                    <h3 className="text-lg font-black text-graphite-900">{editingAppt.patients?.full_name || t('mestra.patientFallback')}</h3>
                                    <p className="text-xs text-graphite-400 font-medium">
                                        {formatSlot(editingAppt.start_time)} – {formatSlot(editingAppt.end_time)} · {formatDateLabel(selectedDateStr)}
                                    </p>
                                    {patientNoShowStats && patientNoShowStats.noShows > 0 && (
                                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200/60 rounded-xl text-amber-800 text-[10px] font-bold mt-2 shadow-sm">
                                            <AlertTriangle size={12} className="shrink-0 text-amber-500 animate-pulse" />
                                            <span>
                                                {patientNoShowStats.noShows}º no-show deste paciente (Taxa: {patientNoShowStats.rate}%)
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <IconButton onClick={() => setEditingAppt(null)}><X size={20} /></IconButton>
                            </div>
                            <div className="p-6 space-y-5">
                                <div>
                                    <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">{t('mestra.editModal.statusLabel')}</label>
                                    <div className="grid grid-cols-2 gap-2 mb-3">
                                        {[
                                            { status: 'confirmed', label: t('mestra.editModal.statusConfirmed'), icon: CheckCircle2, ac: 'bg-brand-primary text-white border-brand-primary' },
                                            { status: 'checkin_done', label: t('mestra.editModal.statusCheckin'), icon: UserCheck, ac: 'bg-emerald-500 text-white border-emerald-500' },
                                            { status: 'canceled', label: t('mestra.editModal.statusCancel'), icon: XCircle, ac: 'bg-rose-500 text-white border-rose-500' },
                                            { status: 'noshow', label: t('mestra.editModal.statusNoshow'), icon: AlertTriangle, ac: 'bg-amber-500 text-white border-amber-500' },
                                        ].map(({ status, label, icon: Icon, ac }) => (
                                            <button key={status} onClick={() => handleUpdateStatus(editingAppt.id, status)}
                                                className={cn("flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold border cursor-pointer transition-all",
                                                    editingAppt.status === status ? ac : "bg-white text-graphite-600 border-ice-200 hover:border-ice-300")}>
                                                <Icon size={14} /> {label}
                                            </button>
                                        ))}
                                    </div>
                                    
                                    <Button variant="ghost" className="w-full py-2.5 justify-center border border-ice-200 hover:border-ice-300 text-brand-primary font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer" onClick={handleRescheduleClick}>
                                        <Clock size={14} className="shrink-0 text-brand-primary" /> {t('mestra.editModal.reschedule')}
                                    </Button>
                                </div>

                                {editingAppt.slot_type && (
                                    <div className="flex items-center gap-2 p-3 rounded-xl bg-ice-50 border border-ice-100">
                                        <span className="text-xs font-bold text-graphite-400">{t('mestra.editModal.slotColonLabel')}</span>
                                        <Badge size="sm" accent={editingAppt.slot_type === 'prime' ? 'warning' : editingAppt.slot_type === 'auto_released' ? 'warning' : 'neutral'}>
                                            {editingAppt.slot_type === 'prime' ? t('mestra.slotBadge.prime') : editingAppt.slot_type === 'auto_released' ? t('mestra.slotBadge.released') : t('mestra.slotBadge.regular')}
                                        </Badge>
                                        {editingAppt.patient_type === 'insurance' && <Badge size="sm" accent="success">{t('mestra.bookingModal.insurance')}</Badge>}
                                    </div>
                                )}

                                <div>
                                    <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">{t('mestra.editModal.notesLabel')}</label>
                                    <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder={t('mestra.editModal.notesPlaceholder')}
                                        className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors resize-none min-h-[80px]" />
                                </div>

                                <div className="flex gap-3">
                                    <Button variant="ghost" className="flex-1 justify-center" onClick={() => setEditingAppt(null)}>{t('mestra.editModal.close')}</Button>
                                    <Button variant="primary" className="flex-[2] justify-center" onClick={handleSaveNotes}>
                                        <Save size={16} /> {t('mestra.editModal.save')}
                                    </Button>
                                </div>

                                <Button variant="success" className="w-full py-4 justify-center font-black" onClick={() => setIsCheckoutModalOpen(true)}>
                                    <Wallet size={18} /> {t('mestra.editModal.receivePayment')}
                                </Button>

                                <Button variant="dangerGhost" size="sm" className="w-full justify-center" onClick={() => setConfirmDelete(editingAppt.id)}>
                                    {t('mestra.editModal.deleteAppointment')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* ========== CONFIRM DELETE ========== */}
            <AnimatePresence>
                {confirmDelete && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/40 flex items-center justify-center z-[120] p-4" onClick={() => setConfirmDelete(null)}>
                        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                            className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
                            <div className="text-center">
                                <div className="w-12 h-12 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4"><AlertTriangle size={24} /></div>
                                <h3 className="text-lg font-bold text-graphite-900 mb-2">{t('mestra.confirmDelete.title')}</h3>
                                <p className="text-sm text-graphite-500 mb-6">{t('mestra.confirmDelete.text')}</p>
                                <div className="flex gap-3">
                                    <Button variant="ghost" className="flex-1 justify-center" onClick={() => setConfirmDelete(null)}>{t('mestra.confirmDelete.cancel')}</Button>
                                    <Button variant="danger" className="flex-1 justify-center" onClick={() => handleDelete(confirmDelete)}>{t('mestra.confirmDelete.confirm')}</Button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <WaitlistDrawer
                open={waitlistOpen}
                onClose={() => setWaitlistOpen(false)}
                tenantId={selectedTenant}
                onCountChange={setWaitlistCount}
            />

            {editingAppt && (
                <CheckoutModal
                    isOpen={isCheckoutModalOpen}
                    onClose={() => setIsCheckoutModalOpen(false)}
                    patientId={editingAppt.patient_id}
                    patientName={editingAppt.patients?.full_name || t('mestra.patientFallback')}
                    initialAmount={editingAppt.appointment_types?.price_cents ? (editingAppt.appointment_types.price_cents / 100) : 0}
                    tenantId={selectedTenant || ''}
                />
            )}
            {/* ========== GLOBAL SELECTION PREVIEW (ABOVE BACKDROP) ========== */}
            {bookingModal.open && gridRef.current && (
                <div className="fixed inset-0 pointer-events-none z-[105] overflow-hidden">
                    {(() => {
                        const rect = gridRef.current.getBoundingClientRect();
                        const colIndex = visibleDoctors.findIndex(d => d.id === bookingModal.doctorId);
                        if (colIndex === -1) return null;
                        
                        const colW = rect.width / visibleDoctors.length;
                        const sMin = timeToMin(bookingModal.slot?.slot_time || bookingModal.prefillStart || '08:00');
                        const selType = appointmentTypes.find(t => t.id === bookingForm.typeId);
                        const dur = selType?.duration_minutes || DEFAULT_DURATION;
                        const eMin = sMin + dur;
                        const eTimeStr = minToTime(eMin);
                        
                        const top = rect.top + minToY(sMin) - scrollTop;
                        const height = minToY(eMin) - minToY(sMin);
                        const left = rect.left + colIndex * colW;

                        if (top + height < rect.top || top > rect.bottom) return null;

                        return (
                            <div 
                                className="absolute rounded-xl bg-brand-primary border-2 border-brand-primary shadow-2xl flex flex-col items-center justify-center pointer-events-auto"
                                style={{
                                    top: Math.max(rect.top, top),
                                    height: Math.min(rect.bottom, top + height) - Math.max(rect.top, top),
                                    left: left + 6,
                                    width: colW - 12,
                                    opacity: (top < rect.top - 10 || top + height > rect.bottom + 10) ? 0 : 1,
                                    transition: 'opacity 0.2s',
                                    visibility: (top + height < rect.top || top > rect.bottom) ? 'hidden' : 'visible'
                                }}
                            >
                                <div className="absolute top-2 right-2">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setBookingModal({ open: false, doctorId: '', slot: null });
                                        }}
                                        className="w-8 h-8 rounded-full bg-white shadow-xl flex items-center justify-center text-brand-primary hover:scale-110 active:scale-95 transition-all border-none cursor-pointer"
                                    >
                                        <X size={18} strokeWidth={3} />
                                    </button>
                                </div>
                                <span className="text-[11px] font-black text-white px-2 py-1 bg-white/10 rounded-lg">
                                    {`${formatSlot(minToTime(sMin))} – ${formatSlot(eTimeStr)}`}
                                </span>
                                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-10 h-1.5 rounded-full bg-white/30" />
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
};
