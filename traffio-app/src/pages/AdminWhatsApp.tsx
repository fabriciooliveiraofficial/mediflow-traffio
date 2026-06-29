import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    MessageCircle,
    QrCode,
    CheckCircle2,
    Loader2,
    Smartphone,
    Wifi,
    WifiOff,
    Clock,
    ShieldAlert,
    RefreshCw,
    ExternalLink,
    Lock,
    Globe
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { zapiService } from '../services/zapiService';
import { cloudApiService } from '../services/cloudApiService';
import { useToast } from '../contexts/ToastContext';

type ConnectionStatus = 'loading' | 'no_instance' | 'configured' | 'connecting' | 'connected';

/**
 * Tenant-facing WhatsApp connection page.
 * Real Z-API integration.
 */
export const AdminWhatsApp = () => {
    const { t } = useTranslation('tenantAdmin');
    const { tenant, loading: tenantLoading, updateTenant } = useTenant();
    const { showToast } = useToast();
    const [status, setStatus] = useState<ConnectionStatus>('loading');
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
    const [pollingActive, setPollingActive] = useState(false);
    
    // Cloud API Specific
    const [activeProvider, setActiveProvider] = useState<'zapi' | 'cloud_api'>('zapi');
    const [cloudForm, setCloudForm] = useState({
        phone_number_id: '',
        access_token: '',
        business_account_id: ''
    });
    const [testingCloud, setTestingCloud] = useState(false);

    const checkInstanceStatus = useCallback(async () => {
        if (tenantLoading) return;
        
        if (!tenant) {
            setStatus('no_instance');
            return;
        }
        
        setStatus('loading');
        try {
            // Fetch fresh tenant data to guarantee latest Z-API credentials
            const { data, error } = await supabase
                .from('tenants')
                .select('zapi_instance_id, zapi_token, zapi_client_token, whatsapp_status, whatsapp_phone')
                .eq('id', tenant.id)
                .single();

            if (error || !data || !data.zapi_instance_id || !data.zapi_token) {
                console.error('Z-API credentials missing or error:', error);
                setStatus('no_instance');
                return;
            }

            const zapiStatus = await zapiService.getStatus(
                data.zapi_instance_id,
                data.zapi_token,
                data.zapi_client_token
            );

            if (zapiStatus.connected) {
                setStatus('connected');
                setConnectedPhone(zapiStatus.phone || data.whatsapp_phone || null);
                
                if (data.whatsapp_status !== 'CONNECTED') {
                    await updateTenant({ 
                        whatsapp_status: 'CONNECTED',
                        whatsapp_phone: zapiStatus.phone 
                    } as any);
                }
            } else {
                setStatus('configured');
                setConnectedPhone(null);
            }
        } catch (err) {
            console.error('Error checking instance status:', err);
            setStatus('no_instance');
        }
    }, [tenant, tenantLoading, updateTenant]);

    useEffect(() => {
        if (!tenantLoading && tenant) {
            setActiveProvider(tenant.whatsapp_provider || 'zapi');
            setCloudForm({
                phone_number_id: tenant.cloud_api_phone_number_id || '',
                access_token: tenant.cloud_api_access_token || '',
                business_account_id: tenant.cloud_api_business_account_id || ''
            });
            checkInstanceStatus();
        }
    }, [tenantLoading, tenant?.id, checkInstanceStatus]);


    // Connection Polling
    useEffect(() => {
        let intervalId: any;

        if (pollingActive && tenant?.zapi_instance_id && tenant?.zapi_token) {
            intervalId = setInterval(async () => {
                const zapiStatus = await zapiService.getStatus(
                    tenant.zapi_instance_id!,
                    tenant.zapi_token!,
                    tenant.zapi_client_token
                );

                if (zapiStatus.connected) {
                    setPollingActive(false);
                    setQrCode(null);
                    setStatus('connected');
                    setConnectedPhone(zapiStatus.phone || null);
                    showToast('success', t('adminWhatsApp.toasts.connectedSuccess'));
                    
                    await updateTenant({ 
                        whatsapp_status: 'CONNECTED',
                        whatsapp_phone: zapiStatus.phone 
                    } as any);
                }
            }, 5000);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [pollingActive, tenant, updateTenant, showToast]);

    const handleGenerateQrCode = async () => {
        if (!tenant?.zapi_instance_id || !tenant?.zapi_token) {
            showToast('error', t('adminWhatsApp.toasts.credentialsMissing'));
            return;
        }
        
        setStatus('connecting');
        setQrCode(null);

        try {
            const qr = await zapiService.getQrCode(
                tenant.zapi_instance_id,
                tenant.zapi_token,
                tenant.zapi_client_token
            );

            if (qr) {
                setQrCode(qr);
                setPollingActive(true);
            } else {
                showToast('error', t('adminWhatsApp.toasts.qrGenerateError'));
                setStatus('configured');
            }
        } catch (err) {
            showToast('error', t('adminWhatsApp.toasts.connectionError'));
            setStatus('configured');
        }
    };

    const handleDisconnect = async () => {
        if (!tenant?.zapi_instance_id || !tenant?.zapi_token) return;
        if (!confirm(t('adminWhatsApp.disconnectConfirm'))) return;

        setStatus('loading');
        try {
            const success = await zapiService.disconnect(
                tenant.zapi_instance_id,
                tenant.zapi_token,
                tenant.zapi_client_token
            );

            if (success) {
                await updateTenant({ whatsapp_status: 'DISCONNECTED' } as any);
                setStatus('configured');
                setConnectedPhone(null);
                setQrCode(null);
                setPollingActive(false);
                showToast('success', t('adminWhatsApp.toasts.disconnectedSuccess'));
            } else {
                showToast('error', t('adminWhatsApp.toasts.disconnectError'));
                setStatus('connected');
            }
        } catch (err) {
            showToast('error', t('adminWhatsApp.toasts.disconnectProcessError'));
            setStatus('connected');
        }
    };

    const handleSaveCloudSettings = async () => {
        if (!tenant) return;
        setStatus('loading');
        
        try {
            const success = await cloudApiService.saveSettings(tenant.id, {
                whatsapp_provider: 'cloud_api',
                cloud_api_phone_number_id: cloudForm.phone_number_id,
                cloud_api_access_token: cloudForm.access_token,
                cloud_api_business_account_id: cloudForm.business_account_id
            });

            if (success) {
                showToast('success', t('adminWhatsApp.toasts.cloudSettingsSaved'));
                await updateTenant({ 
                    whatsapp_provider: 'cloud_api',
                    cloud_api_phone_number_id: cloudForm.phone_number_id,
                    cloud_api_access_token: cloudForm.access_token,
                    cloud_api_business_account_id: cloudForm.business_account_id
                } as any);
                setStatus('connected');
            } else {
                showToast('error', t('adminWhatsApp.toasts.cloudSettingsSaveError'));
                setStatus('configured');
            }
        } catch (err) {
            showToast('error', t('adminWhatsApp.toasts.cloudRequestError'));
            setStatus('configured');
        }
    };

    const handleTestCloudConnection = async () => {
        if (!cloudForm.phone_number_id || !cloudForm.access_token) {
            showToast('error', t('adminWhatsApp.toasts.cloudFillFieldsError'));
            return;
        }
        
        setTestingCloud(true);
        const result = await cloudApiService.testConnection(cloudForm.phone_number_id, cloudForm.access_token);
        setTestingCloud(false);
        
        if (result.success) {
            showToast('success', result.message);
        } else {
            showToast('error', result.message);
        }
    };

    const statusConfig: Record<ConnectionStatus, { label: string; icon: any; style: string }> = {
        loading: { label: t('adminWhatsApp.statusConfig.loading'), icon: Loader2, style: 'bg-ice-100 text-graphite-500' },
        no_instance: { label: t('adminWhatsApp.statusConfig.noInstance'), icon: Clock, style: 'bg-amber-100 text-amber-700' },
        configured: { label: t('adminWhatsApp.statusConfig.configured'), icon: Wifi, style: 'bg-sky-100 text-sky-700' },
        connecting: { label: t('adminWhatsApp.statusConfig.connecting'), icon: Loader2, style: 'bg-amber-100 text-amber-700' },
        connected: { label: t('adminWhatsApp.statusConfig.connected'), icon: CheckCircle2, style: 'bg-emerald-100 text-emerald-700' },
    };

    const currentStatus = statusConfig[status];
    const StatusIcon = currentStatus.icon;

    if (!tenant && status !== 'loading') {
        return <div className="p-12 text-center text-graphite-400">{t('adminWhatsApp.loadingClinic')}</div>;
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">

            {/* Header */}
            <div className="text-center">
                <h1 className="text-3xl font-black text-graphite-900 tracking-tight flex items-center gap-3 justify-center">
                    <MessageCircle className="text-emerald-500" size={32} />
                    {t('adminWhatsApp.header.title')}
                </h1>
                <p className="text-graphite-500 font-medium mt-1">
                    {t('adminWhatsApp.header.subtitle')}
                </p>
            </div>

            {/* Provider Selector Tabs */}
            <div className="flex justify-center mb-6">
                <div className="bg-white p-1 rounded-2xl shadow-float flex items-center gap-1">
                    <button
                        onClick={() => setActiveProvider('zapi')}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all border-none cursor-pointer ${
                            activeProvider === 'zapi' 
                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' 
                            : 'text-graphite-400 hover:text-graphite-600 bg-transparent'
                        }`}
                    >
                        <Smartphone size={18} />
                        {t('adminWhatsApp.providerTabs.zapi')}
                    </button>
                    <button
                        onClick={() => setActiveProvider('cloud_api')}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all border-none cursor-pointer ${
                            activeProvider === 'cloud_api' 
                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' 
                            : 'text-graphite-400 hover:text-graphite-600 bg-transparent'
                        }`}
                    >
                        <Globe size={18} />
                        {t('adminWhatsApp.providerTabs.cloudApi')}
                    </button>
                </div>
            </div>

            {/* Status Badge */}
            <div className="flex justify-center">
                <div className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold ${currentStatus.style}`}>
                    <StatusIcon size={16} className={status === 'loading' || status === 'connecting' ? 'animate-spin' : ''} />
                    {activeProvider === 'cloud_api' && status === 'connected' ? t('adminWhatsApp.statusConfig.cloudApiActive') : currentStatus.label}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="bg-white rounded-[32px] shadow-float overflow-hidden">
                {activeProvider === 'zapi' ? (
                    /* Existing Z-API Content */
                    <ZapiContent 
                        status={status} 
                        qrCode={qrCode} 
                        pollingActive={pollingActive} 
                        connectedPhone={connectedPhone} 
                        onGenerateQr={handleGenerateQrCode} 
                        onDisconnect={handleDisconnect} 
                        onCheckStatus={checkInstanceStatus} 
                        tenantName={tenant?.name}
                    />
                ) : (
                    /* New Cloud API Content */
                    <div className="p-12 space-y-8">
                        <div className="text-center">
                            <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                                <Globe size={36} className="text-emerald-500" />
                            </div>
                            <h3 className="text-xl font-black text-graphite-900">{t('adminWhatsApp.cloudApi.title')}</h3>
                            <p className="text-sm text-graphite-400 mt-1">{t('adminWhatsApp.cloudApi.subtitle')}</p>
                        </div>

                        <div className="grid gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-graphite-400 uppercase ml-1 flex items-center gap-1.5">
                                    <Smartphone size={12} /> {t('adminWhatsApp.cloudApi.phoneNumberIdLabel')}
                                    <span className="text-rose-500">*</span>
                                </label>
                                <input 
                                    type="text"
                                    value={cloudForm.phone_number_id}
                                    onChange={(e) => setCloudForm({...cloudForm, phone_number_id: e.target.value})}
                                    placeholder="Ex: 105634563456"
                                    className="w-full bg-ice-50 shadow-float rounded-2xl px-5 py-4 text-sm font-bold text-graphite-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-graphite-400 uppercase ml-1 flex items-center gap-1.5">
                                    <Lock size={12} /> {t('adminWhatsApp.cloudApi.accessTokenLabel')}
                                    <span className="text-rose-500">*</span>
                                </label>
                                <input 
                                    type="password"
                                    value={cloudForm.access_token}
                                    onChange={(e) => setCloudForm({...cloudForm, access_token: e.target.value})}
                                    placeholder="Ex: EAAL..."
                                    className="w-full bg-ice-50 shadow-float rounded-2xl px-5 py-4 text-sm font-bold text-graphite-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-graphite-400 uppercase ml-1 flex items-center gap-1.5">
                                    <Globe size={12} /> {t('adminWhatsApp.cloudApi.businessAccountIdLabel')}
                                </label>
                                <input 
                                    type="text"
                                    value={cloudForm.business_account_id}
                                    onChange={(e) => setCloudForm({...cloudForm, business_account_id: e.target.value})}
                                    placeholder="Ex: 10234567890"
                                    className="w-full bg-ice-50 shadow-float rounded-2xl px-5 py-4 text-sm font-bold text-graphite-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="bg-ice-50 rounded-2xl p-4 flex items-start gap-4 text-left">
                            <ShieldAlert className="text-amber-500 shrink-0 mt-0.5" size={20} />
                            <div>
                                <p className="text-xs font-bold text-graphite-700">{t('adminWhatsApp.cloudApi.techConfigTitle')}</p>
                                <p className="text-[11px] text-graphite-400 leading-relaxed mt-1">
                                    {t('adminWhatsApp.cloudApi.techConfigBody')}
                                    <a href="https://developers.facebook.com" target="_blank" className="ml-1 text-emerald-500 font-bold hover:underline inline-flex items-center gap-0.5">
                                        {t('adminWhatsApp.cloudApi.metaDevelopersLink')} <ExternalLink size={10} />
                                    </a>
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 pt-4">
                            <button
                                onClick={handleSaveCloudSettings}
                                disabled={status === 'loading'}
                                className="w-full bg-emerald-500 text-white rounded-2xl py-4 font-black flex items-center justify-center gap-2 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 border-none cursor-pointer"
                            >
                                {status === 'loading' ? <Loader2 size={20} className="animate-spin" /> : t('adminWhatsApp.cloudApi.activateButton')}
                            </button>

                            <button
                                onClick={handleTestCloudConnection}
                                disabled={testingCloud}
                                className="w-full bg-transparent text-graphite-400 rounded-2xl py-2 font-bold text-xs flex items-center justify-center gap-2 hover:text-emerald-500 transition-all border-none cursor-pointer"
                            >
                                {testingCloud ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                {t('adminWhatsApp.cloudApi.testConnectionButton')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Sub-component for Z-API content to keep the main component clean
 */
const ZapiContent = ({ status, qrCode, pollingActive, connectedPhone, onGenerateQr, onDisconnect, onCheckStatus, tenantName }: any) => {
    const { t } = useTranslation('tenantAdmin');
    return (
    <>
        {/* === STATE: Loading === */}
        {status === 'loading' && (
            <div className="p-12 text-center space-y-4">
                <Loader2 size={48} className="text-brand-primary animate-spin mx-auto" />
                <p className="text-sm text-graphite-400">{t('adminWhatsApp.zapiContent.syncingMessage')}</p>
            </div>
        )}

        {/* === STATE: No Instance === */}
        {status === 'no_instance' && (
            <div className="p-12 text-center space-y-6">
                <div className="w-24 h-24 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
                    <ShieldAlert size={40} className="text-amber-400" />
                </div>
                <div>
                    <h3 className="text-xl font-black text-graphite-900">{t('adminWhatsApp.zapiContent.noInstance.title')}</h3>
                    <p className="text-sm text-graphite-400 mt-2 max-w-sm mx-auto">
                        {t('adminWhatsApp.zapiContent.noInstance.description')}
                    </p>
                </div>
                <div className="bg-ice-50 rounded-2xl p-4 max-w-xs mx-auto">
                    <div className="flex items-start gap-3 text-left">
                        <Clock size={16} className="text-graphite-400 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-xs font-bold text-graphite-600">{t('adminWhatsApp.zapiContent.noInstance.nextStepTitle')}</p>
                            <p className="text-xs text-graphite-400">{t('adminWhatsApp.zapiContent.noInstance.nextStepDescription')}</p>
                        </div>
                    </div>
                </div>
                <button
                    onClick={onCheckStatus}
                    className="flex items-center gap-2 text-sm font-bold text-brand-primary hover:text-brand-primary/80 transition-colors bg-transparent border-none cursor-pointer mx-auto"
                >
                    <RefreshCw size={14} />
                    {t('adminWhatsApp.zapiContent.noInstance.checkAgainButton')}
                </button>
            </div>
        )}

        {/* === STATE: Configured === */}
        {status === 'configured' && !qrCode && (
            <div className="p-12 text-center space-y-8">
                <div className="w-24 h-24 rounded-full bg-sky-50 flex items-center justify-center mx-auto">
                    <QrCode size={40} className="text-sky-500" />
                </div>
                <div>
                    <h3 className="text-xl font-black text-graphite-900">{t('adminWhatsApp.zapiContent.configured.title')}</h3>
                    <p className="text-sm text-graphite-400 mt-2 max-w-sm mx-auto">
                        {t('adminWhatsApp.zapiContent.configured.description')}
                    </p>
                </div>

                <div className="bg-ice-50 rounded-2xl p-6 max-w-sm mx-auto space-y-4 text-left">
                    {[
                        { step: 1, text: t('adminWhatsApp.zapiContent.configured.step1') },
                        { step: 2, text: t('adminWhatsApp.zapiContent.configured.step2') },
                        { step: 3, text: t('adminWhatsApp.zapiContent.configured.step3') },
                        { step: 4, text: t('adminWhatsApp.zapiContent.configured.step4') }
                    ].map((s) => (
                        <div key={s.step} className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-brand-primary text-white text-xs font-black flex items-center justify-center shrink-0">
                                {s.step}
                            </div>
                            <p className="text-sm text-graphite-600">{s.text}</p>
                        </div>
                    ))}
                </div>

                <button
                    onClick={onGenerateQr}
                    className="flex items-center gap-3 bg-emerald-500 text-white px-8 py-4 rounded-2xl font-bold text-lg shadow-lg shadow-emerald-500/20 hover:scale-105 hover:bg-emerald-600 transition-all border-none cursor-pointer mx-auto"
                >
                    <QrCode size={24} />
                    {t('adminWhatsApp.zapiContent.configured.generateQrButton')}
                </button>
            </div>
        )}

        {/* === STATE: Connecting === */}
        {(status === 'connecting' || qrCode) && (
            <div className="p-12 text-center space-y-8">
                <div>
                    <h3 className="text-xl font-black text-graphite-900">{t('adminWhatsApp.zapiContent.connecting.title')}</h3>
                    <p className="text-sm text-graphite-400 mt-1">{t('adminWhatsApp.zapiContent.connecting.description')}</p>
                </div>

                <div className="bg-ice-50 border-2 border-dashed border-ice-200 rounded-3xl p-8 inline-flex flex-col items-center gap-4 mx-auto">
                    {qrCode ? (
                        <div className="bg-white p-4 rounded-2xl shadow-float animate-in zoom-in duration-300">
                            <img src={qrCode} alt="WhatsApp QR" className="w-52 h-52" />
                        </div>
                    ) : (
                        <Loader2 size={48} className="text-brand-primary animate-spin" />
                    )}
                    <p className="text-xs text-graphite-400 italic">
                        {pollingActive ? t('adminWhatsApp.zapiContent.connecting.waitingScan') : t('adminWhatsApp.zapiContent.connecting.generatingCode')}
                    </p>
                </div>

                <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-3 justify-center">
                        <Smartphone size={16} className="text-graphite-400" />
                        <p className="text-sm text-graphite-400 font-medium italic">{t('adminWhatsApp.zapiContent.connecting.connectedDevicesHint')}</p>
                    </div>
                </div>
            </div>
        )}

        {/* === STATE: Connected === */}
        {status === 'connected' && (
            <div className="p-12 text-center space-y-8">
                <div className="w-24 h-24 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
                    <CheckCircle2 size={48} className="text-emerald-500" />
                </div>
                <div>
                    <h3 className="text-xl font-black text-emerald-700">{t('adminWhatsApp.zapiContent.connected.title')}</h3>
                    <p className="text-sm text-graphite-400 mt-2">{t('adminWhatsApp.zapiContent.connected.description')}</p>
                </div>

                <div className="bg-ice-50 rounded-2xl p-6 max-w-sm mx-auto space-y-3 shadow-inner text-left">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-graphite-400 uppercase">{t('adminWhatsApp.zapiContent.connected.statusLabel')}</span>
                        <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> {t('adminWhatsApp.zapiContent.connected.online')}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-graphite-400 uppercase">{t('adminWhatsApp.zapiContent.connected.numberLabel')}</span>
                        <span className="text-xs font-mono text-graphite-600 font-bold">{connectedPhone || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-graphite-400 uppercase">{t('adminWhatsApp.zapiContent.connected.clinicLabel')}</span>
                        <span className="text-xs font-bold text-graphite-600">{tenantName}</span>
                    </div>
                </div>

                <button
                    onClick={onDisconnect}
                    className="flex items-center gap-2 bg-rose-50 text-rose-500 px-6 py-3 rounded-xl font-bold hover:bg-rose-100 transition-colors border-none cursor-pointer mx-auto"
                >
                    <WifiOff size={16} />
                    {t('adminWhatsApp.zapiContent.connected.disconnectButton')}
                </button>
            </div>
        )}
    </>
    );
};
