import React, { useState, useEffect, useMemo } from 'react';
import { 
  ChevronLeft, 
  Loader2, 
  User, 
  Calendar, 
  MapPin, 
  Stethoscope, 
  ChevronRight, 
  Search, 
  X 
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { smartSchedulingService } from '../services/smartSchedulingService';
import type { SmartSlot } from '../services/smartSchedulingService';
import { clsx } from 'clsx';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useTranslation } from 'react-i18next';
import { SidebarCalendar } from './shared/SidebarCalendar';
import { format, startOfMonth } from 'date-fns';
import { getTenantNow, getTenantTodayString } from '../lib/timezoneUtils';

interface SidebarAvailabilityViewProps {
  onBack: () => void;
  onBookSlot?: (doctor: any, location: any, procedure: any, date: string, time: string) => void;
}

export function SidebarAvailabilityView({ onBack, onBookSlot }: SidebarAvailabilityViewProps) {
  const { tenant } = useTenant();
  const { formatSlot } = useLocaleFormat();
  const { t } = useTranslation('agenda');

  // Navigation: 'menu' | 'select_doctor' | 'select_location' | 'select_procedure' | 'calendar'
  const [view, setView] = useState<'menu' | 'select_doctor' | 'select_location' | 'select_procedure' | 'calendar'>('menu');

  // Selections
  const [selectedDoctor, setSelectedDoctor] = useState<any | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<any | null>(null);
  const [selectedProcedure, setSelectedProcedure] = useState<any | null>(null);

  // Manual selection tracking
  const [manuallySelected, setManuallySelected] = useState<{
    doctor: boolean;
    location: boolean;
    procedure: boolean;
  }>({ doctor: false, location: false, procedure: false });

  // Lists (Base Data)
  const [doctors, setDoctors] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [procedures, setProcedures] = useState<any[]>([]);
  const [doctorLocations, setDoctorLocations] = useState<any[]>([]);
  const [doctorServices, setDoctorServices] = useState<any[]>([]);

  // Loading states
  const [loadingBaseData, setLoadingBaseData] = useState(false);
  const loadingDoctors = loadingBaseData;
  const loadingLocations = loadingBaseData;
  const loadingProcedures = loadingBaseData;
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Calendar
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [currentMonth, setCurrentMonth] = useState(() => getTenantNow(tenant?.timezone));
  const [slots, setSlots] = useState<SmartSlot[]>([]);

  // Helper setters for selections
  const selectDoctor = (doc: any, isManual: boolean = true) => {
    setSelectedDoctor(doc);
    setManuallySelected(prev => ({ ...prev, doctor: isManual }));
  };

  const selectLocation = (loc: any, isManual: boolean = true) => {
    setSelectedLocation(loc);
    setManuallySelected(prev => ({ ...prev, location: isManual }));
  };

  const selectProcedure = (proc: any, isManual: boolean = true) => {
    setSelectedProcedure(proc);
    setManuallySelected(prev => ({ ...prev, procedure: isManual }));
  };

  const clearDoctor = () => {
    setSelectedDoctor(null);
    setManuallySelected(prev => ({ ...prev, doctor: false }));
  };

  const clearLocation = () => {
    setSelectedLocation(null);
    setManuallySelected(prev => ({ ...prev, location: false }));
  };

  const clearProcedure = () => {
    setSelectedProcedure(null);
    setManuallySelected(prev => ({ ...prev, procedure: false }));
  };

  // Load all base data (consolidated fetch)
  const loadBaseData = async () => {
    if (!tenant?.id) return;
    setLoadingBaseData(true);
    try {
      // 1. Fetch active doctors
      const docs = await smartSchedulingService.getActiveDoctors(tenant.id);
      setDoctors(docs);

      // 2. Fetch active locations
      const { data: locs } = await supabase
        .from('locations')
        .select('id, name, google_maps_url')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('name');
      setLocations(locs || []);

      // 3. Fetch active procedures (appointment types)
      const { data: procs } = await supabase
        .from('appointment_types')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('name');
      setProcedures(procs || []);

      const docIds = docs.map((d: any) => d.id);
      if (docIds.length > 0) {
        // 4. Fetch doctor locations mapping
        const { data: docLocs } = await supabase
          .from('doctor_locations')
          .select('doctor_id, location_id')
          .in('doctor_id', docIds);
        setDoctorLocations(docLocs || []);

        // 5. Fetch doctor services mapping
        const { data: docServs } = await supabase
          .from('doctor_services')
          .select('doctor_id, service_id, location_id')
          .eq('tenant_id', tenant.id);
        setDoctorServices(docServs || []);
      } else {
        setDoctorLocations([]);
        setDoctorServices([]);
      }
    } catch (err) {
      console.error('Error loading base data:', err);
    } finally {
      setLoadingBaseData(false);
    }
  };

  // Trigger base data load
  useEffect(() => {
    if (tenant?.id) {
      loadBaseData();
    }
  }, [tenant?.id]);

  // Helper function: allowed locations for doctor
  const getDoctorAllowedLocations = (docId: string) => {
    const directLocIds = doctorLocations
      .filter(dl => dl.doctor_id === docId)
      .map(dl => dl.location_id);
    if (directLocIds.length > 0) return directLocIds;

    const serviceLocIds = doctorServices
      .filter(ds => ds.doctor_id === docId && ds.location_id !== null)
      .map(ds => ds.location_id as string);
    if (serviceLocIds.length > 0) {
      return Array.from(new Set(serviceLocIds));
    }

    return locations.map(l => l.id);
  };

  // Helper function: allowed procedures for doctor
  const getDoctorAllowedProcedures = (docId: string) => {
    return procedures.filter(proc => {
      const hasAnyMappings = doctorServices.some(ds => ds.service_id === proc.id);
      if (!hasAnyMappings) return true; // Clinic-general service

      return doctorServices.some(ds => ds.doctor_id === docId && ds.service_id === proc.id);
    }).map(proc => proc.id);
  };

  // Dynamic filtered lists via useMemo
  const availableDoctors = useMemo(() => {
    return doctors.filter(doc => {
      if (selectedLocation) {
        const allowedLocs = getDoctorAllowedLocations(doc.id);
        if (!allowedLocs.includes(selectedLocation.id)) return false;
      }
      if (selectedProcedure) {
        const allowedProcs = getDoctorAllowedProcedures(doc.id);
        if (!allowedProcs.includes(selectedProcedure.id)) return false;
      }
      return true;
    });
  }, [doctors, selectedLocation, selectedProcedure, doctorLocations, doctorServices]);

  const availableLocations = useMemo(() => {
    return locations.filter(loc => {
      if (selectedDoctor) {
        const allowedLocs = getDoctorAllowedLocations(selectedDoctor.id);
        if (!allowedLocs.includes(loc.id)) return false;
      }
      if (selectedProcedure) {
        const hasAnyMappings = doctorServices.some(ds => ds.service_id === selectedProcedure.id);
        if (hasAnyMappings) {
          const offersAtLoc = doctorServices.some(
            ds => ds.service_id === selectedProcedure.id && (ds.location_id === null || ds.location_id === loc.id)
          );
          if (!offersAtLoc) return false;
        }
      }
      if (selectedDoctor && selectedProcedure) {
        const hasAnyMappings = doctorServices.some(ds => ds.service_id === selectedProcedure.id);
        if (hasAnyMappings) {
          const docOffersAtLoc = doctorServices.some(
            ds => ds.doctor_id === selectedDoctor.id && 
                  ds.service_id === selectedProcedure.id && 
                  (ds.location_id === null || ds.location_id === loc.id)
          );
          if (!docOffersAtLoc) return false;
        }
      }
      return true;
    });
  }, [locations, selectedDoctor, selectedProcedure, doctorLocations, doctorServices]);

  const availableProcedures = useMemo(() => {
    return procedures.filter(proc => {
      if (selectedDoctor) {
        const allowedProcs = getDoctorAllowedProcedures(selectedDoctor.id);
        if (!allowedProcs.includes(proc.id)) return false;
      }
      if (selectedLocation) {
        const hasAnyMappings = doctorServices.some(ds => ds.service_id === proc.id);
        if (hasAnyMappings) {
          const offersAtLoc = doctorServices.some(
            ds => ds.service_id === proc.id && (ds.location_id === null || ds.location_id === selectedLocation.id)
          );
          if (!offersAtLoc) return false;
        }
      }
      if (selectedDoctor && selectedLocation) {
        const hasAnyMappings = doctorServices.some(ds => ds.service_id === proc.id);
        if (hasAnyMappings) {
          const docOffersAtLoc = doctorServices.some(
            ds => ds.doctor_id === selectedDoctor.id && 
                  ds.service_id === proc.id && 
                  (ds.location_id === null || ds.location_id === selectedLocation.id)
          );
          if (!docOffersAtLoc) return false;
        }
      }
      return true;
    });
  }, [procedures, selectedDoctor, selectedLocation, doctorServices]);

  // Auto-selection effects
  useEffect(() => {
    if (!selectedDoctor && availableDoctors.length === 1) {
      const shouldAutoSelect = 
        doctors.length === 1 || 
        manuallySelected.location || 
        manuallySelected.procedure;
      
      if (shouldAutoSelect) {
        selectDoctor(availableDoctors[0], false);
      }
    }
  }, [availableDoctors, selectedDoctor, doctors.length, manuallySelected.location, manuallySelected.procedure]);

  useEffect(() => {
    if (!selectedLocation && availableLocations.length === 1) {
      const shouldAutoSelect = 
        locations.length === 1 || 
        manuallySelected.doctor || 
        manuallySelected.procedure;
      
      if (shouldAutoSelect) {
        selectLocation(availableLocations[0], false);
      }
    }
  }, [availableLocations, selectedLocation, locations.length, manuallySelected.doctor, manuallySelected.procedure]);

  useEffect(() => {
    if (!selectedProcedure && availableProcedures.length === 1) {
      const shouldAutoSelect = 
        procedures.length === 1 || 
        manuallySelected.doctor || 
        manuallySelected.location;
      
      if (shouldAutoSelect) {
        selectProcedure(availableProcedures[0], false);
      }
    }
  }, [availableProcedures, selectedProcedure, procedures.length, manuallySelected.doctor, manuallySelected.location]);

  // Mismatch clearing effect
  useEffect(() => {
    if (selectedDoctor && !availableDoctors.some(d => d.id === selectedDoctor.id)) {
      clearDoctor();
    }
    if (selectedLocation && !availableLocations.some(l => l.id === selectedLocation.id)) {
      clearLocation();
    }
    if (selectedProcedure && !availableProcedures.some(p => p.id === selectedProcedure.id)) {
      clearProcedure();
    }
  }, [availableDoctors, availableLocations, availableProcedures, selectedDoctor, selectedLocation, selectedProcedure]);

  // Reset search query when view changes
  useEffect(() => {
    setSearchQuery('');
  }, [view]);

  // Load calendar markers
  const loadAvailableDatesMarkers = async () => {
    if (!selectedDoctor || !selectedLocation || !selectedProcedure) return;
    try {
      const { data, error } = await supabase.rpc('find_next_available_dates', {
        p_doctor_id: selectedDoctor.id,
        p_location_id: selectedLocation.id,
        p_duration_minutes: selectedProcedure.duration_minutes || 30,
        p_limit: 60,
        p_from_date: format(startOfMonth(currentMonth), 'yyyy-MM-dd')
      });
      if (error) throw error;
      const tz = tenant?.timezone || 'America/Sao_Paulo';
      const todayStr = getTenantTodayString(tz);
      const dates = (data || [])
        .map((d: any) => d.date)
        .filter((d: string) => d >= todayStr);
      setAvailableDates(dates);
    } catch (err) {
      console.error('Error loading calendar markers:', err);
    }
  };

  useEffect(() => {
    if (view === 'calendar') {
      loadAvailableDatesMarkers();
    }
  }, [view, selectedDoctor, selectedLocation, selectedProcedure, currentMonth]);

  // Load slots for date
  const loadSlotsForDate = async (date: string) => {
    if (!selectedDoctor || !selectedLocation || !selectedProcedure || !tenant?.id) return;
    setLoadingSlots(true);
    setSelectedDate(date);
    try {
      const data = await smartSchedulingService.getAvailableSlots(
        selectedDoctor.id,
        date,
        tenant.id,
        selectedProcedure.duration_minutes || 30,
        selectedLocation.id,
        tenant.timezone
      );
      setSlots(data);
    } catch (err) {
      console.error('Error loading slots:', err);
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleDateSelect = (date: string) => {
    loadSlotsForDate(date);
  };

  const handleBack = () => {
    if (view === 'menu') {
      onBack();
    } else {
      setView('menu');
    }
  };

  const slotColor = (slot: SmartSlot) => {
    if (slot.is_auto_released) return 'border-amber-300 bg-amber-50 text-amber-700';
    if (slot.block_type === 'prime') return 'border-yellow-300 bg-yellow-50 text-yellow-700';
    return 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50';
  };

  const renderMainMenu = () => {
    const isReady = selectedDoctor && selectedLocation && selectedProcedure;

    return (
      <div className="space-y-4 flex flex-col h-full justify-between">
        <div className="space-y-4">
          <p className="text-xs text-gray-500 font-medium">
            Configure as opções abaixo para visualizar as datas e horários de atendimento disponíveis.
          </p>

          {/* Doctor Card */}
          <button
            onClick={() => setView('select_doctor')}
            className={clsx(
              "w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between gap-3",
              selectedDoctor 
                ? "bg-emerald-50/30 border-emerald-200 hover:border-emerald-300"
                : "bg-gray-50/50 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/10"
            )}
          >
            <div className="flex items-center gap-3">
              <div className={clsx(
                "p-2.5 rounded-xl",
                selectedDoctor ? "bg-emerald-100 text-emerald-600" : "bg-gray-100 text-gray-400"
              )}>
                <User className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Profissional</p>
                <p className={clsx("text-sm font-bold mt-0.5 truncate", selectedDoctor ? "text-gray-800" : "text-gray-500")}>
                  {selectedDoctor ? selectedDoctor.full_name : "Selecionar Profissional..."}
                </p>
                {selectedDoctor?.specialty && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{selectedDoctor.specialty}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {selectedDoctor && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearDoctor();
                  }}
                  className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <ChevronRight className={clsx("w-5 h-5 text-gray-400", selectedDoctor && "text-emerald-500")} />
            </div>
          </button>

          {/* Procedure Card */}
          <button
            onClick={() => setView('select_procedure')}
            className={clsx(
              "w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between gap-3",
              selectedProcedure 
                ? "bg-emerald-50/30 border-emerald-200 hover:border-emerald-300"
                : "bg-gray-50/50 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/10"
            )}
          >
            <div className="flex items-center gap-3">
              <div className={clsx(
                "p-2.5 rounded-xl",
                selectedProcedure ? "bg-emerald-100 text-emerald-600" : "bg-gray-100 text-gray-400"
              )}>
                <Stethoscope className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Procedimento</p>
                <p className={clsx("text-sm font-bold mt-0.5 truncate", selectedProcedure ? "text-gray-800" : "text-gray-500")}>
                  {selectedProcedure ? selectedProcedure.name : "Selecionar Procedimento..."}
                </p>
                {selectedProcedure?.duration_minutes && (
                  <p className="text-xs text-gray-500 mt-0.5">{selectedProcedure.duration_minutes} min</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {selectedProcedure && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearProcedure();
                  }}
                  className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <ChevronRight className={clsx("w-5 h-5 text-gray-400", selectedProcedure && "text-emerald-500")} />
            </div>
          </button>

          {/* Location Card */}
          <button
            onClick={() => setView('select_location')}
            className={clsx(
              "w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between gap-3",
              selectedLocation 
                ? "bg-emerald-50/30 border-emerald-200 hover:border-emerald-300"
                : "bg-gray-50/50 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/10"
            )}
          >
            <div className="flex items-center gap-3">
              <div className={clsx(
                "p-2.5 rounded-xl",
                selectedLocation ? "bg-emerald-100 text-emerald-600" : "bg-gray-100 text-gray-400"
              )}>
                <MapPin className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Unidade</p>
                <p className={clsx("text-sm font-bold mt-0.5 truncate", selectedLocation ? "text-gray-800" : "text-gray-500")}>
                  {selectedLocation ? selectedLocation.name : "Selecionar Unidade..."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {selectedLocation && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearLocation();
                  }}
                  className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <ChevronRight className={clsx("w-5 h-5 text-gray-400", selectedLocation && "text-emerald-500")} />
            </div>
          </button>
        </div>

        <div className="pt-6 mt-auto">
          <button
            disabled={!isReady}
            onClick={() => {
              setView('calendar');
              setSelectedDate('');
              setSlots([]);
            }}
            className={clsx(
              "w-full py-3.5 px-4 rounded-xl font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2",
              isReady
                ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100 cursor-pointer"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            )}
          >
            <Calendar className="w-4 h-4" />
            Continuar para Calendário
          </button>
        </div>
      </div>
    );
  };

  const renderSelectDoctor = () => {
    const filteredDoctors = availableDoctors.filter(doc => 
      doc.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.specialty?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Pesquisar profissional..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {loadingDoctors ? (
          <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-indigo-600 w-6 h-6" /></div>
        ) : filteredDoctors.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">Nenhum profissional encontrado.</p>
        ) : (
          <div className="space-y-2">
            {filteredDoctors.map(doc => (
              <button
                key={doc.id}
                onClick={() => {
                  selectDoctor(doc);
                  setView('menu');
                }}
                className={clsx(
                  "w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3",
                  selectedDoctor?.id === doc.id
                    ? "border-indigo-600 bg-indigo-50/30"
                    : "border-gray-100 bg-white hover:border-indigo-200 hover:bg-indigo-50/10"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800">{doc.full_name}</p>
                    {doc.specialty && <p className="text-xs text-gray-500 mt-0.5">{doc.specialty}</p>}
                  </div>
                </div>
                {selectedDoctor?.id === doc.id && (
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderSelectLocation = () => {
    const filteredLocations = availableLocations.filter(loc => 
      loc.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Pesquisar unidade..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {loadingLocations ? (
          <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-indigo-600 w-6 h-6" /></div>
        ) : filteredLocations.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">Nenhuma unidade encontrada.</p>
        ) : (
          <div className="space-y-2">
            {filteredLocations.map(loc => (
              <button
                key={loc.id}
                onClick={() => {
                  selectLocation(loc);
                  setView('menu');
                }}
                className={clsx(
                  "w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3",
                  selectedLocation?.id === loc.id
                    ? "border-indigo-600 bg-indigo-50/30"
                    : "border-gray-100 bg-white hover:border-indigo-200 hover:bg-indigo-50/10"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800">{loc.name}</p>
                  </div>
                </div>
                {selectedLocation?.id === loc.id && (
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderSelectProcedure = () => {
    const filteredProcedures = availableProcedures.filter(proc => 
      proc.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Pesquisar procedimento..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {loadingProcedures ? (
          <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-indigo-600 w-6 h-6" /></div>
        ) : filteredProcedures.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">Nenhum procedimento encontrado.</p>
        ) : (
          <div className="space-y-2">
            {filteredProcedures.map(proc => (
              <button
                key={proc.id}
                onClick={() => {
                  selectProcedure(proc);
                  setView('menu');
                }}
                className={clsx(
                  "w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3",
                  selectedProcedure?.id === proc.id
                    ? "border-indigo-600 bg-indigo-50/30"
                    : "border-gray-100 bg-white hover:border-indigo-200 hover:bg-indigo-50/10"
                )}
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                    <Stethoscope className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800">{proc.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                      {proc.duration_minutes && <span>{proc.duration_minutes} min</span>}
                      {proc.price_cents && (
                        <>
                          <span>•</span>
                          <span>R$ {(proc.price_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {selectedProcedure?.id === proc.id && (
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderCalendarView = () => {
    return (
      <div className="space-y-4">
        {/* Summary card */}
        <div className="p-3 bg-indigo-50 rounded-2xl border border-indigo-100 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Resumo</span>
            <button 
              onClick={() => setView('menu')}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
            >
              Alterar
            </button>
          </div>
          <p className="text-xs font-bold text-gray-800">
            {selectedDoctor?.full_name}
          </p>
          <div className="flex flex-wrap gap-x-2 text-[10px] text-gray-500">
            <span>{selectedProcedure?.name} ({selectedProcedure?.duration_minutes}m)</span>
            <span>•</span>
            <span>{selectedLocation?.name}</span>
          </div>
        </div>

        {/* Sidebar Calendar */}
        <SidebarCalendar
          selectedDate={selectedDate}
          onDateSelect={handleDateSelect}
          availableDates={availableDates}
          currentMonth={currentMonth}
          onMonthChange={setCurrentMonth}
          timezone={tenant?.timezone}
        />

        {/* Slots list */}
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">
            {selectedDate 
              ? `Horários Disponíveis (${slots.length})` 
              : 'Selecione uma data no calendário'}
          </label>
          {selectedDate && (
            loadingSlots ? (
              <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>
            ) : slots.length === 0 ? (
              <div className="py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                <Calendar className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">Nenhum horário disponível para esta data.</p>
              </div>
            ) : (
              <>
                {/* Legend */}
                <div className="flex items-center gap-3 text-[9px] text-gray-400 mb-1 px-1">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-gray-300" /> 
                    Regular
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" /> 
                    Prime
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> 
                    Exclusivo
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((slot, i) => (
                    <button
                      key={i}
                      onClick={() => onBookSlot?.(selectedDoctor, selectedLocation, selectedProcedure, selectedDate, slot.slot_time)}
                      className={clsx('py-2 text-xs font-bold rounded-xl border transition-all', slotColor(slot))}
                      title={`${slot.block_type}${slot.location_name ? ` · ${slot.location_name}` : ''}${slot.allowed_patient_type !== 'any' ? ` · ${slot.allowed_patient_type}` : ''}`}
                    >
                      {formatSlot(slot.slot_time.substring(0, 5))}
                    </button>
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-indigo-600">
        <button onClick={handleBack} className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-white">
          <p className="text-xs font-bold opacity-80 uppercase tracking-tighter">
            {view === 'menu' ? t('sidebarAvailability.headerLabel', 'Consultar') : 'Voltar ao Menu'}
          </p>
          <p className="text-sm font-bold">
            {view === 'menu' && t('sidebarAvailability.headerTitle', 'Disponibilidade')}
            {view === 'select_doctor' && 'Escolher Profissional'}
            {view === 'select_location' && 'Escolher Unidade'}
            {view === 'select_procedure' && 'Escolher Procedimento'}
            {view === 'calendar' && 'Calendário de Disponibilidade'}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {view === 'menu' && renderMainMenu()}
        {view === 'select_doctor' && renderSelectDoctor()}
        {view === 'select_location' && renderSelectLocation()}
        {view === 'select_procedure' && renderSelectProcedure()}
        {view === 'calendar' && renderCalendarView()}
      </div>
    </div>
  );
}
