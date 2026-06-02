import { useState, useEffect } from 'react';
import {
    MessageSquare,
    Search,
    Wifi,
    WifiOff,
    RefreshCcw,
    Power,
    Loader2,
    QrCode,
    Link,
    X
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { zapiService } from '../../services/zapiService';
import { useToast } from '../../contexts/ToastContext';

interface WhatsAppInstance {
    tenant_id: string;
    tenant_name: string;
    instance_id: string;
    token: string;
    client_token: string;
    status: 'connected' | 'disconnected' | 'unknown';
    last_ping: string;
    phone?: string;
    marketing_name?: string;
}

export const MasterWhatsApp = () => {
    const { showToast } = useToast();
    const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [refreshing, setRefreshing] = useState<string | null>(null);

    // Modals
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [showQrModal, setShowQrModal] = useState(false);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [selectedInstance, setSelectedInstance] = useState<WhatsAppInstance | null>(null);

    // Link Form
    const [tenantsWithoutZapi, setTenantsWithoutZapi] = useState<any[]>([]);
    const [linkForm, setLinkForm] = useState({
        tenant_id: '',
        instance_id: '',
        token: '',
        client_token: ''
    });

    useEffect(() => {
        fetchInstances();
    }, []);

    const fetchInstances = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('tenants')
                .select('id, name, zapi_instance_id, zapi_token, zapi_client_token')
                .not('zapi_instance_id', 'is', null);

            if (error) throw error;

            const mapped: WhatsAppInstance[] = data.map(t => ({
                tenant_id: t.id,
                tenant_name: t.name,
                instance_id: t.zapi_instance_id,
                token: t.zapi_token,
                client_token: t.zapi_client_token, // Fixed: Added client_token
                status: 'unknown',
                last_ping: new Date().toISOString()
            }));

            setInstances(mapped);
            // Non-blocking status check
            checkAllStatuses(mapped);
        } catch (error) {
            console.error('Error fetching instances:', error);
        } finally {
            setLoading(false);
        }
    };

    const checkAllStatuses = async (currentList: WhatsAppInstance[]) => {
        const updated = [...currentList];
        for (let i = 0; i < updated.length; i++) {
            const inst = updated[i];
            // Skip invalid credentials
            if (!inst.instance_id || !inst.token || !inst.client_token) continue;

            const status = await zapiService.getStatus(inst.instance_id, inst.token, inst.client_token);
            updated[i] = {
                ...inst,
                status: status.connected ? 'connected' : 'disconnected',
                phone: status.phone,
                marketing_name: status.marketing_name,
                last_ping: new Date().toISOString()
            };
            // Update UI progressively
            setInstances([...updated]);
        }
    };

    const handleRefreshStatus = async (instance: WhatsAppInstance) => {
        setRefreshing(instance.instance_id);
        const status = await zapiService.getStatus(instance.instance_id, instance.token, instance.client_token);
        setInstances(prev => prev.map(i =>
            i.instance_id === instance.instance_id
                ? {
                    ...i,
                    status: status.connected ? 'connected' : 'disconnected',
                    phone: status.phone,
                    marketing_name: status.marketing_name,
                    last_ping: new Date().toISOString()
                }
                : i
        ));
        setRefreshing(null);
    };

    const handleRestart = async (instance: WhatsAppInstance) => {
        if (!confirm('Tem certeza que deseja reiniciar esta instância?')) return;
        setRefreshing(instance.instance_id);
        const success = await zapiService.restart(instance.instance_id, instance.token, instance.client_token);
        if (success) {
            showToast('success', 'Comando de reinício enviado com sucesso.');
            // Wait a bit before checking status
            setTimeout(() => handleRefreshStatus(instance), 5000);
        } else {
            showToast('error', 'Erro ao enviar comando de reinício.');
            setRefreshing(null);
        }
    };

    const handleDisconnect = async (instance: WhatsAppInstance) => {
        if (!confirm('Deseja realmente desconectar? O tenant perderá a conexão imediatamente.')) return;
        setRefreshing(instance.instance_id);
        const success = await zapiService.disconnect(instance.instance_id, instance.token, instance.client_token);
        if (success) {
            handleRefreshStatus(instance);
        } else {
            showToast('error', 'Erro ao desconectar.');
            setRefreshing(null);
        }
    };

    const handleConnect = async (instance: WhatsAppInstance) => {
        setRefreshing(instance.instance_id);
        const qr = await zapiService.getQrCode(instance.instance_id, instance.token, instance.client_token);
        setRefreshing(null);

        if (qr) {
            setSelectedInstance(instance);
            setQrCode(qr);
            setShowQrModal(true);
        } else {
            showToast('error', 'Não foi possível gerar o QR Code. Verifique as credenciais.');
        }
    };

    // --- Create/Link Logic ---
    const openLinkModal = async () => {
        setLoading(true);
        // Buscar TODOS os tenants (não só os sem Z-API) para permitir criar e atualizar vínculos.
        // O filtro anterior .is('zapi_instance_id', null) retornava vazio quando todos os tenants
        // já tinham algum valor no campo ou quando RLS bloqueava silenciosamente a query.
        const { data, error } = await supabase
            .from('tenants')
            .select('id, name, zapi_instance_id')
            .order('name', { ascending: true });

        if (error) {
            console.error('Erro ao buscar tenants:', error);
            showToast('error', 'Erro ao carregar tenants: ' + error.message);
            setLoading(false);
            return;
        }

        setTenantsWithoutZapi(data ?? []);
        setLinkForm({ tenant_id: '', instance_id: '', token: '', client_token: '' });
        setShowLinkModal(true);
        setLoading(false);
    };

    const handleSaveLink = async () => {
        if (!linkForm.tenant_id || !linkForm.instance_id || !linkForm.token || !linkForm.client_token) {
            showToast('warning', 'Preencha todos os campos!');
            return;
        }

        const { error } = await supabase
            .from('tenants')
            .update({
                zapi_instance_id: linkForm.instance_id,
                zapi_token: linkForm.token,
                zapi_client_token: linkForm.client_token
            })
            .eq('id', linkForm.tenant_id);

        if (error) {
            showToast('error', 'Erro ao vincular: ' + error.message);
        } else {
            setShowLinkModal(false);
            fetchInstances();
        }
    };


    const filtered = instances.filter(i =>
        i.tenant_name.toLowerCase().includes(search.toLowerCase()) ||
        i.instance_id.includes(search)
    );

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-400 mb-1">Connectivity</p>
                    <h1 className="text-3xl font-black text-white tracking-tight">Gestão de Instâncias Z-API</h1>
                    <p className="text-slate-500 font-medium text-sm mt-1">Monitoramento global de conexões WhatsApp.</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={fetchInstances}
                        className="flex items-center gap-2 bg-[#1A2035] text-slate-300 px-4 py-3 rounded-xl font-bold text-sm hover:text-white hover:bg-[#2D3B55] transition-all border-none cursor-pointer"
                    >
                        <RefreshCcw size={16} className={loading && !refreshing ? 'animate-spin' : ''} />
                        Atualizar Lista
                    </button>
                    <button
                        onClick={openLinkModal}
                        className="flex items-center gap-2 bg-sky-500 text-white px-5 py-3 rounded-xl font-bold text-sm shadow-lg shadow-sky-500/20 hover:bg-sky-600 transition-all border-none cursor-pointer"
                    >
                        <Link size={16} />
                        Vincular Instância
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                <input
                    type="text"
                    placeholder="Buscar por tenant ou instance ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full bg-[#0F1629] border border-[#1E293B] rounded-xl pl-12 pr-4 py-3.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/10 transition-all font-medium"
                />
            </div>

            {/* Instance Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {loading && instances.length === 0 ? (
                    <div className="col-span-full text-center py-12 text-slate-600 flex flex-col items-center gap-3">
                        <Loader2 className="animate-spin text-sky-500" size={32} />
                        <p>Carregando...</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="col-span-full text-center py-12 text-slate-600 border border-dashed border-[#1E293B] rounded-2xl">
                        Nenhuma instância conectada.
                    </div>
                ) : (
                    filtered.map((instance) => {
                        const isRefreshing = refreshing === instance.instance_id;
                        return (
                            <div key={instance.instance_id} className="bg-[#0F1629] border border-[#1E293B] rounded-2xl p-5 hover:border-sky-500/20 transition-all group relative overflow-hidden">
                                {/* Status Indicator Bar */}
                                <div className={`absolute top-0 left-0 right-0 h-1 ${instance.status === 'connected' ? 'bg-emerald-500' :
                                        instance.status === 'disconnected' ? 'bg-rose-500' : 'bg-slate-700'
                                    }`} />

                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-[#1A2035] flex items-center justify-center shrink-0">
                                            <MessageSquare size={20} className="text-sky-400" />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-white text-sm truncate max-w-[150px]">{instance.tenant_name}</h4>
                                            <p className="text-[10px] text-slate-500 font-mono">{instance.instance_id}</p>
                                        </div>
                                    </div>
                                    <div className={`px-2 py-1 rounded-md text-[10px] font-black uppercase flex items-center gap-1.5 ${instance.status === 'connected' ? 'bg-emerald-500/10 text-emerald-400' :
                                            instance.status === 'disconnected' ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-500/10 text-slate-400'
                                        }`}>
                                        {instance.status === 'connected' ? <Wifi size={12} /> : <WifiOff size={12} />}
                                        {instance.status === 'connected' ? 'Online' : instance.status === 'disconnected' ? 'Offline' : '...'}
                                    </div>
                                </div>

                                <div className="space-y-2 mb-6">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-600 font-bold">Marketing Name</span>
                                        <span className="text-slate-400">{instance.marketing_name || '-'}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-600 font-bold">Telefone</span>
                                        <span className="text-slate-400 font-mono">{instance.phone || '-'}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-600 font-bold">Ultimo Ping</span>
                                        <span className="text-slate-400">{new Date(instance.last_ping).toLocaleTimeString()}</span>
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    {instance.status === 'connected' ? (
                                        <>
                                            <button
                                                onClick={() => handleRestart(instance)}
                                                disabled={isRefreshing}
                                                className="flex-1 px-3 py-2 rounded-lg bg-[#1A2035] text-slate-300 text-xs font-bold hover:bg-amber-500/10 hover:text-amber-400 transition-colors border-none cursor-pointer flex items-center justify-center gap-2"
                                            >
                                                <RefreshCcw size={14} className={isRefreshing ? 'animate-spin' : ''} /> Reiniciar
                                            </button>
                                            <button
                                                onClick={() => handleDisconnect(instance)}
                                                disabled={isRefreshing}
                                                className="flex-1 px-3 py-2 rounded-lg bg-[#1A2035] text-slate-300 text-xs font-bold hover:bg-rose-500/10 hover:text-rose-400 transition-colors border-none cursor-pointer flex items-center justify-center gap-2"
                                            >
                                                <Power size={14} /> Desconectar
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => handleConnect(instance)}
                                            disabled={isRefreshing}
                                            className="w-full px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-bold hover:bg-emerald-500/20 transition-colors border-none cursor-pointer flex items-center justify-center gap-2"
                                        >
                                            <QrCode size={14} /> Conectar (QR)
                                        </button>
                                    )}
                                </div>

                            </div>
                        );
                    })
                )}
            </div>

            {/* Link Instance Modal */}
            {showLinkModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-black text-white">Vincular Instância Z-API</h2>
                            <button onClick={() => setShowLinkModal(false)} className="text-slate-400 hover:text-white border-none bg-transparent cursor-pointer"><X size={20} /></button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">Clinic/Tenant</label>
                                <select
                                    value={linkForm.tenant_id}
                                    onChange={e => setLinkForm({ ...linkForm, tenant_id: e.target.value })}
                                    className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500"
                                >
                                    <option value="">Selecione um tenant...</option>
                                    {tenantsWithoutZapi.map(t => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}{t.zapi_instance_id ? ' (atualizar)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">Instance ID</label>
                                <input
                                    type="text"
                                    value={linkForm.instance_id}
                                    onChange={e => setLinkForm({ ...linkForm, instance_id: e.target.value })}
                                    placeholder="Ex: 3B2D..."
                                    className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">Token da Instância</label>
                                <input
                                    type="text"
                                    value={linkForm.token}
                                    onChange={e => setLinkForm({ ...linkForm, token: e.target.value })}
                                    className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 mb-1">Client Token</label>
                                <input
                                    type="text"
                                    value={linkForm.client_token}
                                    onChange={e => setLinkForm({ ...linkForm, client_token: e.target.value })}
                                    className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500"
                                />
                            </div>

                            <button
                                onClick={handleSaveLink}
                                className="w-full bg-sky-500 text-white py-3 rounded-xl font-bold hover:bg-sky-600 transition-colors mt-4 border-none cursor-pointer"
                            >
                                Salvar Vínculo
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* QR Code Modal */}
            {showQrModal && qrCode && selectedInstance && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm p-8 text-center">
                        <h2 className="text-xl font-black text-graphite-900 mb-2">Conectar WhatsApp</h2>
                        <p className="text-sm text-graphite-500 mb-6">Abra o WhatsApp no seu celular e escaneie o código abaixo.</p>

                        <div className="bg-white p-4 rounded-xl border border-slate-200 inline-block mb-6 shadow-inner">
                            {/* Render QR Image from Z-API (Base64) */}
                            <img src={qrCode} alt="QR Code" className="w-64 h-64 object-contain" />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowQrModal(false)}
                                className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition-colors border-none cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    setShowQrModal(false);
                                    handleRefreshStatus(selectedInstance);
                                }}
                                className="flex-1 py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-colors border-none cursor-pointer"
                            >
                                Já Escaneei
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
