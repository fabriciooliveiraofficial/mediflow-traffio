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
    Wallet
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useToast } from '../contexts/ToastContext';
import { useTenant } from '../contexts/TenantContext';
import { smartSchedulingService } from '../services/smartSchedulingService';
import { locationService } from '../services/locationService';
import { CheckoutModal } from '../components/CheckoutModal';
import type { SmartSlot, BookAppointmentPayload } from '../services/smartSchedulingService';
import { formatSlot as formatSlotI18n } from '../lib/i18n/formatDateTime';
import { getCountry, DEFAULT_COUNTRY } from '../lib/i18n/countryFormats';
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
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
            const [docs, types, locs] = await Promise.all([
                smartSchedulingService.getActiveDoctors(selectedTenant),
                smartSchedulingService.getAppointmentTypes(selectedTenant),
                locationService.getAll(selectedTenant),
            ]);
            setDoctors(docs as Doctor[]);
            setAppointmentTypes(types as AppointmentType[]);
            setSelectedDoctors(docs.map((d: any) => d.id));
            setLocations(locs);
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
        try {
            const [slotsResults, appts] = await Promise.all([
                Promise.all(selectedDoctors.map(async (docId) => {
                    try {
                        return { docId, slots: await smartSchedulingService.getAvailableSlots(docId, dateStr, selectedTenant, defaultDur, selectedLocation || undefined) };
                    } catch { return { docId, slots: [] }; }
                })),
                smartSchedulingService.getAppointmentsForDate(selectedTenant, dateStr, selectedDoctors),
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
        } catch (err) { console.error(err); }
        setLoading(false);
    }, [selectedTenant, selectedDoctors, dateStr, appointmentTypes, selectedLocation]);

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

    const toggleDoctor = (id: string) => {
        setSelectedDoctors(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
    };

    // ── Booking ─────────────────────────────
    const openBookingModal = (doctorId: string, slot: SmartSlot) => {
        setBookingForm({ patientSearch: '', selectedPatient: null, patientType: 'private', insurancePlanId: '', typeId: appointmentTypes[0]?.id || '', notes: '' });
        setPatientResults([]);
        setDoctorPlans([]);
        setBookingModal({ open: true, doctorId, slot });
        smartSchedulingService.getDoctorInsurancePlans(doctorId).then(setDoctorPlans);
    };

    const openBookingFromDrag = (doctorId: string, startMin: number, endMin: number) => {
        setBookingForm({ patientSearch: '', selectedPatient: null, patientType: 'private', insurancePlanId: '', typeId: appointmentTypes[0]?.id || '', notes: '' });
        setPatientResults([]);
        setDoctorPlans([]);
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

    const handleBook = async () => {
        if (!bookingForm.selectedPatient || !selectedTenant) return;
        setBookingSaving(true);

        try {
            const startTime = bookingModal.slot?.slot_time || bookingModal.prefillStart || '08:00';
            const endTime = bookingModal.slot?.slot_end || bookingModal.prefillEnd || '08:30';
            const slot = bookingModal.slot;
            const slotType = slot ? (slot.is_auto_released ? 'auto_released' : slot.block_type) : 'regular';

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
                location_id: slot?.location_id || '',
            };

            await smartSchedulingService.bookAppointment(payload);
            showToast('success', t('mestra.toasts.bookedFor', { name: bookingForm.selectedPatient.full_name }));
            setBookingModal({ open: false, doctorId: '', slot: null });
            fetchData();
        } catch (err: any) {
            showToast('error', t('mestra.toasts.bookError', { message: err.message }));
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

    const handleDelete = async (id: string) => {
        try {
            await supabase.from('appointments').delete().eq('id', id);
            setConfirmDelete(null);
            setEditingAppt(null);
            fetchData();
            showToast('success', t('mestra.toasts.appointmentRemoved'));
        } catch (err: any) { showToast('error', t('mestra.toasts.genericError', { message: err.message })); }
    };

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
                    drag.currentStart = newEnd > DAY_END * 60 ? DAY_END * 60 - duration : newStart;
                    drag.currentEnd = drag.currentStart + duration;
                    drag.currentDocId = coords.docId;
                    setGhost({
                        colIndex: coords.colIdx,
                        top: minToY(drag.currentStart),
                        height: minToY(drag.currentEnd) - minToY(drag.currentStart),
                        label: `${minToTime(drag.currentStart)} – ${minToTime(drag.currentEnd)}`,
                    });
                } else if (drag.type === 'resize-bottom') {
                    const newEnd = clampMin(Math.max(drag.currentStart + SNAP_MIN, snap(rawMin)));
                    drag.currentEnd = newEnd;
                    setGhost({
                        colIndex: visibleDoctors.findIndex(d => d.id === drag.docId),
                        top: minToY(drag.currentStart),
                        height: minToY(newEnd) - minToY(drag.currentStart),
                        label: `${minToTime(drag.currentStart)} – ${minToTime(newEnd)}`,
                    });
                } else if (drag.type === 'resize-top') {
                    const newStart = clampMin(Math.min(drag.currentEnd - SNAP_MIN, snap(rawMin)));
                    drag.currentStart = newStart;
                    setGhost({
                        colIndex: visibleDoctors.findIndex(d => d.id === drag.docId),
                        top: minToY(newStart),
                        height: minToY(drag.currentEnd) - minToY(newStart),
                        label: `${minToTime(newStart)} – ${minToTime(drag.currentEnd)}`,
                    });
                } else if (drag.type === 'create') {
                    const a = drag.origStart;
                    const b = snap(rawMin);
                    const s = clampMin(Math.min(a, b));
                    const ed = clampMin(Math.max(a, b));
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
    }, [getGridCoords, visibleDoctors, fetchData, appointmentsByDoctor]);

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
                                                // Only trigger create if clicking on empty space
                                                if ((e.target as HTMLElement).closest('[data-appt]') || (e.target as HTMLElement).closest('[data-slot]')) return;
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
                                            <span className="text-xs text-graphite-500 font-medium flex items-center gap-1">
                                                <Clock size={12} />
                                                {bookingModal.slot
                                                    ? `${formatSlot(bookingModal.slot.slot_time)} – ${formatSlot(bookingModal.slot.slot_end)}`
                                                    : bookingModal.prefillStart
                                                        ? `${formatSlot(bookingModal.prefillStart)} – ${formatSlot(bookingModal.prefillEnd)}`
                                                        : ''}
                                            </span>
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
                                        ) : (
                                            <div className="relative">
                                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
                                                <input type="text" value={bookingForm.patientSearch} onChange={(e) => handlePatientSearch(e.target.value)}
                                                    placeholder={t('mestra.bookingModal.patientSearchPlaceholder')} autoFocus
                                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-10 pr-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors" />
                                                {patientResults.length > 0 && (
                                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-ice-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
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
                                        <select value={bookingForm.typeId} onChange={(e) => setBookingForm(prev => ({ ...prev, typeId: e.target.value }))}
                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium cursor-pointer focus:outline-none focus:border-brand-primary transition-colors">
                                            <option value="">{t('mestra.bookingModal.selectTypePlaceholder')}</option>
                                            {appointmentTypes.map(t => <option key={t.id} value={t.id}>{t.name} ({t.duration_minutes}min)</option>)}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">{t('mestra.bookingModal.notesLabel')}</label>
                                        <textarea value={bookingForm.notes || ''} onChange={(e) => setBookingForm(prev => ({ ...prev, notes: e.target.value }))}
                                            placeholder={t('mestra.bookingModal.notesPlaceholder')}
                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors resize-none min-h-[60px]" />
                                    </div>

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
                                </div>
                                <IconButton onClick={() => setEditingAppt(null)}><X size={20} /></IconButton>
                            </div>
                            <div className="p-6 space-y-5">
                                <div>
                                    <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">{t('mestra.editModal.statusLabel')}</label>
                                    <div className="grid grid-cols-2 gap-2">
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
                        const eMin = timeToMin(bookingModal.slot?.slot_end || bookingModal.prefillEnd || '08:30');
                        
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
                                    {bookingModal.slot 
                                        ? `${formatSlot(bookingModal.slot.slot_time)} – ${formatSlot(bookingModal.slot.slot_end)}`
                                        : `${formatSlot(bookingModal.prefillStart)} – ${formatSlot(bookingModal.prefillEnd)}`}
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
