import { useState, useEffect, useCallback } from 'react';
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

            if (error || !data || !data.zapi_instance_id || !data.zapi_token || !data.zapi_client_token) {
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

        if (pollingActive && tenant?.zapi_instance_id && tenant?.zapi_token && tenant?.zapi_client_token) {
            intervalId = setInterval(async () => {
                const zapiStatus = await zapiService.getStatus(
                    tenant.zapi_instance_id!,
                    tenant.zapi_token!,
                    tenant.zapi_client_token!
                );

                if (zapiStatus.connected) {
                    setPollingActive(false);
                    setQrCode(null);
                    setStatus('connected');
                    setConnectedPhone(zapiStatus.phone || null);
                    showToast('success', 'WhatsApp conectado com sucesso!');
                    
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
        if (!tenant?.zapi_instance_id || !tenant?.zapi_token || !tenant?.zapi_client_token) {
            showToast('error', 'Credenciais Z-API não configuradas para esta clínica.');
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
                showToast('error', 'Erro ao gerar QR Code. Verifique o status da instância no painel Master.');
                setStatus('configured');
            }
        } catch (err) {
            showToast('error', 'Erro de conexão com o servidor de WhatsApp.');
            setStatus('configured');
        }
    };

    const handleDisconnect = async () => {
        if (!tenant?.zapi_instance_id || !tenant?.zapi_token || !tenant?.zapi_client_token) return;
        if (!confirm('Deseja realmente desconectar o WhatsApp da clínica?')) return;

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
                showToast('success', 'WhatsApp desconectado.');
            } else {
                showToast('error', 'Erro ao desconectar. Tente novamente ou use o painel Master.');
                setStatus('connected');
            }
        } catch (err) {
            showToast('error', 'Erro ao processar desconexão.');
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
                showToast('success', 'Configurações do Cloud API salvas!');
                await updateTenant({ 
                    whatsapp_provider: 'cloud_api',
                    cloud_api_phone_number_id: cloudForm.phone_number_id,
                    cloud_api_access_token: cloudForm.access_token,
                    cloud_api_business_account_id: cloudForm.business_account_id
                } as any);
                setStatus('connected');
            } else {
                showToast('error', 'Erro ao salvar configurações.');
                setStatus('configured');
            }
        } catch (err) {
            showToast('error', 'Falha ao processar requisição.');
            setStatus('configured');
        }
    };

    const handleTestCloudConnection = async () => {
        if (!cloudForm.phone_number_id || !cloudForm.access_token) {
            showToast('error', 'Preencha o ID e o Token para testar.');
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
        loading: { label: 'Verificando...', icon: Loader2, style: 'bg-ice-100 text-graphite-500' },
        no_instance: { label: 'Aguardando Configuração', icon: Clock, style: 'bg-amber-100 text-amber-700' },
        configured: { label: 'Pronto para Conectar', icon: Wifi, style: 'bg-sky-100 text-sky-700' },
        connecting: { label: 'Aguardando Leitura do QR...', icon: Loader2, style: 'bg-amber-100 text-amber-700' },
        connected: { label: 'WhatsApp Conectado', icon: CheckCircle2, style: 'bg-emerald-100 text-emerald-700' },
    };

    const currentStatus = statusConfig[status];
    const StatusIcon = currentStatus.icon;

    if (!tenant && status !== 'loading') {
        return <div className="p-12 text-center text-graphite-400">Carregando dados da clínica...</div>;
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">

            {/* Header */}
            <div className="text-center">
                <h1 className="text-3xl font-black text-graphite-900 tracking-tight flex items-center gap-3 justify-center">
                    <MessageCircle className="text-emerald-500" size={32} />
                    WhatsApp
                </h1>
                <p className="text-graphite-500 font-medium mt-1">
                    Conecte o WhatsApp da sua clínica para ativar o agente de IA.
                </p>
            </div>

            {/* Provider Selector Tabs */}
            <div className="flex justify-center mb-6">
                <div className="bg-white p-1 rounded-2xl border border-ice-200 shadow-sm flex items-center gap-1">
                    <button
                        onClick={() => setActiveProvider('zapi')}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all border-none cursor-pointer ${
                            activeProvider === 'zapi' 
                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' 
                            : 'text-graphite-400 hover:text-graphite-600 bg-transparent'
                        }`}
                    >
                        <Smartphone size={18} />
                        WhatsApp Web (Z-API)
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
                        Oficial (Cloud API)
                    </button>
                </div>
            </div>

            {/* Status Badge */}
            <div className="flex justify-center">
                <div className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold ${currentStatus.style}`}>
                    <StatusIcon size={16} className={status === 'loading' || status === 'connecting' ? 'animate-spin' : ''} />
                    {activeProvider === 'cloud_api' && status === 'connected' ? 'Cloud API Ativo' : currentStatus.label}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="bg-white rounded-[32px] border border-ice-200 shadow-sm overflow-hidden">
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
                            <h3 className="text-xl font-black text-graphite-900">WhatsApp Cloud API</h3>
                            <p className="text-sm text-graphite-400 mt-1">Conexão oficial e de alta performance via Meta.</p>
                        </div>

                        <div className="grid gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-graphite-400 uppercase ml-1 flex items-center gap-1.5">
                                    <Smartphone size={12} /> Phone Number ID
                                    <span className="text-rose-500">*</span>
                                </label>
                                <input 
                                    type="text"
                                    value={cloudForm.phone_number_id}
                                    onChange={(e) => setCloudForm({...cloudForm, phone_number_id: e.target.value})}
                                    placeholder="Ex: 105634563456"
                                    className="w-full bg-ice-50 border-none rounded-2xl px-5 py-4 text-sm font-bold text-graphite-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-graphite-400 uppercase ml-1 flex items-center gap-1.5">
                                    <Lock size={12} /> Access Token (System User)
                                    <span className="text-rose-500">*</span>
                                </label>
                                <input 
                                    type="password"
                                    value={cloudForm.access_token}
                                    onChange={(e) => setCloudForm({...cloudForm, access_token: e.target.value})}
                                    placeholder="Ex: EAAL..."
                                    className="w-full bg-ice-50 border-none rounded-2xl px-5 py-4 text-sm font-bold text-graphite-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-graphite-400 uppercase ml-1 flex items-center gap-1.5">
                                    <Globe size={12} /> Business Account ID
                                </label>
                                <input 
                                    type="text"
                                    value={cloudForm.business_account_id}
                                    onChange={(e) => setCloudForm({...cloudForm, business_account_id: e.target.value})}
                                    placeholder="Ex: 10234567890"
                                    className="w-full bg-ice-50 border-none rounded-2xl px-5 py-4 text-sm font-bold text-graphite-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="bg-ice-50 rounded-2xl p-4 flex items-start gap-4 text-left">
                            <ShieldAlert className="text-amber-500 shrink-0 mt-0.5" size={20} />
                            <div>
                                <p className="text-xs font-bold text-graphite-700">Configuração Técnica</p>
                                <p className="text-[11px] text-graphite-400 leading-relaxed mt-1">
                                    Para usar a API Oficial, sua conta no Meta Business Suite deve estar verificada. 
                                    <a href="https://developers.facebook.com" target="_blank" className="ml-1 text-emerald-500 font-bold hover:underline inline-flex items-center gap-0.5">
                                        Meta Developers <ExternalLink size={10} />
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
                                {status === 'loading' ? <Loader2 size={20} className="animate-spin" /> : 'Ativar Cloud API'}
                            </button>
                            
                            <button
                                onClick={handleTestCloudConnection}
                                disabled={testingCloud}
                                className="w-full bg-transparent text-graphite-400 rounded-2xl py-2 font-bold text-xs flex items-center justify-center gap-2 hover:text-emerald-500 transition-all border-none cursor-pointer"
                            >
                                {testingCloud ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                Testar conexão
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
const ZapiContent = ({ status, qrCode, pollingActive, connectedPhone, onGenerateQr, onDisconnect, onCheckStatus, tenantName }: any) => (
    <>
        {/* === STATE: Loading === */}
        {status === 'loading' && (
            <div className="p-12 text-center space-y-4">
                <Loader2 size={48} className="text-brand-primary animate-spin mx-auto" />
                <p className="text-sm text-graphite-400">Sincronizando com WhatsApp em tempo real...</p>
            </div>
        )}

        {/* === STATE: No Instance === */}
        {status === 'no_instance' && (
            <div className="p-12 text-center space-y-6">
                <div className="w-24 h-24 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
                    <ShieldAlert size={40} className="text-amber-400" />
                </div>
                <div>
                    <h3 className="text-xl font-black text-graphite-900">Em preparação</h3>
                    <p className="text-sm text-graphite-400 mt-2 max-w-sm mx-auto">
                        A equipe de suporte do Traffio está configurando sua instância técnica.
                    </p>
                </div>
                <div className="bg-ice-50 rounded-2xl p-4 max-w-xs mx-auto">
                    <div className="flex items-start gap-3 text-left">
                        <Clock size={16} className="text-graphite-400 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-xs font-bold text-graphite-600">Próximo passo</p>
                            <p className="text-xs text-graphite-400">Você será avisado quando puder gerar o QR Code.</p>
                        </div>
                    </div>
                </div>
                <button
                    onClick={onCheckStatus}
                    className="flex items-center gap-2 text-sm font-bold text-brand-primary hover:text-brand-primary/80 transition-colors bg-transparent border-none cursor-pointer mx-auto"
                >
                    <RefreshCw size={14} />
                    Verificar novamente
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
                    <h3 className="text-xl font-black text-graphite-900">Tudo pronto!</h3>
                    <p className="text-sm text-graphite-400 mt-2 max-w-sm mx-auto">
                        Clique no botão para gerar o QR Code e conectar o número da clínica.
                    </p>
                </div>

                <div className="bg-ice-50 rounded-2xl p-6 max-w-sm mx-auto space-y-4 text-left">
                    {[
                        { step: 1, text: 'Clique em "Gerar QR Code"' },
                        { step: 2, text: 'Abra o WhatsApp no celular da clínica' },
                        { step: 3, text: 'Vá em Ver Aparelhos → Conectar Aparelho' },
                        { step: 4, text: 'Escaneie o código que aparecerá na tela' }
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
                    Gerar QR Code
                </button>
            </div>
        )}

        {/* === STATE: Connecting === */}
        {(status === 'connecting' || qrCode) && (
            <div className="p-12 text-center space-y-8">
                <div>
                    <h3 className="text-xl font-black text-graphite-900">Escaneie o QR Code</h3>
                    <p className="text-sm text-graphite-400 mt-1">A conexão será reconhecida automaticamente.</p>
                </div>

                <div className="bg-ice-50 border-2 border-dashed border-ice-200 rounded-3xl p-8 inline-flex flex-col items-center gap-4 mx-auto">
                    {qrCode ? (
                        <div className="bg-white p-4 rounded-2xl shadow-md animate-in zoom-in duration-300">
                            <img src={qrCode} alt="WhatsApp QR" className="w-52 h-52" />
                        </div>
                    ) : (
                        <Loader2 size={48} className="text-brand-primary animate-spin" />
                    )}
                    <p className="text-xs text-graphite-400 italic">
                        {pollingActive ? 'Aguardando leitura do celular...' : 'Gerando código...'}
                    </p>
                </div>

                <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-3 justify-center">
                        <Smartphone size={16} className="text-graphite-400" />
                        <p className="text-sm text-graphite-400 font-medium italic">Vá em Aparelhos Conectados no seu WhatsApp</p>
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
                    <h3 className="text-xl font-black text-emerald-700">WhatsApp Ativo!</h3>
                    <p className="text-sm text-graphite-400 mt-2">O agente de IA está pronto para responder seus pacientes.</p>
                </div>

                <div className="bg-ice-50 rounded-2xl p-6 max-w-sm mx-auto space-y-3 shadow-inner text-left">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-graphite-400 uppercase">Status</span>
                        <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Online
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-graphite-400 uppercase">Número</span>
                        <span className="text-xs font-mono text-graphite-600 font-bold">{connectedPhone || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-graphite-400 uppercase">Clínica</span>
                        <span className="text-xs font-bold text-graphite-600">{tenantName}</span>
                    </div>
                </div>

                <button
                    onClick={onDisconnect}
                    className="flex items-center gap-2 bg-rose-50 text-rose-500 px-6 py-3 rounded-xl font-bold hover:bg-rose-100 transition-colors border-none cursor-pointer mx-auto"
                >
                    <WifiOff size={16} />
                    Desconectar WhatsApp
                </button>
            </div>
        )}
    </>
);
