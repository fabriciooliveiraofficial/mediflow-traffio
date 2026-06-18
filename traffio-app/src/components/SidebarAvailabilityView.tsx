import React, { useState, useEffect } from 'react';
import { ChevronLeft, Loader2, User, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { smartSchedulingService } from '../services/smartSchedulingService';
import type { SmartSlot } from '../services/smartSchedulingService';
import { clsx } from 'clsx';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useTranslation } from 'react-i18next';

interface SidebarAvailabilityViewProps {
  onBack: () => void;
  onBookSlot?: (doctorId: string, date: string, time: string) => void;
}

export function SidebarAvailabilityView({ onBack, onBookSlot }: SidebarAvailabilityViewProps) {
  const { tenant } = useTenant();
  const { formatSlot } = useLocaleFormat();
  const { t } = useTranslation('agenda');
  const [doctors, setDoctors] = useState<any[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [slots, setSlots] = useState<SmartSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDoctors, setLoadingDoctors] = useState(true);

  useEffect(() => {
    if (tenant?.id) loadDoctors();
  }, [tenant?.id]);

  const loadDoctors = async () => {
    setLoadingDoctors(true);
    try {
      const data = await smartSchedulingService.getActiveDoctors(tenant!.id);
      setDoctors(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDoctors(false);
    }
  };

  const loadSlots = async (doctorId: string, date: string) => {
    if (!doctorId || !date || !tenant?.id) return;
    setLoading(true);
    try {
      const data = await smartSchedulingService.getAvailableSlots(doctorId, date, tenant.id);
      setSlots(data);
    } catch (err) {
      console.error(err);
      setSlots([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDoctorChange = (id: string) => {
    setSelectedDoctor(id);
    setSlots([]);
    if (id && selectedDate) loadSlots(id, selectedDate);
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    setSlots([]);
    if (selectedDoctor && date) loadSlots(selectedDoctor, date);
  };

  // Generate next 15 days for date selector
  const dateOptions: { value: string; label: string }[] = [];
  for (let i = 0; i < 15; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    dateOptions.push({ value: iso, label });
  }

  const slotColor = (slot: SmartSlot) => {
    if (slot.is_auto_released) return 'border-amber-300 bg-amber-50 text-amber-700';
    if (slot.block_type === 'prime') return 'border-yellow-300 bg-yellow-50 text-yellow-700';
    return 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50';
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-indigo-600">
        <button onClick={onBack} className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-white">
          <p className="text-xs font-bold opacity-80 uppercase tracking-tighter">{t('sidebarAvailability.headerLabel')}</p>
          <p className="text-sm font-bold">{t('sidebarAvailability.headerTitle')}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Doctor selector */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">{t('sidebarAvailability.professionalLabel')}</label>
          {loadingDoctors ? (
            <div className="py-4 flex justify-center"><Loader2 className="animate-spin text-indigo-600 w-5 h-5" /></div>
          ) : (
            <select
              value={selectedDoctor}
              onChange={e => handleDoctorChange(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">{t('sidebarAvailability.selectPlaceholder')}</option>
              {doctors.map(doc => (
                <option key={doc.id} value={doc.id}>{doc.full_name}{doc.specialty ? ` · ${doc.specialty}` : ''}</option>
              ))}
            </select>
          )}
        </div>

        {/* Date selector */}
        {selectedDoctor && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">{t('sidebarAvailability.dateLabel')}</label>
            <div className="grid grid-cols-2 gap-1.5 max-h-[180px] overflow-y-auto">
              {dateOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleDateChange(opt.value)}
                  className={clsx(
                    'py-2 px-2 text-xs font-medium rounded-xl border transition-all text-left',
                    selectedDate === opt.value
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:bg-indigo-50'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Slots */}
        {selectedDoctor && selectedDate && (
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">
              {t('sidebarAvailability.slotsLabel')} {loading ? '' : `(${slots.length})`}
            </label>
            {loading ? (
              <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>
            ) : slots.length === 0 ? (
              <div className="py-8 text-center">
                <Calendar className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">{t('sidebarAvailability.noSlotsAvailable')}</p>
              </div>
            ) : (
              <>
                {/* Legend */}
                <div className="flex items-center gap-3 text-[9px] text-gray-400 mb-1">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" /> {t('sidebarAvailability.legendRegular')}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> {t('sidebarAvailability.legendPrime')}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> {t('sidebarAvailability.legendReleased')}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((slot, i) => (
                    <button
                      key={i}
                      onClick={() => onBookSlot?.(selectedDoctor, selectedDate, slot.slot_time)}
                      className={clsx('py-2 text-xs font-bold rounded-xl border transition-all', slotColor(slot))}
                      title={`${slot.block_type}${slot.location_name ? ` · ${slot.location_name}` : ''}${slot.allowed_patient_type !== 'any' ? ` · ${slot.allowed_patient_type}` : ''}`}
                    >
                      {formatSlot(slot.slot_time.substring(0, 5))}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
