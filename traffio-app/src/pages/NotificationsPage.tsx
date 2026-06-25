import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, MessageSquare, Monitor, Shield, Mail, Eye, EyeOff, Save, Loader2 } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useTenant } from '../contexts/TenantContext';

export const NotificationsPage = () => {
    const { t } = useTranslation('tenantAdmin');
    const { showToast } = useToast();
    const { settings, updateSettings, requestPermission } = useNotifications();
    const { tenant, updateTenant } = useTenant();

    const [smtpHost, setSmtpHost] = useState(tenant?.smtp_host || '');
    const [smtpPort, setSmtpPort] = useState(tenant?.smtp_port || 465);
    const [smtpUser, setSmtpUser] = useState(tenant?.smtp_user || '');
    const [smtpPass, setSmtpPass] = useState(tenant?.smtp_pass || '');
    const [smtpFrom, setSmtpFrom] = useState(tenant?.smtp_from || '');
    const [savingSmtp, setSavingSmtp] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (tenant) {
            setSmtpHost(tenant.smtp_host || '');
            setSmtpPort(tenant.smtp_port || 465);
            setSmtpUser(tenant.smtp_user || '');
            setSmtpPass(tenant.smtp_pass || '');
            setSmtpFrom(tenant.smtp_from || '');
        }
    }, [tenant]);

    const handleSaveSmtp = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSavingSmtp(true);
            await updateTenant({
                smtp_host: smtpHost,
                smtp_port: Number(smtpPort),
                smtp_user: smtpUser,
                smtp_pass: smtpPass,
                smtp_from: smtpFrom
            });
            showToast('success', t('notificationsPage.toasts.smtpSaved'));
        } catch (err: any) {
            showToast('error', t('notificationsPage.toasts.smtpSaveErrorPrefix', { message: err.message || err }));
        } finally {
            setSavingSmtp(false);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-black text-graphite-900 tracking-tight">{t('notificationsPage.header.title')}</h1>
                <p className="text-graphite-500 font-medium">{t('notificationsPage.header.subtitle')}</p>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Sound Alert */}
                <div
                    className={`group p-8 rounded-[32px] border-2 transition-all cursor-pointer hover:shadow-xl ${settings?.whatsapp_sound !== false ? 'border-brand-primary bg-brand-primary/5 shadow-brand-primary/10' : 'border-transparent bg-white shadow-float'}`}
                    onClick={() => updateSettings({ whatsapp_sound: settings?.whatsapp_sound === false })}
                >
                    <div className="flex justify-between items-start mb-6">
                        <div className={`p-4 rounded-2xl ${settings?.whatsapp_sound !== false ? 'bg-brand-primary text-white shadow-lg shadow-brand-primary/20' : 'bg-ice-50 text-graphite-400'}`}>
                            <Volume2 size={32} />
                        </div>
                        <div className={`w-14 h-7 rounded-full relative transition-colors ${settings?.whatsapp_sound !== false ? 'bg-brand-primary' : 'bg-ice-200'}`}>
                            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${settings?.whatsapp_sound !== false ? 'left-8' : 'left-1'}`}></div>
                        </div>
                    </div>
                    <h4 className="text-lg font-black text-graphite-900 mb-2">{t('notificationsPage.cards.soundAlert.title')}</h4>
                    <p className="text-sm text-graphite-500 font-medium leading-relaxed">{t('notificationsPage.cards.soundAlert.description')}</p>
                </div>

                {/* Toast Notification */}
                <div
                    className={`group p-8 rounded-[32px] border-2 transition-all cursor-pointer hover:shadow-xl ${settings?.whatsapp_toast !== false ? 'border-blue-500 bg-blue-50/50 shadow-blue-500/10' : 'border-transparent bg-white shadow-float'}`}
                    onClick={() => updateSettings({ whatsapp_toast: settings?.whatsapp_toast === false })}
                >
                    <div className="flex justify-between items-start mb-6">
                        <div className={`p-4 rounded-2xl ${settings?.whatsapp_toast !== false ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'bg-ice-50 text-graphite-400'}`}>
                            <MessageSquare size={32} />
                        </div>
                        <div className={`w-14 h-7 rounded-full relative transition-colors ${settings?.whatsapp_toast !== false ? 'bg-blue-500' : 'bg-ice-200'}`}>
                            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${settings?.whatsapp_toast !== false ? 'left-8' : 'left-1'}`}></div>
                        </div>
                    </div>
                    <h4 className="text-lg font-black text-graphite-900 mb-2">{t('notificationsPage.cards.toastNotification.title')}</h4>
                    <p className="text-sm text-graphite-500 font-medium leading-relaxed">{t('notificationsPage.cards.toastNotification.description')}</p>
                </div>

                {/* Web Push Notification */}
                <div
                    className={`group p-8 rounded-[32px] border-2 transition-all cursor-pointer hover:shadow-xl ${settings?.whatsapp_push ? 'border-indigo-500 bg-indigo-50/50 shadow-indigo-500/10' : 'border-transparent bg-white shadow-float'}`}
                    onClick={async () => {
                        if (!settings?.whatsapp_push) {
                            const granted = await requestPermission();
                            if (granted) updateSettings({ whatsapp_push: true });
                            else showToast('error', t('notificationsPage.toasts.pushDenied'));
                        } else {
                            updateSettings({ whatsapp_push: false });
                        }
                    }}
                >
                    <div className="flex justify-between items-start mb-6">
                        <div className={`p-4 rounded-2xl ${settings?.whatsapp_push ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-ice-50 text-graphite-400'}`}>
                            <Monitor size={32} />
                        </div>
                        <div className={`w-14 h-7 rounded-full relative transition-colors ${settings?.whatsapp_push ? 'bg-indigo-500' : 'bg-ice-200'}`}>
                            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${settings?.whatsapp_push ? 'left-8' : 'left-1'}`}></div>
                        </div>
                    </div>
                    <h4 className="text-lg font-black text-graphite-900 mb-2">{t('notificationsPage.cards.webPush.title')}</h4>
                    <p className="text-sm text-graphite-500 font-medium leading-relaxed">{t('notificationsPage.cards.webPush.description')}</p>
                </div>
            </div>

            {/* Servidor de E-mail (SMTP próprio) */}
            <div className="bg-white p-8 rounded-[32px] shadow-float space-y-6">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-brand-primary/10 rounded-2xl text-brand-primary">
                        <Mail size={24} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-graphite-900 tracking-tight">{t('notificationsPage.smtp.title')}</h3>
                        <p className="text-sm text-graphite-500 font-medium">{t('notificationsPage.smtp.subtitle')}</p>
                    </div>
                </div>

                <form onSubmit={handleSaveSmtp} className="space-y-4 max-w-3xl">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2 space-y-1.5">
                            <label className="text-xs font-bold text-graphite-700">{t('notificationsPage.smtp.hostLabel')}</label>
                            <input
                                type="text"
                                value={smtpHost}
                                onChange={e => setSmtpHost(e.target.value)}
                                placeholder={t('notificationsPage.smtp.hostPlaceholder')}
                                className="w-full bg-ice-50 border-2 border-transparent focus:border-brand-primary shadow-float rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none transition-all"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-graphite-700">{t('notificationsPage.smtp.portLabel')}</label>
                            <input
                                type="number"
                                value={smtpPort}
                                onChange={e => setSmtpPort(Number(e.target.value))}
                                placeholder="465"
                                className="w-full bg-ice-50 border-2 border-transparent focus:border-brand-primary shadow-float rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none transition-all"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-graphite-700">{t('notificationsPage.smtp.userLabel')}</label>
                            <input
                                type="text"
                                value={smtpUser}
                                onChange={e => setSmtpUser(e.target.value)}
                                placeholder={t('notificationsPage.smtp.userPlaceholder')}
                                className="w-full bg-ice-50 border-2 border-transparent focus:border-brand-primary shadow-float rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none transition-all"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-graphite-700">{t('notificationsPage.smtp.passLabel')}</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={smtpPass}
                                    onChange={e => setSmtpPass(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full bg-ice-50 border-2 border-transparent focus:border-brand-primary shadow-float rounded-xl pl-4 pr-10 py-2.5 text-sm font-medium focus:outline-none transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-graphite-400 hover:text-graphite-600 transition-colors border-none bg-transparent cursor-pointer"
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-1.5 max-w-md">
                        <label className="text-xs font-bold text-graphite-700">{t('notificationsPage.smtp.fromLabel')}</label>
                        <input
                            type="email"
                            value={smtpFrom}
                            onChange={e => setSmtpFrom(e.target.value)}
                            placeholder={t('notificationsPage.smtp.fromPlaceholder')}
                            className="w-full bg-ice-50 border-2 border-ice-100 hover:border-ice-200 focus:border-brand-primary rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none transition-all"
                        />
                        <p className="text-[11px] text-graphite-400 font-medium">{t('notificationsPage.smtp.fromHint')}</p>
                    </div>

                    <div className="flex justify-end pt-2">
                        <button
                            type="submit"
                            disabled={savingSmtp}
                            className="bg-brand-primary hover:bg-brand-primary/95 text-white font-bold text-sm px-6 py-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-2 shadow-lg shadow-brand-primary/10 disabled:opacity-50"
                        >
                            {savingSmtp ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            {t('notificationsPage.smtp.saveButton')}
                        </button>
                    </div>
                </form>
            </div>

            {/* Info Banner */}
            <div className="bg-ice-50 p-8 rounded-[32px] shadow-float relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                    <Shield size={80} className="text-brand-primary" />
                </div>
                <div className="relative z-10 flex flex-col gap-4">
                    <h5 className="text-base font-black text-graphite-900 flex items-center gap-2">
                        <Shield size={20} className="text-brand-primary" />
                        {t('notificationsPage.infoBanner.title')}
                    </h5>
                    <p className="text-sm text-graphite-500 leading-relaxed font-medium max-w-2xl">
                        {t('notificationsPage.infoBanner.body.prefix')} <strong>{t('notificationsPage.infoBanner.body.strong1')}</strong> {t('notificationsPage.infoBanner.body.middle')} <strong>{t('notificationsPage.infoBanner.body.strong2')}</strong> {t('notificationsPage.infoBanner.body.suffix')}
                    </p>
                </div>
            </div>
        </div>
    );
};// Trigger IDE diagnostic refresh
