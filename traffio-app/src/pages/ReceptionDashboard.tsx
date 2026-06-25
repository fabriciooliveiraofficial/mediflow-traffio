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
import { getIntlLocale } from '../lib/i18n';
import { useTenant } from '../contexts/TenantContext';
import { getTenantTodayString, localDateTimeToUTC } from '../lib/timezoneUtils';
import { Button, Badge, KpiCard, EmptyState, Card, PageHeader } from '../components/ui';

type StatusAccent = 'neutral' | 'warning' | 'brand' | 'success' | 'error';

export const ReceptionDashboard = () => {
    const { t, i18n } = useTranslation('crm');
    const { showToast } = useToast();
    const { tenant } = useTenant();
    const { formatTime, timezone } = useLocaleFormat();
    const [appointments, setAppointments] = useState<any[]>([]);
    const [filter, setFilter] = useState('all');
    const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
    const [currentTime, setCurrentTime] = useState(() => new Date());
    const [search, setSearch] = useState('');

    const fetchAppointments = useCallback(async () => {
        const tz = timezone || 'America/Sao_Paulo';
        const todayStr = getTenantTodayString(tz);
        const startOfDay = localDateTimeToUTC(todayStr, '00:00', tz).toISOString();
        const endOfDay = new Date(localDateTimeToUTC(todayStr, '23:59', tz).getTime() + 59999).toISOString();

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
        } else {
            setAppointments([]);
        }
    }, [formatTime, timezone, t]);

    useEffect(() => { fetchAppointments(); }, [fetchAppointments]);

    useEffect(() => {
        setCurrentTime(new Date());
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, [timezone]);

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

    const getStatusAccent = (status: string): StatusAccent => {
        switch (status) {
            case 'scheduled': return 'neutral';
            case 'waiting': return 'warning';
            case 'in_consult': return 'brand';
            case 'completed': return 'success';
            case 'cancelled': return 'error';
            default: return 'neutral';
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
            <PageHeader
                icon={MapPin}
                title={tenant?.name || 'Clínica'}
                subtitle={
                    <span className="flex items-center gap-2">
                        <Calendar size={14} />
                        {new Intl.DateTimeFormat(getIntlLocale(i18n.language), { timeZone: timezone || 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' }).format(currentTime)}
                        <span className="w-1 h-1 bg-graphite-300 rounded-full" />
                        <Clock size={14} />
                        {formatTime(currentTime)}
                    </span>
                }
                actions={
                    <>
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
                        <Button variant="success" onClick={handleCallNext}>
                            <Megaphone size={18} />
                            {t('receptionDashboard.callNext')}
                        </Button>
                        <Button variant="primary" onClick={() => setIsNewPatientModalOpen(true)}>
                            <UserPlus size={18} />
                            <span>{t('receptionDashboard.newPatient')}</span>
                        </Button>
                    </>
                }
            />

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard
                    label={t('receptionDashboard.totalToday')}
                    value={appointments.length}
                    icon={Calendar}
                    accent="neutral"
                />
                <KpiCard
                    label={t('receptionDashboard.waiting')}
                    value={appointments.filter(a => a.status === 'waiting').length}
                    icon={Clock}
                    accent="warning"
                />
                <KpiCard
                    label={t('receptionDashboard.inConsult')}
                    value={appointments.filter(a => a.status === 'in_consult').length}
                    icon={User}
                    accent="brand"
                />
                <KpiCard
                    label={t('receptionDashboard.completed')}
                    value={appointments.filter(a => a.status === 'completed').length}
                    icon={CheckCircle2}
                    accent="success"
                />
            </div>

            {/* Main List */}
            <Card variant="panel" padding="none" className="overflow-hidden flex flex-col min-h-[500px]">
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
                        <EmptyState icon={Search} label={t('receptionDashboard.empty')} />
                    ) : (
                        filteredAppointments.map((app) => (
                            <div key={app.id} className="p-4 hover:bg-ice-50/50 transition-colors flex flex-col md:flex-row md:items-center gap-4 group">
                                {/* Time & Status */}
                                <div className="flex items-center gap-4 w-40 shrink-0">
                                    <span className="font-black text-xl text-graphite-900">{app.time}</span>
                                    <Badge accent={getStatusAccent(app.status)} variant="pill" size="sm">
                                        {getStatusLabel(app.status)}
                                    </Badge>
                                </div>

                                {/* Patient Info */}
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-graphite-900 text-base">{app.patient}</h4>
                                        <Badge accent="neutral" variant="tag" size="sm">
                                            {app.type}
                                        </Badge>
                                        {app.checkin_at && (
                                            <Badge accent="success" variant="pill" size="sm">
                                                <Wifi size={10} /> {t('receptionDashboard.checkinOk')}
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-xs text-graphite-400 font-medium mt-0.5 flex items-center gap-1">
                                        <User size={12} /> {app.doctor}
                                    </p>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                    {app.status === 'scheduled' && (
                                        <Button variant="primary" size="sm" onClick={() => handleStatusChange(app.id, 'waiting')}>
                                            <CheckCircle2 size={14} />
                                            {t('receptionDashboard.actions.arrived')}
                                        </Button>
                                    )}
                                    {app.status === 'waiting' && (
                                        <Button variant="secondary" size="sm" onClick={() => handleStatusChange(app.id, 'in_consult')}>
                                            <Megaphone size={14} />
                                            {t('receptionDashboard.actions.call')}
                                        </Button>
                                    )}
                                    {app.status === 'in_consult' && (
                                        <Button variant="success" size="sm" onClick={() => handleStatusChange(app.id, 'completed')}>
                                            <CheckCircle2 size={14} />
                                            {t('receptionDashboard.actions.finish')}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </Card>

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
