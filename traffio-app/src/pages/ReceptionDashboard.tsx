import { useState, useEffect, useCallback } from 'react';
import {
    Calendar,
    Search,
    Clock,
    User,
    MapPin,
    CheckCircle2,
    UserPlus,
    Megaphone,
    Wifi,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NewPatientModal } from '../components/NewPatientModal';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';

export const ReceptionDashboard = () => {
    const { t } = useTranslation('crm');
    const { showToast } = useToast();
    const { formatTime } = useLocaleFormat();
    const [appointments, setAppointments] = useState<any[]>([]);
    const [filter, setFilter] = useState('all');
    const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [search, setSearch] = useState('');

    const fetchAppointments = useCallback(async () => {
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
        const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

        const { data } = await supabase
            .from('appointments')
            .select('*, patients(full_name), doctors:doctor_id(id, profiles:id(full_name))')
            .gte('start_time', startOfDay)
            .lte('start_time', endOfDay)
            .order('start_time', { ascending: true });

        if (data && data.length > 0) {
            setAppointments(data.map((a: any) => ({
                id: a.id,
                time: formatTime(a.start_time),
                patient: a.patients?.full_name || t('receptionDashboard.patientFallback'),
                doctor: 'Dr. ' + (a.doctors?.profiles?.full_name || 'N/A'),
                status: a.status,
                type: a.notes || t('receptionDashboard.consultationFallback'),
                checkin_at: a.checkin_at,
            })));
        }
    }, [formatTime]);

    useEffect(() => { fetchAppointments(); }, [fetchAppointments]);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    const handleStatusChange = async (id: string, newStatus: string) => {
        const updates: any = { status: newStatus };
        if (newStatus === 'checkin_done') updates.checkin_at = new Date().toISOString();
        await supabase.from('appointments').update(updates).eq('id', id);
        fetchAppointments();
    };

    const handleCallNext = () => {
        const next = appointments.find(a => a.status === 'waiting' || a.status === 'checkin_done');
        if (next) {
            handleStatusChange(next.id, 'in_consult');
            showToast('success', t('receptionDashboard.toasts.calling', { name: next.patient }));
        } else {
            showToast('info', t('receptionDashboard.toasts.noPatientInQueue'));
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'scheduled': return 'bg-ice-100 text-graphite-500';
            case 'waiting': return 'bg-amber-100 text-amber-600';
            case 'in_consult': return 'bg-brand-secondary/30 text-brand-primary';
            case 'completed': return 'bg-emerald-100 text-emerald-600';
            case 'cancelled': return 'bg-rose-100 text-rose-600';
            default: return 'bg-gray-100 text-gray-500';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'scheduled': return t('receptionDashboard.status.scheduled');
            case 'waiting': return t('receptionDashboard.status.waiting');
            case 'in_consult': return t('receptionDashboard.status.inConsult');
            case 'completed': return t('receptionDashboard.status.completed');
            case 'cancelled': return t('receptionDashboard.status.cancelled');
            default: return status;
        }
    };

    const filteredAppointments = appointments.filter(app => {
        if (filter !== 'all' && app.status !== filter) return false;
        if (search && !app.patient.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Top Bar: Clinic Status & Actions */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <MapPin className="text-brand-primary" size={20} />
                        <h2 className="text-xl font-black text-graphite-900 tracking-tight">Clínica Downtown</h2>
                    </div>
                    <p className="text-graphite-500 font-medium flex items-center gap-2">
                        <Calendar size={14} />
                        {currentTime.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                        <span className="w-1 h-1 bg-graphite-300 rounded-full" />
                        <Clock size={14} />
                        {formatTime(currentTime)}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="hidden md:flex items-center gap-2 bg-white border border-ice-200 rounded-xl px-4 py-2.5 shadow-sm">
                        <Search size={18} className="text-graphite-300" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('receptionDashboard.searchPlaceholder')}
                            className="bg-transparent border-none outline-none text-sm font-medium w-64"
                        />
                    </div>
                    <button
                        onClick={handleCallNext}
                        className="flex items-center gap-2 bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-emerald-500/20 hover:scale-105 transition-transform border-none cursor-pointer"
                    >
                        <Megaphone size={18} />
                        {t('receptionDashboard.callNext')}
                    </button>
                    <button
                        onClick={() => setIsNewPatientModalOpen(true)}
                        className="flex items-center gap-2 bg-brand-primary text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-brand-primary/20 hover:scale-105 transition-transform border-none cursor-pointer"
                    >
                        <UserPlus size={18} />
                        <span>{t('receptionDashboard.newPatient')}</span>
                    </button>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-ice-100 shadow-sm">
                    <p className="text-xs font-black text-graphite-400 uppercase tracking-wider mb-1">{t('receptionDashboard.totalToday')}</p>
                    <p className="text-2xl font-black text-graphite-900">{appointments.length}</p>
                </div>
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 shadow-sm">
                    <p className="text-xs font-black text-amber-700 uppercase tracking-wider mb-1">{t('receptionDashboard.waiting')}</p>
                    <p className="text-2xl font-black text-amber-900">
                        {appointments.filter(a => a.status === 'waiting').length}
                    </p>
                </div>
                <div className="bg-brand-secondary/10 p-4 rounded-2xl border border-brand-secondary/20 shadow-sm">
                    <p className="text-xs font-black text-brand-primary uppercase tracking-wider mb-1">{t('receptionDashboard.inConsult')}</p>
                    <p className="text-2xl font-black text-brand-primary">
                        {appointments.filter(a => a.status === 'in_consult').length}
                    </p>
                </div>
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 shadow-sm">
                    <p className="text-xs font-black text-emerald-700 uppercase tracking-wider mb-1">{t('receptionDashboard.completed')}</p>
                    <p className="text-2xl font-black text-emerald-900">
                        {appointments.filter(a => a.status === 'completed').length}
                    </p>
                </div>
            </div>

            {/* Main List */}
            <div className="bg-white rounded-[32px] border border-ice-200 shadow-sm overflow-hidden flex flex-col min-h-[500px]">
                {/* List Header */}
                <div className="p-6 border-b border-ice-100 flex items-center justify-between bg-ice-50/50">
                    <h3 className="font-black text-lg text-graphite-900">{t('receptionDashboard.dayAgenda')}</h3>
                    <div className="flex bg-white border border-ice-200 rounded-lg p-1">
                        {['all', 'waiting', 'completed'].map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all border-none cursor-pointer ${filter === f
                                    ? 'bg-graphite-900 text-white shadow-sm'
                                    : 'text-graphite-500 hover:text-graphite-900 hover:bg-ice-50'
                                    }`}
                            >
                                {f === 'all' ? t('receptionDashboard.filters.all') : f === 'waiting' ? t('receptionDashboard.filters.waiting') : t('receptionDashboard.filters.completed')}
                            </button>
                        ))}
                    </div>
                </div>

                {/* List Content */}
                <div className="divide-y divide-ice-50 overflow-y-auto">
                    {filteredAppointments.length === 0 ? (
                        <div className="p-12 text-center text-graphite-400">
                            <p className="font-medium">{t('receptionDashboard.empty')}</p>
                        </div>
                    ) : (
                        filteredAppointments.map((app) => (
                            <div key={app.id} className="p-4 hover:bg-ice-50/50 transition-colors flex flex-col md:flex-row md:items-center gap-4 group">
                                {/* Time & Status */}
                                <div className="flex items-center gap-4 w-40 shrink-0">
                                    <span className="font-black text-xl text-graphite-900">{app.time}</span>
                                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${getStatusColor(app.status)}`}>
                                        {getStatusLabel(app.status)}
                                    </span>
                                </div>

                                {/* Patient Info */}
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-graphite-900 text-base">{app.patient}</h4>
                                        <span className="text-xs font-medium text-graphite-400 px-2 py-0.5 bg-ice-100 rounded-full">
                                            {app.type}
                                        </span>
                                        {app.checkin_at && (
                                            <span className="flex items-center gap-1 text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                                <Wifi size={10} /> {t('receptionDashboard.checkinOk')}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-graphite-400 font-medium mt-0.5 flex items-center gap-1">
                                        <User size={12} /> {app.doctor}
                                    </p>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                    {app.status === 'scheduled' && (
                                        <button
                                            onClick={() => handleStatusChange(app.id, 'waiting')}
                                            className="px-4 py-2 bg-brand-primary text-white rounded-xl text-xs font-bold hover:scale-105 transition-transform shadow-md shadow-brand-primary/20 border-none cursor-pointer flex items-center gap-2"
                                        >
                                            <CheckCircle2 size={14} />
                                            {t('receptionDashboard.actions.arrived')}
                                        </button>
                                    )}
                                    {app.status === 'waiting' && (
                                        <button
                                            onClick={() => handleStatusChange(app.id, 'in_consult')}
                                            className="px-4 py-2 bg-brand-secondary text-brand-primary rounded-xl text-xs font-bold hover:bg-brand-secondary/80 transition-colors border-none cursor-pointer flex items-center gap-2"
                                        >
                                            <Megaphone size={14} />
                                            {t('receptionDashboard.actions.call')}
                                        </button>
                                    )}
                                    {app.status === 'in_consult' && (
                                        <button
                                            onClick={() => handleStatusChange(app.id, 'completed')}
                                            className="px-4 py-2 bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold hover:bg-emerald-200 transition-colors border-none cursor-pointer flex items-center gap-2"
                                        >
                                            <CheckCircle2 size={14} />
                                            {t('receptionDashboard.actions.finish')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <NewPatientModal
                isOpen={isNewPatientModalOpen}
                onClose={() => setIsNewPatientModalOpen(false)}
                onSuccess={() => {
                    // Refresh appointments or add waiting walk-in
                    showToast('success', t('receptionDashboard.toasts.patientRegistered'));
                    fetchAppointments();
                }}
            />
        </div>
    );
};
