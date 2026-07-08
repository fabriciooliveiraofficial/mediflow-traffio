import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Plus,
    Search,
    Trash2,
    Save,
    X,
    Clock,
    DollarSign,
    Tag,
    Palette,
    ToggleLeft,
    ToggleRight,
    MapPin,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { locationService, type ClinicLocation } from '../../services/locationService';
import { professionalService } from '../../services/professionalService';

interface DoctorType {
    id: string; // This is the profile/member ID (the UUID)
    full_name: string;
    specialty: string;
}

interface ServiceType {
    id: string;
    name: string;
    duration_minutes: number;
    price_cents: number;
    color_hex: string;
    preparation_instructions: string;
    is_active: boolean;
    doctor_services?: { doctor_id: string; location_id: string | null }[];
}

const EMPTY_FORM = {
    name: '',
    duration_minutes: 30,
    price_cents: 0,
    color_hex: '#1152d4',
    preparation_instructions: '',
    is_active: true,
};

export const Services = () => {
    const { t } = useTranslation('tenantAdmin');
    const { showToast, showConfirm } = useToast();
    const [services, setServices] = useState<ServiceType[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Doctor & Location Linkage State
    const [doctors, setDoctors] = useState<DoctorType[]>([]);
    const [locations, setLocations] = useState<ClinicLocation[]>([]);
    const [serviceLinks, setServiceLinks] = useState<{ doctor_id: string, location_id: string | null }[]>([]);

    useEffect(() => {
        fetchInitialData();
    }, []);

    const fetchInitialData = async () => {
        setLoading(true);
        // Get tenant_id from members table
        const { data: member } = await supabase.from('members').select('tenant_id').limit(1).single();
        const tenantId = member?.tenant_id;

        if (tenantId) {
            await Promise.all([
                fetchServices(),
                fetchDoctors(),
                fetchLocations(tenantId)
            ]);
        }
        setLoading(false);
    };

    const fetchLocations = async (tenantId: string) => {
        try {
            const locs = await locationService.getAll(tenantId);
            setLocations(locs.filter(l => l.is_active));
        } catch (err) {
            console.error('Error fetching locations:', err);
        }
    };

    const fetchDoctors = async () => {
        console.log('Fetching doctors...');
        const { data: member } = await supabase.from('members').select('tenant_id').limit(1).single();
        const tenantId = member?.tenant_id;

        if (!tenantId) {
            console.error('No tenantId found for doctor fetch');
            return;
        }

        try {
            const allPros = await professionalService.getAll(tenantId);
            
            // Map to the internal DoctorType format, filtering only active ones
            const mapped = allPros
                .filter((p: any) => p.is_active)
                .map((p: any) => ({
                    id: p.id,
                    full_name: p.full_name || t('services.noNameFallback'),
                    specialty: p.specialty || t('services.noSpecialtyFallback')
                }))
                .sort((a: any, b: any) => a.full_name.localeCompare(b.full_name));

            console.log('Mapped doctors:', mapped);
            setDoctors(mapped);
        } catch (err) {
            console.error('Error fetching professionals:', err);
        }
    };

    const fetchServices = async () => {
        const { data, error } = await supabase
            .from('appointment_types')
            .select('*')
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching services:', error);
            return;
        }

        const serviceIds = (data || []).map((service: any) => service.id);
        if (serviceIds.length === 0) {
            setServices([]);
            return;
        }

        const { data: links, error: linksError } = await supabase
            .from('doctor_services')
            .select('service_id, doctor_id, location_id')
            .in('service_id', serviceIds);

        if (linksError) {
            console.error('Error fetching service links:', linksError);
        }

        const linksByServiceId = (links || []).reduce<Record<string, { doctor_id: string; location_id: string | null }[]>>((acc, link: any) => {
            if (!acc[link.service_id]) acc[link.service_id] = [];
            acc[link.service_id].push({
                doctor_id: link.doctor_id,
                location_id: link.location_id
            });
            return acc;
        }, {});

        setServices((data || []).map((service: any) => ({
            ...service,
            doctor_services: linksByServiceId[service.id] || []
        })) as ServiceType[]);
    };

    const handleSave = async () => {
        console.log('handleSave started');
        setSaving(true);
        try {
            // 1. Get Tenant ID first (Critical)
            const { data: member, error: tenantErr } = await supabase.from('members').select('tenant_id').limit(1).single();
            const tenantId = member?.tenant_id;
            
            if (tenantErr || !tenantId) {
                console.error('Tenant fetch error:', tenantErr);
                showToast('error', t('services.toasts.tenantNotIdentified'));
                setSaving(false);
                return;
            }

            console.log('Found tenantId:', tenantId);
            let serviceId = editingId;

            // 2. Save Appointment Type
            if (editingId) {
                console.log('Updating service:', editingId);
                const { error: updateErr } = await supabase.from('appointment_types').update({
                    name: form.name,
                    duration_minutes: form.duration_minutes,
                    price_cents: form.price_cents,
                    color_hex: form.color_hex,
                    preparation_instructions: form.preparation_instructions,
                    is_active: form.is_active,
                }).eq('id', editingId);
                
                if (updateErr) throw updateErr;
            } else {
                console.log('Creating new service');
                const { data: newService, error: insErr } = await supabase.from('appointment_types').insert({
                    tenant_id: tenantId,
                    name: form.name,
                    duration_minutes: form.duration_minutes,
                    price_cents: form.price_cents,
                    color_hex: form.color_hex,
                    preparation_instructions: form.preparation_instructions,
                    is_active: form.is_active,
                }).select().single();

                if (insErr) throw insErr;
                serviceId = newService.id;
            }

            // 3. Sync Links
            if (serviceId) {
                console.log('Syncing doctor_services for ID:', serviceId);
                
                // Delete missing/old links
                const { error: delErr } = await supabase.from('doctor_services').delete().eq('service_id', serviceId);
                if (delErr) {
                    console.error('Delete links error:', delErr);
                    throw delErr;
                }

                const seen = new Set<string>();
                const linksToInsert = serviceLinks
                    .filter(l => l.doctor_id)
                    .map(l => ({
                        tenant_id: tenantId,
                        service_id: serviceId,
                        doctor_id: l.doctor_id,
                        location_id: l.location_id
                    }))
                    .filter(l => {
                        const key = `${l.doctor_id}:${l.location_id ?? 'any'}`;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });

                console.log('Links to insert:', linksToInsert);

                if (serviceLinks.length > 0 && linksToInsert.length === 0) {
                    showToast('warning', t('services.toasts.linksWithoutDoctorWarning'));
                }

                if (linksToInsert.length > 0) {
                    const { error: linkErr } = await supabase.from('doctor_services').insert(linksToInsert);
                    if (linkErr) {
                        console.error('Insert links error:', linkErr);
                        throw linkErr;
                    }
                }
            }

            console.log('Save comprehensive success');
            showToast('success', t('services.toasts.saveSuccess'));
            setShowModal(false);
            setEditingId(null);
            setForm(EMPTY_FORM);
            setServiceLinks([]);
            fetchServices();
        } catch (err: any) {
            console.error('CRITICAL SAVE ERROR:', err);
            showToast('error', t('services.toasts.saveErrorPrefix', { message: err.message || JSON.stringify(err) }));
        } finally {
            setSaving(false);
        }
    };

    const handleEdit = async (s: ServiceType) => {
        setEditingId(s.id);
        setForm({
            name: s.name,
            duration_minutes: s.duration_minutes,
            price_cents: s.price_cents,
            color_hex: s.color_hex,
            preparation_instructions: s.preparation_instructions || '',
            is_active: s.is_active,
        });

        // Fetch existing links
        const { data: links } = await supabase
            .from('doctor_services')
            .select('doctor_id, location_id')
            .eq('service_id', s.id);

        if (links) {
            setServiceLinks(links.map(l => ({ doctor_id: l.doctor_id, location_id: l.location_id })));
        } else {
            setServiceLinks([]);
        }

        setShowModal(true);
    };

    const isForeignKeyDeleteError = (err: any) => {
        const message = String(err?.message || '');
        return err?.code === '23503' || message.includes('violates foreign key constraint');
    };

    const handleDelete = async (id: string) => {
        const { count, error: countError } = await supabase
            .from('appointments')
            .select('id', { count: 'exact', head: true })
            .eq('type_id', id);

        if (!countError && (count || 0) > 0) {
            showToast('warning', t('services.toasts.deleteBlockedWithAppointments'));
            return;
        }

        const confirmed = await showConfirm(t('services.deleteConfirm'));
        if (!confirmed) return;

        try {
            const { error } = await supabase.from('appointment_types').delete().eq('id', id);
            if (error) throw error;

            showToast('success', t('services.toasts.deleteSuccess'));
            fetchServices();
        } catch (err: any) {
            if (isForeignKeyDeleteError(err)) {
                showToast('warning', t('services.toasts.deleteBlockedWithAppointments'));
                return;
            }

            showToast('error', t('services.toasts.deleteErrorPrefix', { message: err.message || JSON.stringify(err) }));
        }
    };

    const handleToggle = async (id: string, current: boolean) => {
        await supabase.from('appointment_types').update({ is_active: !current }).eq('id', id);
        fetchServices();
    };

    const filtered = services.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase())
    );

    // Grouping Logic
    const groupedServices = useMemo(() => {
        const groups: { [key: string]: { doctor: DoctorType | null, services: ServiceType[] } } = {};
        
        groups['shared'] = { doctor: null, services: [] };
        groups['unassigned'] = { doctor: null, services: [] };
        
        doctors.forEach(doc => {
            groups[doc.id] = { doctor: doc, services: [] };
        });

        filtered.forEach(service => {
            const linkedDoctorIds = Array.from(new Set(
                (service.doctor_services || [])
                    .map(link => link.doctor_id)
                    .filter(doctorId => groups[doctorId])
            ));

            if (linkedDoctorIds.length > 1) {
                groups['shared'].services.push(service);
            } else if (linkedDoctorIds.length === 1) {
                groups[linkedDoctorIds[0]].services.push(service);
            } else {
                groups['unassigned'].services.push(service);
            }
        });

        return groups;
    }, [filtered, doctors]);

    const getServiceDoctorNames = (service: ServiceType) => {
        const linkedDoctorIds = Array.from(new Set(
            (service.doctor_services || []).map(link => link.doctor_id)
        ));

        return linkedDoctorIds
            .map(doctorId => doctors.find(doc => doc.id === doctorId)?.full_name)
            .filter(Boolean) as string[];
    };

    const formatPrice = (cents: number) => {
        return (cents / 100).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2
        });
    };

    // Helper Component for Service Card to avoid logic duplication
    const ServiceCard = ({ service: s, showProfessionals = false }: { service: ServiceType; showProfessionals?: boolean }) => {
        const linkedDoctorNames = showProfessionals ? getServiceDoctorNames(s) : [];

        return (
            <div
                key={s.id}
                onClick={() => handleEdit(s)}
                className="group bg-white rounded-2xl border border-transparent shadow-float p-5 hover:border-brand-primary/30 transition-all cursor-pointer relative overflow-hidden h-full"
            >
                {/* Color Indicator */}
                <div
                    className="absolute top-0 left-0 w-1 h-full rounded-l-2xl"
                    style={{ backgroundColor: s.color_hex }}
                />

                <div className="flex items-start justify-between">
                    <div className="pl-3">
                        <p className="font-black text-graphite-900 text-base leading-tight">{s.name}</p>
                        <div className="flex items-center gap-3 mt-2">
                            <span className="flex items-center gap-1 text-xs font-bold text-graphite-400">
                                <Clock size={12} /> {s.duration_minutes} min
                            </span>
                            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
                                <DollarSign size={12} /> {formatPrice(s.price_cents)}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={(e) => { e.stopPropagation(); handleToggle(s.id, s.is_active); }}
                            className="p-1.5 rounded-lg border-none cursor-pointer transition-colors hover:bg-ice-50"
                            title={s.is_active ? t('services.card.deactivate') : t('services.card.activate')}
                        >
                            {s.is_active ? (
                                <ToggleRight size={20} className="text-emerald-500" />
                            ) : (
                                <ToggleLeft size={20} className="text-graphite-300" />
                            )}
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                            className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg border-none cursor-pointer transition-all"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>

                {linkedDoctorNames.length > 0 && (
                    <div className="mt-3 ml-3 flex flex-wrap gap-1.5">
                        {linkedDoctorNames.map(name => (
                            <span key={name} className="px-2 py-0.5 rounded-lg bg-ice-50 border border-ice-100 text-[10px] font-black text-graphite-500">
                                {name}
                            </span>
                        ))}
                    </div>
                )}

                {!s.is_active && (
                    <span className="mt-2 inline-block px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-rose-100 text-rose-600 ml-3">
                        {t('services.card.inactiveBadge')}
                    </span>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-graphite-900 tracking-tight">{t('services.header.title')}</h1>
                    <p className="text-graphite-500 font-medium">{t('services.header.subtitle')}</p>
                </div>
                <button
                    onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setServiceLinks([]); setShowModal(true); }}
                    className="flex items-center gap-2 bg-brand-primary text-white px-5 py-3 rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-transform border-none cursor-pointer"
                >
                    <Plus size={18} />
                    {t('services.header.newButton')}
                </button>
            </div>

            {/* Search */}
            <div className="relative">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400" />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('services.searchPlaceholder')}
                    className="w-full bg-white shadow-float rounded-2xl pl-12 pr-4 py-3.5 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all placeholder:text-graphite-300"
                />
            </div>

            {/* Grouped Content */}
            <div className="space-y-12">
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="bg-white rounded-2xl shadow-float p-5 animate-pulse">
                                <div className="h-4 bg-ice-100 rounded mb-3 w-3/4" />
                                <div className="h-3 bg-ice-100 rounded w-1/2" />
                            </div>
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-12 text-graphite-400 font-medium bg-ice-50 rounded-3xl border border-dashed border-ice-200">
                        {t('services.emptyState')}
                    </div>
                ) : (
                    <>
                        {/* 1. Shared Services */}
                        {groupedServices['shared'].services.length > 0 && (
                            <div className="space-y-6">
                                <div className="flex items-center gap-3 px-2">
                                    <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                                        <Tag size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black text-graphite-900 tracking-tight leading-none mb-1">{t('services.shared.title')}</h2>
                                        <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{t('services.shared.subtitle')}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {groupedServices['shared'].services.map(s => (
                                        <ServiceCard key={`shared-${s.id}`} service={s} showProfessionals />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 2. Services by Professional */}
                        {doctors.map(doc => {
                            const group = groupedServices[doc.id];
                            if (!group || group.services.length === 0) return null;

                            return (
                                <div key={doc.id} className="space-y-6">
                                    <div className="flex items-center gap-3 px-2">
                                        <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                                            <Tag size={20} />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-black text-graphite-900 tracking-tight leading-none mb-1">{doc.full_name}</h2>
                                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{doc.specialty}</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {group.services.map(s => (
                                            <ServiceCard key={`${doc.id}-${s.id}`} service={s} />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}

                        {/* 3. Clinical General Services (Unassigned) */}
                        {groupedServices['unassigned'].services.length > 0 && (
                            <div className="space-y-6 pt-4">
                                <div className="flex items-center gap-3 px-2">
                                    <div className="w-10 h-10 rounded-xl bg-ice-100 flex items-center justify-center text-graphite-400">
                                        <Palette size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black text-graphite-900 tracking-tight leading-none mb-1">{t('services.clinicGeneral.title')}</h2>
                                        <p className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">{t('services.clinicGeneral.subtitle')}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {groupedServices['unassigned'].services.map(s => (
                                        <ServiceCard key={`un-${s.id}`} service={s} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <>
                    <div className="fixed inset-0 bg-graphite-900/40 backdrop-blur-sm z-[100]" onClick={() => setShowModal(false)} />
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                        <div className="bg-white pointer-events-auto w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden border border-white/20">
                            <div className="px-8 py-6 border-b border-ice-100 flex justify-between items-center bg-ice-50/50">
                                <div>
                                    <h3 className="text-xl font-black text-graphite-900 tracking-tight flex items-center gap-2">
                                        <Tag className="text-brand-primary" size={24} />
                                        {editingId ? t('services.modal.titleEdit') : t('services.modal.titleNew')}
                                    </h3>
                                </div>
                                <button onClick={() => setShowModal(false)} className="w-10 h-10 rounded-xl bg-white border border-ice-200 flex items-center justify-center text-graphite-400 hover:text-brand-primary transition-all cursor-pointer">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="p-8 space-y-5">
                                <div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{t('services.modal.nameLabel')}</label>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-black uppercase text-graphite-400">{form.is_active ? t('services.modal.activeLabel') : t('services.modal.inactiveLabel')}</span>
                                            <button 
                                                onClick={() => setForm({ ...form, is_active: !form.is_active })}
                                                className="focus:outline-none"
                                            >
                                                {form.is_active ? (
                                                    <ToggleRight size={28} className="text-emerald-500" />
                                                ) : (
                                                    <ToggleLeft size={28} className="text-graphite-300" />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('services.modal.namePlaceholder')} className="w-full bg-ice-50 shadow-float rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-black text-graphite-400 uppercase mb-1 block flex items-center gap-1">
                                            <Clock size={12} /> {t('services.modal.durationLabel')}
                                        </label>
                                        <input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: parseInt(e.target.value) || 0 })} className="w-full bg-ice-50 shadow-float rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-black text-graphite-400 uppercase mb-1 block flex items-center gap-1">
                                            <DollarSign size={12} /> {t('services.modal.priceLabel')}
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-500 font-bold text-sm">R$</span>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={(form.price_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                onChange={(e) => {
                                                    const rawValue = e.target.value.replace(/\D/g, '');
                                                    setForm({ ...form, price_cents: parseInt(rawValue) || 0 });
                                                }}
                                                className="w-full bg-ice-50 shadow-float rounded-xl pl-10 pr-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-black text-graphite-400 uppercase mb-1 block flex items-center gap-1">
                                        <Palette size={12} /> {t('services.modal.colorLabel')}
                                    </label>
                                    <div className="flex items-center gap-3">
                                        <input type="color" value={form.color_hex} onChange={(e) => setForm({ ...form, color_hex: e.target.value })} className="w-10 h-10 rounded-xl shadow-float cursor-pointer" />
                                        <span className="text-sm font-mono text-graphite-500">{form.color_hex}</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-black text-graphite-400 uppercase mb-1 block">{t('services.modal.instructionsLabel')}</label>
                                    <textarea
                                        value={form.preparation_instructions}
                                        onChange={(e) => setForm({ ...form, preparation_instructions: e.target.value })}
                                        placeholder={t('services.modal.instructionsPlaceholder')}
                                        rows={3}
                                        className="w-full bg-ice-50 shadow-float rounded-xl px-4 py-3 text-sm font-medium text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors resize-none"
                                    />
                                </div>
                            </div>

                             {/* Doctor & Location Assignments */}
                             <div className="px-8 pb-8 space-y-4">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1">
                                        <MapPin size={12} /> {t('services.modal.assignmentsLabel')}
                                    </label>
                                    <button
                                        onClick={() => setServiceLinks(prev => [...prev, { doctor_id: '', location_id: null }])}
                                        className="text-[10px] font-black uppercase text-brand-primary bg-brand-primary/10 px-2 py-1 rounded-lg hover:bg-brand-primary/20 transition-colors border-none cursor-pointer"
                                    >
                                        {t('services.modal.addLocationButton')}
                                    </button>
                                </div>

                                <div className="space-y-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {serviceLinks.length === 0 ? (
                                        <div className="text-center py-6 bg-ice-50 rounded-2xl border-2 border-dashed border-ice-200">
                                            <p className="text-xs text-graphite-400 font-medium">{t('services.modal.noLocationsSelected')}</p>
                                        </div>
                                    ) : (
                                        serviceLinks.map((link, idx) => (
                                            <div key={idx} className="flex items-center gap-2 group">
                                                <div className="flex-1 grid grid-cols-2 gap-2 p-2 bg-ice-50 border border-transparent shadow-float rounded-xl group-hover:border-brand-primary/20 transition-all">
                                                    <select 
                                                        value={link.doctor_id}
                                                        onChange={(e) => {
                                                            const newList = [...serviceLinks];
                                                            newList[idx].doctor_id = e.target.value;
                                                            setServiceLinks(newList);
                                                        }}
                                                        className="bg-transparent border-none text-xs font-bold text-graphite-700 focus:outline-none cursor-pointer"
                                                    >
                                                        <option value="">{t('services.modal.selectDoctorPlaceholder')}</option>
                                                        {doctors.map(d => (
                                                            <option key={d.id} value={d.id}>{d.full_name}</option>
                                                        ))}
                                                    </select>
                                                    <select 
                                                        value={link.location_id || ''}
                                                        onChange={(e) => {
                                                            const newList = [...serviceLinks];
                                                            newList[idx].location_id = e.target.value || null;
                                                            setServiceLinks(newList);
                                                        }}
                                                        className="bg-transparent border-none text-xs font-bold text-graphite-700 focus:outline-none cursor-pointer"
                                                    >
                                                        <option value="">{t('services.modal.anyLocationPlaceholder')}</option>
                                                        {locations.map(l => (
                                                            <option key={l.id} value={l.id}>{l.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <button 
                                                    onClick={() => setServiceLinks(prev => prev.filter((_, i) => i !== idx))}
                                                    className="p-2 text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all border-none cursor-pointer"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setShowModal(false)} className="flex-1 py-3.5 rounded-2xl font-bold text-graphite-700 hover:bg-ice-50 border border-ice-200 transition-all cursor-pointer">
                                    {t('services.modal.cancelButton')}
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving || !form.name}
                                    className="flex-[2] bg-brand-primary text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 border-none cursor-pointer"
                                >
                                    <Save size={18} />
                                    {saving ? t('services.modal.saving') : t('services.modal.saveButton')}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
