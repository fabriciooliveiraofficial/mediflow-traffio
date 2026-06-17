import React, { useState, useEffect } from 'react';
import {
    Building2,
    Search,
    Plus,
    MoreHorizontal,
    CheckCircle2,
    XCircle,
    MapPin,
    Calendar,
    Trash2,
    Eye,
    Power,
    MessageCircle,
    Loader2,
    Save,
    X,
    Sliders
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { MasterTenantWidgetConfig } from '../../components/master/MasterTenantWidgetConfig';

interface Tenant {
    id: string;
    name: string;
    slug?: string;
    address?: string;
    created_at?: string;
    whatsapp_status?: string;
    zapi_instance_id?: string;
    owner_email?: string;
    // Telnyx (gerenciado pela Traffio, invisível ao tenant)
    telnyx_enabled?: boolean;
    telnyx_api_key?: string;
    telnyx_app_id?: string;
    sms_enabled?: boolean;
}

export const MasterTenants = () => {
    const { showToast } = useToast();
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    
    // Tab State for each Tenant
    const [tenantTabs, setTenantTabs] = useState<Record<string, 'general' | 'widget'>>({});
    const getTenantTab = (id: string) => tenantTabs[id] || 'general';
    const setTenantTab = (id: string, tab: 'general' | 'widget') => setTenantTabs(prev => ({ ...prev, [id]: tab }));

    // Create Form State
    const [newTenant, setNewTenant] = useState({ name: '', slug: '', address: '', adminEmail: '' });
    const [creating, setCreating] = useState(false);

    useEffect(() => { fetchTenants(); }, []);

    const fetchTenants = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase.from('tenants').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            setTenants(data || []);
        } catch (err) {
            console.error('Error:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);
        try {
            // 1. Create Tenant
            const { data: tenantData, error: tenantError } = await supabase
                .from('tenants')
                .insert({
                    name: newTenant.name,
                    slug: newTenant.slug || newTenant.name.toLowerCase().replace(/\s+/g, '-'),
                    address: newTenant.address
                })
                .select()
                .single();

            if (tenantError) throw tenantError;

            // 2. Invite/Create Admin User is complex without Service Role in client.
            // Ideally we call an Edge Function here.
            // For now, we will just notify the Super Admin to invite the user manually or use the Invite Link.
            showToast('success', `Tenant ${tenantData.name} criado! ID: ${tenantData.id}. Agora convide o admin (${newTenant.adminEmail}).`);

            setShowCreateModal(false);
            setNewTenant({ name: '', slug: '', address: '', adminEmail: '' });
            fetchTenants();

        } catch (error: any) {
            showToast('error', 'Erro ao criar tenant: ' + error.message);
        } finally {
            setCreating(false);
        }
    };

    const filtered = tenants.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.address?.toLowerCase().includes(search.toLowerCase()) ||
        t.id.includes(search)
    );

    const getStatusBadge = (t: Tenant) => {
        if (t.zapi_instance_id) return { label: 'WhatsApp Ativo', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
        return { label: 'Pendente', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto">

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 mb-1">SaaS Management</p>
                    <h1 className="text-3xl font-black text-white tracking-tight">Gestão de Tenants</h1>
                    <p className="text-slate-500 font-medium text-sm mt-1">{tenants.length} clínicas cadastradas na plataforma.</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 bg-emerald-500 text-white px-5 py-3 rounded-xl font-bold text-sm shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all border-none cursor-pointer"
                >
                    <Plus size={16} />
                    Novo Tenant
                </button>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                <input
                    type="text"
                    placeholder="Buscar por nome, endereço ou ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full bg-[#0F1629] border border-[#1E293B] rounded-xl pl-12 pr-4 py-3.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 transition-all font-medium"
                />
            </div>

            {/* Tenant Cards */}
            <div className="grid grid-cols-1 gap-3">
                {loading ? (
                    <div className="text-center py-12 text-slate-600 flex flex-col items-center gap-3">
                        <Loader2 className="animate-spin text-emerald-500" size={32} />
                        <p>Carregando tenants...</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-12 text-slate-600 border border-dashed border-[#1E293B] rounded-2xl">
                        Nenhum tenant encontrado.
                    </div>
                ) : (
                    filtered.map((tenant) => {
                        const status = getStatusBadge(tenant);
                        const isExpanded = expandedId === tenant.id;
                        return (
                            <div
                                key={tenant.id}
                                className={`bg-[#0F1629] border rounded-2xl transition-all duration-300 overflow-hidden ${isExpanded ? 'border-emerald-500/30 ring-1 ring-emerald-500/10' : 'border-[#1E293B] hover:border-emerald-500/20'}`}
                            >
                                {/* Main Row */}
                                <div
                                    className="flex items-center gap-4 p-5 cursor-pointer"
                                    onClick={() => setExpandedId(isExpanded ? null : tenant.id)}
                                >
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${isExpanded ? 'bg-emerald-500 text-white' : 'bg-[#1A2035] text-slate-500'}`}>
                                        <Building2 size={20} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3">
                                            <h4 className={`font-bold text-sm truncate ${isExpanded ? 'text-emerald-400' : 'text-white'}`}>{tenant.name}</h4>
                                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md border ${status.color}`}>
                                                {status.label}
                                            </span>
                                        </div>
                                        {tenant.address && (
                                            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1 truncate">
                                                <MapPin size={10} /> {tenant.address}
                                            </p>
                                        )}
                                    </div>
                                    <div className="hidden md:flex items-center gap-2 text-xs text-slate-600 shrink-0">
                                        <Calendar size={12} />
                                        {tenant.created_at ? new Date(tenant.created_at).toLocaleDateString('pt-BR') : '—'}
                                    </div>
                                    <div className={`transition-transform duration-300 ${isExpanded ? 'rotate-180 text-emerald-500' : 'text-slate-600'}`}>
                                        <MoreHorizontal size={18} />
                                    </div>
                                </div>

                                {/* Expanded Panel */}
                                {isExpanded && (
                                    <div className="border-t border-[#1E293B] px-5 py-4 bg-[#0D1322] space-y-5 animate-in slide-in-from-top-2 duration-300">
                                        {/* Tabs Header */}
                                        <div className="flex border-b border-[#1E293B] gap-6 pb-2">
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); setTenantTab(tenant.id, 'general'); }}
                                                className={`pb-2 text-xs font-black uppercase tracking-wider border-b-2 transition-colors cursor-pointer bg-transparent border-none ${
                                                    getTenantTab(tenant.id) === 'general'
                                                        ? 'border-emerald-500 text-emerald-400'
                                                        : 'border-transparent text-slate-500 hover:text-slate-300'
                                                }`}
                                            >
                                                Informações Gerais
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); setTenantTab(tenant.id, 'widget'); }}
                                                className={`pb-2 text-xs font-black uppercase tracking-wider border-b-2 transition-colors cursor-pointer bg-transparent border-none ${
                                                    getTenantTab(tenant.id) === 'widget'
                                                        ? 'border-emerald-500 text-emerald-400'
                                                        : 'border-transparent text-slate-500 hover:text-slate-300'
                                                }`}
                                            >
                                                Widget de Agendamento
                                            </button>
                                        </div>

                                        {getTenantTab(tenant.id) === 'general' ? (
                                            <>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">Tenant ID</p>
                                                        <div className="flex items-center gap-2 group cursor-copy" onClick={() => navigator.clipboard.writeText(tenant.id)}>
                                                            <p className="text-xs font-mono text-slate-400 truncate group-hover:text-white transition-colors">{tenant.id}</p>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">WhatsApp Status</p>
                                                        <p className="text-xs text-slate-400 flex items-center gap-1.5">
                                                            {tenant.zapi_instance_id ? (
                                                                <><CheckCircle2 size={12} className="text-emerald-400" /> <span className="text-emerald-400 font-bold">Conectado</span></>
                                                            ) : (
                                                                <><XCircle size={12} className="text-amber-400" /> <span className="text-amber-400 font-bold">Desconectado</span></>
                                                            )}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">Plano Atual</p>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></div>
                                                            <p className="text-xs text-sky-400 font-bold">Professional</p>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">Usuários</p>
                                                        <p className="text-xs text-slate-400">Total: 3 (1 Admin)</p>
                                                    </div>
                                                </div>

                                                {/* Telnyx — visível apenas para super-admin da Traffio */}
                                                <div className="pt-4 border-t border-[#1E293B] space-y-3">
                                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                                                        Comunicações (Telnyx) — apenas Traffio Admin
                                                    </p>
                                                    <div className="grid grid-cols-3 gap-3">
                                                        <div>
                                                            <p className="text-[10px] text-slate-500 mb-1">Softphone</p>
                                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tenant.telnyx_enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                                                                {tenant.telnyx_enabled ? 'Ativo' : 'Inativo'}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <p className="text-[10px] text-slate-500 mb-1">API Key própria</p>
                                                            <span className="text-xs text-slate-400">{tenant.telnyx_api_key ? '●●●●●●●' : 'Usa master key'}</span>
                                                        </div>
                                                        <div>
                                                            <p className="text-[10px] text-slate-500 mb-1">Connection ID próprio</p>
                                                            <span className="text-xs text-slate-400">{tenant.telnyx_app_id ?? 'Usa master'}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap gap-2 pt-4 border-t border-[#1E293B]">
                                                    <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-slate-300 bg-[#1E293B] hover:text-white hover:bg-[#2D3B55] transition-all border-none cursor-pointer">
                                                        <Eye size={14} /> Ver Dashboard
                                                    </button>
                                                    <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-sky-400 bg-sky-500/5 hover:bg-sky-500/10 transition-all border border-sky-500/20 cursor-pointer">
                                                        <MessageCircle size={14} /> Configurar Z-API
                                                    </button>

                                                    <div className="flex-1" />

                                                    <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-amber-400 hover:bg-amber-500/10 transition-all border border-transparent hover:border-amber-500/20 bg-transparent cursor-pointer">
                                                        <Power size={14} /> Suspender
                                                    </button>
                                                    <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-rose-400 hover:bg-rose-500/10 transition-all border border-transparent hover:border-rose-500/20 bg-transparent cursor-pointer">
                                                        <Trash2 size={14} /> Deletar
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <MasterTenantWidgetConfig tenantId={tenant.id} tenantName={tenant.name} />
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[#0F1629] border border-[#1E293B] rounded-2xl w-full max-w-lg p-6 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-black text-white">Novo Tenant</h3>
                            <button onClick={() => setShowCreateModal(false)} className="text-slate-500 hover:text-white transition-colors bg-transparent border-none cursor-pointer">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateTenant} className="space-y-4">
                            <div>
                                <label className="text-xs font-black text-slate-400 uppercase mb-1 block">Nome da Clínica</label>
                                <input
                                    type="text"
                                    required
                                    value={newTenant.name}
                                    onChange={e => setNewTenant({ ...newTenant, name: e.target.value })}
                                    className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white focus:border-emerald-500 focus:outline-none transition-colors"
                                    placeholder="Ex: Clínica Saúde Total"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-black text-slate-400 uppercase mb-1 block">Slug (URL)</label>
                                    <input
                                        type="text"
                                        value={newTenant.slug}
                                        onChange={e => setNewTenant({ ...newTenant, slug: e.target.value })}
                                        className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white focus:border-emerald-500 focus:outline-none transition-colors"
                                        placeholder="clinica-saude"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-black text-slate-400 uppercase mb-1 block">Email Admin</label>
                                    <input
                                        type="email"
                                        required
                                        value={newTenant.adminEmail}
                                        onChange={e => setNewTenant({ ...newTenant, adminEmail: e.target.value })}
                                        className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white focus:border-emerald-500 focus:outline-none transition-colors"
                                        placeholder="admin@clinica.com"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-black text-slate-400 uppercase mb-1 block">Endereço</label>
                                <input
                                    type="text"
                                    value={newTenant.address}
                                    onChange={e => setNewTenant({ ...newTenant, address: e.target.value })}
                                    className="w-full bg-[#1A2035] border border-[#2D3B55] rounded-xl px-4 py-3 text-white focus:border-emerald-500 focus:outline-none transition-colors"
                                    placeholder="Rua das Flores, 123"
                                />
                            </div>

                            <div className="flex justify-end pt-4 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-4 py-3 rounded-xl font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all border-none bg-transparent cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={creating}
                                    className="flex items-center gap-2 bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-600 transition-all border-none cursor-pointer disabled:opacity-50"
                                >
                                    {creating ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                    Criar Tenant
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    );
};
