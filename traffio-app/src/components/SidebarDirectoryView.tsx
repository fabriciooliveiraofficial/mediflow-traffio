import React, { useState, useEffect } from 'react';
import { ChevronLeft, Loader2, MapPin, Phone, Building2, User, Search, Stethoscope, Clock } from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';
import { locationService } from '../services/locationService';
import type { ClinicLocation } from '../services/locationService';
import { professionalService } from '../services/professionalService';
import type { Professional } from '../services/professionalService';
import { clsx } from 'clsx';

interface SidebarDirectoryViewProps {
  onBack: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  consultorio: 'Consultório',
  clinica: 'Clínica',
  hospital: 'Hospital',
};

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function SidebarDirectoryView({ onBack }: SidebarDirectoryViewProps) {
  const { tenant } = useTenant();
  const [tab, setTab] = useState<'locations' | 'professionals'>('locations');
  const [filter, setFilter] = useState('');
  const [locations, setLocations] = useState<ClinicLocation[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [loadingLoc, setLoadingLoc] = useState(true);
  const [loadingProf, setLoadingProf] = useState(true);

  useEffect(() => {
    if (tenant?.id) {
      loadLocations();
      loadProfessionals();
    }
  }, [tenant?.id]);

  const loadLocations = async () => {
    setLoadingLoc(true);
    try {
      const data = await locationService.getAll(tenant!.id);
      setLocations(data.filter(l => l.is_active));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLoc(false);
    }
  };

  const loadProfessionals = async () => {
    setLoadingProf(true);
    try {
      const data = await professionalService.getAll(tenant!.id);
      setProfessionals(data.filter(p => p.is_active));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingProf(false);
    }
  };

  const q = filter.toLowerCase();

  const filteredLocations = locations.filter(l =>
    l.name.toLowerCase().includes(q) ||
    l.address?.toLowerCase().includes(q) ||
    l.address_neighborhood?.toLowerCase().includes(q)
  );

  const filteredProfessionals = professionals.filter(p =>
    p.full_name.toLowerCase().includes(q) ||
    p.specialty?.toLowerCase().includes(q) ||
    p.crm?.toLowerCase().includes(q)
  );

  // Group professionals by specialty
  const groupedBySpecialty = filteredProfessionals.reduce<Record<string, Professional[]>>((acc, p) => {
    const spec = p.specialty || 'Geral';
    if (!acc[spec]) acc[spec] = [];
    acc[spec].push(p);
    return acc;
  }, {});

  const formatAddress = (loc: ClinicLocation) => {
    const parts = [loc.address];
    if (loc.address_number) parts.push(loc.address_number);
    if (loc.address_complement) parts.push(loc.address_complement);
    if (loc.address_neighborhood) parts.push(`- ${loc.address_neighborhood}`);
    return parts.filter(Boolean).join(', ');
  };

  const formatHours = (loc: ClinicLocation) => {
    if (!loc.operating_hours) return null;
    const entries = Object.entries(loc.operating_hours)
      .filter(([, v]) => !v.closed)
      .map(([k, v]) => `${DAY_NAMES[Number(k)]} ${v.start}-${v.end}`);
    return entries.length > 0 ? entries.join(' · ') : null;
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-slate-700">
        <button onClick={onBack} className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-white">
          <p className="text-xs font-bold opacity-80 uppercase tracking-tighter">Diretório</p>
          <p className="text-sm font-bold">Unidades & Profissionais</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex p-2 bg-gray-50 border-b border-gray-100">
        <button
          onClick={() => setTab('locations')}
          className={clsx('flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5',
            tab === 'locations' ? 'bg-white text-slate-700 shadow-sm' : 'text-gray-500'
          )}
        >
          <Building2 size={13} /> Unidades
        </button>
        <button
          onClick={() => setTab('professionals')}
          className={clsx('flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5',
            tab === 'professionals' ? 'bg-white text-slate-700 shadow-sm' : 'text-gray-500'
          )}
        >
          <Stethoscope size={13} /> Profissionais
        </button>
      </div>

      {/* Filter */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder={tab === 'locations' ? 'Buscar unidade...' : 'Buscar profissional...'}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === 'locations' ? (
          loadingLoc ? (
            <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-slate-600" /></div>
          ) : filteredLocations.length === 0 ? (
            <div className="py-12 text-center">
              <Building2 className="w-10 h-10 mx-auto text-gray-300 mb-2" />
              <p className="text-xs text-gray-400">Nenhuma unidade encontrada</p>
            </div>
          ) : (
            filteredLocations.map(loc => (
              <div key={loc.id} className="bg-white border border-gray-100 rounded-xl p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold text-gray-900">{loc.name}</p>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 uppercase shrink-0">
                    {TYPE_LABELS[loc.type] || loc.type}
                  </span>
                </div>
                {loc.address && (
                  <div className="flex items-start gap-1.5 text-[11px] text-gray-500">
                    <MapPin size={11} className="shrink-0 mt-0.5" />
                    <span>{formatAddress(loc)}</span>
                  </div>
                )}
                {loc.phone && (
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                    <Phone size={11} className="shrink-0" />
                    <a href={`tel:${loc.phone}`} className="text-blue-600 hover:underline">{loc.phone}</a>
                  </div>
                )}
                {formatHours(loc) && (
                  <div className="flex items-start gap-1.5 text-[10px] text-gray-400">
                    <Clock size={10} className="shrink-0 mt-0.5" />
                    <span>{formatHours(loc)}</span>
                  </div>
                )}
              </div>
            ))
          )
        ) : (
          loadingProf ? (
            <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-slate-600" /></div>
          ) : filteredProfessionals.length === 0 ? (
            <div className="py-12 text-center">
              <User className="w-10 h-10 mx-auto text-gray-300 mb-2" />
              <p className="text-xs text-gray-400">Nenhum profissional encontrado</p>
            </div>
          ) : (
            Object.entries(groupedBySpecialty).map(([specialty, profs]) => (
              <div key={specialty} className="space-y-1.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-2 first:mt-0">{specialty}</p>
                {profs.map(prof => (
                  <div key={prof.id} className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold"
                      style={{ backgroundColor: prof.color || '#6366f1' }}
                    >
                      {prof.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-gray-900 truncate">{prof.full_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {prof.crm && (
                          <span className="text-[10px] text-gray-400">CRM {prof.crm}</span>
                        )}
                        {prof.rqe && (
                          <span className="text-[10px] text-gray-400">RQE {prof.rqe}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}
