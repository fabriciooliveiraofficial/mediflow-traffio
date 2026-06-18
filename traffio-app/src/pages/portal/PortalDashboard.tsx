import { useEffect, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, Plus, Clock, MapPin, CheckCircle, Bell, BellRing, XCircle, RotateCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { appointmentService } from '../../services/appointmentService';
import { formatDate, formatSlot } from '../../lib/i18n/formatDateTime';
import { getCountry, DEFAULT_COUNTRY } from '../../lib/i18n/countryFormats';

export function PortalDashboard() {
    const { t } = useTranslation('portal');
    // @ts-ignore
    const { tenant, patient } = useOutletContext<{ tenant: any; patient: any }>();
    const slotLocale = tenant?.locale || getCountry(tenant?.country || DEFAULT_COUNTRY).locale;

    const [appointments, setAppointments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const { isSupported, permission, requestPermission } = usePushNotifications();

    // Cancellation Modal State
    const [cancellingApt, setCancellingApt] = useState<any | null>(null);
    const [cancelPenalty, setCancelPenalty] = useState<{ applies: boolean, percent: number }>({ applies: false, percent: 0 });
    const [isProcessingCancel, setIsProcessingCancel] = useState(false);
    const [cancelError, setCancelError] = useState<string | null>(null);

    useEffect(() => {
        if (!patient || !tenant) return;

        async function fetchAppointments() {
            try {
                const today = new Date().toISOString().split('T')[0];

                const { data, error } = await supabase
                    .from('appointments')
                    .select('*, doctor:doctors(*), location:locations(*)')
                    .eq('tenant_id', tenant.id)
                    .eq('patient_id', patient.id)
                    .in('status', ['scheduled', 'confirmed', 'waiting', 'in_progress'])
                    .gte('date', today)
                    .order('date', { ascending: true })
                    .order('start_time', { ascending: true });

                if (error) {
                    console.error('Error fetching appointments:', error);
                } else if (data) {
                    setAppointments(data);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }

        fetchAppointments();
    }, [patient, tenant]);

    const fetchAppointments = async () => {
        setLoading(true);
        try {
            const today = new Date().toISOString().split('T')[0];

            const { data, error } = await supabase
                .from('appointments')
                .select('*, doctor:doctors(*), location:locations(*)')
                .eq('tenant_id', tenant.id)
                .eq('patient_id', patient.id)
                .in('status', ['scheduled', 'confirmed', 'waiting', 'in_progress'])
                .gte('date', today)
                .order('date', { ascending: true })
                .order('start_time', { ascending: true });

            if (error) {
                console.error('Error fetching appointments:', error);
            } else if (data) {
                setAppointments(data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleInitiateCancel = (apt: any) => {
        // Evaluate penalty before showing modal
        const penaltyInfo = appointmentService.checkPenalty(
            apt.doctor?.cancellation_policy,
            apt.date,
            apt.start_time
        );
        setCancelPenalty(penaltyInfo);
        setCancellingApt(apt);
        setCancelError(null);
    };

    const handleConfirmCancel = async () => {
        if (!cancellingApt || !patient) return;

        setIsProcessingCancel(true);
        setCancelError(null);

        try {
            await appointmentService.cancelAppointment(
                cancellingApt.id,
                patient.phone, // Requires patient phone for RPC validation
                cancellingApt.doctor?.cancellation_policy,
                cancellingApt.date,
                cancellingApt.start_time
            );

            // Refresh list
            await fetchAppointments();
            setCancellingApt(null);
        } catch (err: any) {
            setCancelError(err.message || t('dashboard.cancelErrorGeneric'));
        } finally {
            setIsProcessingCancel(false);
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'scheduled': return { text: t('dashboard.status.scheduled'), bg: 'bg-blue-100', text_color: 'text-blue-700' };
            case 'confirmed': return { text: t('dashboard.status.confirmed'), bg: 'bg-emerald-100', text_color: 'text-emerald-700' };
            case 'waiting': return { text: t('dashboard.status.waiting'), bg: 'bg-amber-100', text_color: 'text-amber-700' };
            case 'in_progress': return { text: t('dashboard.status.inProgress'), bg: 'bg-purple-100', text_color: 'text-purple-700' };
            default: return { text: status, bg: 'bg-gray-100', text_color: 'text-gray-700' };
        }
    };

    return (
        <div className="space-y-6 font-sans">
            {/* Welcome Banner */}
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 mb-6 relative overflow-hidden">
                <div className="relative z-10">
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">
                        {t('dashboard.greeting', { name: patient.full_name?.split(' ')[0] })}
                    </h1>
                    <p className="text-gray-500 mt-2 font-medium">
                        {t('dashboard.welcomePrefix')} <span className="text-primary font-bold" style={{ color: tenant.color_primary }}>{tenant.name}</span>{t('dashboard.welcomeSuffix')}
                    </p>
                </div>
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl" style={{ backgroundColor: `${tenant.color_primary}1A` }} />
            </div>

            {/* Grid Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                {/* Appointment Cards */}
                {loading ? (
                    <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 h-64 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-1/3 mb-6"></div>
                        <div className="h-20 bg-gray-100 rounded-2xl mb-4"></div>
                        <div className="h-10 bg-gray-200 rounded-2xl"></div>
                    </div>
                ) : appointments.length > 0 ? (
                    appointments.map((apt) => {
                        const isToday = apt.date === new Date().toISOString().split('T')[0];
                        return (
                            <div key={apt.id} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 relative h-fit">
                                <h3 className="font-bold text-gray-400 text-xs uppercase tracking-widest mb-4">{t('dashboard.appointmentLabel')}</h3>

                                <div className="mb-4">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <p className="font-bold text-gray-900">{apt.doctor?.name || t('dashboard.doctorFallback')}</p>
                                            <p className="text-sm text-gray-500">{apt.doctor?.specialty || t('dashboard.specialtyFallback')}</p>
                                        </div>
                                        <span className={`px-2 py-1 rounded-lg text-xs font-bold ${getStatusText(apt.status).bg} ${getStatusText(apt.status).text_color}`}>
                                            {getStatusText(apt.status).text}
                                        </span>
                                    </div>

                                    <div className="space-y-2 mt-4 text-sm text-gray-600">
                                        <div className="flex items-center gap-2">
                                            <Calendar size={16} className="text-gray-400" />
                                            <span>{t('dashboard.dateAtTime', { date: formatDate(apt.date, { locale: slotLocale }), time: formatSlot(apt.start_time, { locale: slotLocale }) })}</span>
                                        </div>
                                        {apt.location && (
                                            <div className="flex items-center gap-2">
                                                <MapPin size={16} className="text-gray-400" />
                                                <span>{apt.location.name}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Contextual Actions */}
                                {isToday ? (
                                    <div className="space-y-2 mt-6">
                                        {(apt.status === 'scheduled' || apt.status === 'confirmed') && (
                                            <button
                                                onClick={() => window.location.href = `/checkin?apt=${apt.id}`}
                                                className="w-full py-3 bg-brand-primary text-white rounded-xl font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-sm"
                                                style={{ backgroundColor: tenant.color_primary }}
                                            >
                                                <CheckCircle size={18} /> {t('dashboard.checkinButton')}
                                            </button>
                                        )}

                                        {(apt.status === 'waiting' || apt.status === 'in_progress') && (
                                            <button
                                                onClick={() => window.location.href = `/waiting-room?tenant=${tenant.id}&apt=${apt.id}&pid=${patient.id}`}
                                                className="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-sm"
                                            >
                                                <Clock size={18} /> {t('dashboard.waitingRoomButton')}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-center">
                                        <p className="text-xs text-gray-400 font-medium text-center">
                                            {t('dashboard.checkinAvailableHint')}
                                        </p>
                                    </div>
                                )}

                                {/* Reschedule and Cancel Actions */}
                                {(apt.status === 'scheduled' || apt.status === 'confirmed') && (
                                    <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col gap-2">
                                        <button
                                            onClick={() => window.location.href = `/portal/${tenant.slug}/book?reschedule=${apt.id}&specialty=${apt.specialty_id}&doctor=${apt.professional_id}`}
                                            className="w-full py-2.5 bg-gray-50 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 border border-gray-200 cursor-pointer"
                                        >
                                            <RotateCw size={16} /> {t('dashboard.reschedule')}
                                        </button>
                                        <button
                                            onClick={() => handleInitiateCancel(apt)}
                                            className="w-full py-2.5 bg-rose-50 text-rose-600 rounded-xl font-bold hover:bg-rose-100 transition-colors flex items-center justify-center gap-2 border border-rose-100 cursor-pointer"
                                        >
                                            <XCircle size={16} /> {t('dashboard.cancelAppointment')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                ) : (
                    <Link
                        to={`/portal/${tenant.slug}/book`}
                        className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 relative overflow-hidden group hover:shadow-xl hover:shadow-primary/5 transition-all block"
                    >
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Calendar size={64} className="text-primary" style={{ color: tenant.color_primary }} />
                        </div>
                        <h3 className="font-bold text-gray-400 text-xs uppercase tracking-widest mb-6">{t('dashboard.nextAppointmentLabel')}</h3>

                        <div className="space-y-3">
                            <div className="flex flex-col items-center justify-center py-4 text-center">
                                <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 mb-3">
                                    <Calendar size={24} />
                                </div>
                                <p className="text-sm font-bold text-gray-900">{t('dashboard.noUpcomingAppointment')}</p>
                                <p className="text-xs text-gray-400 font-medium">{t('dashboard.bookCheckupHint')}</p>
                            </div>
                        </div>

                        <div
                            className="mt-6 w-full py-4 bg-primary text-white rounded-2xl font-bold hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
                            style={{ backgroundColor: tenant.color_primary }}
                        >
                            <Plus size={20} /> {t('dashboard.newAppointment')}
                        </div>
                    </Link>
                )}

                {/* Additional Action Card (Quick Book) */}
                {(appointments.length > 0) && (
                    <Link
                        to={`/portal/${tenant.slug}/book`}
                        className="bg-gray-50 p-6 rounded-3xl border border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-100 transition-all flex flex-col items-center justify-center text-center gap-3 min-h-[200px]"
                    >
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm">
                            <Plus size={24} className="text-gray-400" />
                        </div>
                        <div>
                            <p className="font-bold text-gray-700">{t('dashboard.newAppointment')}</p>
                            <p className="text-xs text-gray-500 mt-1">{t('dashboard.bookAnotherHint')}</p>
                        </div>
                    </Link>
                )}

                {/* Push Notifications Card */}
                {isSupported && permission !== 'granted' && permission !== 'denied' && (
                    <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 rounded-3xl shadow-sm border border-indigo-100 relative overflow-hidden flex flex-col justify-between">
                        <div className="absolute -top-6 -right-6 text-indigo-500/10">
                            <Bell size={120} />
                        </div>
                        <div>
                            <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-indigo-500 mb-4">
                                <BellRing size={20} />
                            </div>
                            <h3 className="font-bold text-gray-900 mb-1">{t('dashboard.notificationsTitle')}</h3>
                            <p className="text-sm text-gray-600 mb-6 relative z-10 w-4/5">
                                {t('dashboard.notificationsDescription')}
                            </p>
                        </div>
                        <button
                            onClick={requestPermission}
                            className="w-full py-3 bg-white text-indigo-600 rounded-xl font-bold text-sm shadow-sm border border-indigo-100 hover:bg-indigo-50 transition-colors relative z-10 cursor-pointer"
                        >
                            {t('dashboard.enableNotificationsButton')}
                        </button>
                    </div>
                )}
            </div>

            {/* Cancellation Modal */}
            {cancellingApt && (
                <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-xl font-black text-gray-900">{t('dashboard.cancelModal.title')}</h3>
                            <button
                                onClick={() => !isProcessingCancel && setCancellingApt(null)}
                                className="text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer"
                                disabled={isProcessingCancel}
                            >
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="mb-6 space-y-4">
                            <p className="text-gray-600">
                                {t('dashboard.cancelModal.confirmQuestionPart1')} <strong>{cancellingApt.doctor?.name || t('dashboard.cancelModal.doctorFallback')}</strong> {t('dashboard.cancelModal.confirmQuestionPart2')} <strong>{formatDate(cancellingApt.date, { locale: slotLocale })}</strong> {t('dashboard.cancelModal.confirmQuestionPart3')} <strong>{formatSlot(cancellingApt.start_time, { locale: slotLocale })}</strong>{t('dashboard.cancelModal.confirmQuestionSuffix')}
                            </p>

                            {/* Penalty Warning Box */}
                            {cancelPenalty.applies && (
                                <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl flex gap-3 items-start">
                                    <BellRing size={20} className="text-rose-500 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-bold text-rose-700 text-sm mb-1">{t('dashboard.cancelModal.penaltyWarningTitle')}</p>
                                        <p className="text-rose-600 text-sm">
                                            {t('dashboard.cancelModal.penaltyWarningTextPart1', { hours: cancellingApt.doctor?.cancellation_policy?.free_window_hours })}
                                            {' '}{t('dashboard.cancelModal.penaltyWarningTextPart2')} <strong>{cancelPenalty.percent}%</strong> {t('dashboard.cancelModal.penaltyWarningTextPart3')}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {!cancelPenalty.applies && cancellingApt.doctor?.cancellation_policy?.enabled && (
                                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex gap-3 items-start">
                                    <CheckCircle size={20} className="text-emerald-500 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-bold text-emerald-700 text-sm mb-1">{t('dashboard.cancelModal.freeCancelTitle')}</p>
                                        <p className="text-emerald-600 text-sm">
                                            {t('dashboard.cancelModal.freeCancelText')}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {cancelError && (
                                <p className="text-rose-500 text-sm font-medium">{cancelError}</p>
                            )}
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setCancellingApt(null)}
                                disabled={isProcessingCancel}
                                className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors border-none cursor-pointer disabled:opacity-50"
                            >
                                {t('dashboard.cancelModal.back')}
                            </button>
                            <button
                                onClick={handleConfirmCancel}
                                disabled={isProcessingCancel}
                                className="flex-1 py-3 px-4 bg-rose-500 text-white rounded-xl font-bold hover:bg-rose-600 transition-colors border-none cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isProcessingCancel ? (
                                    <>{t('dashboard.cancelModal.processing')}</>
                                ) : (
                                    <>{t('dashboard.cancelModal.confirmCancel')}</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
