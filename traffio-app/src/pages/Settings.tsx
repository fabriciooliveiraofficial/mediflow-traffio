import { useState, useEffect, useCallback } from 'react';
import {
    Building2,
    X,
    MapPin,
    User,
    Plus,
    Navigation,
    Palette,
    Key,
    Trash2,
    Check,
    MapPinHouse,
    Edit3,
    Shield,
    Clock,
    Users,
    Globe,
    MessageCircle,
    Instagram,
    RefreshCw,
    ExternalLink,
    CheckCircle2,
    AlertCircle,
    Phone,
    Hash,
    ToggleLeft,
    ToggleRight,
    MessageSquare,
    Voicemail,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { TIMEZONE_OPTIONS, TIMEZONE_REGIONS } from '../lib/timezoneUtils';
import { useToast } from '../contexts/ToastContext';
import { locationService, type ClinicLocation } from '../services/locationService';
import { insurancePlanService, type InsurancePlan } from '../services/insurancePlanService';
import { TenantAddressForm } from '../components/TenantAddressForm';
import { TeamManagement } from '../components/settings/TeamManagement';
import { useTenant } from '../contexts/TenantContext';
import { Activity, Stethoscope, Apple } from 'lucide-react';
import { clsx } from 'clsx';
import { BuyNumberModal } from '../components/numbers/BuyNumberModal';
import { PendingOrdersList } from '../components/numbers/PendingOrdersList';



// Sub-componente: lista de números do tenant
function PhoneNumbersList({ tenantId, showToast }: { tenantId: string; showToast: (msg: string, type: 'success' | 'error') => void }) {
    const [numbers, setNumbers] = useState<any[]>([]);
    const [releasingId, setReleasingId] = useState<string | null>(null);

    const loadNumbers = useCallback(async () => {
        const { data } = await supabase
            .from('tenant_phone_numbers')
            .select('id, phone_number, friendly_name, country_code, is_active, capabilities')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .order('created_at');
        setNumbers(data ?? []);
    }, [tenantId]);

    useEffect(() => {
        loadNumbers();
    }, [loadNumbers]);

    const handleRelease = async (num: any) => {
        const confirm = window.confirm(`Deseja realmente excluir e liberar o número ${num.phone_number} permanentemente? Esta ação não pode ser desfeita.`);
        if (!confirm) return;

        setReleasingId(num.id);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                showToast('Usuário não autenticado.', 'error');
                return;
            }

            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telnyx-numbers`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action: 'release', number_id: num.id })
            });

            const json = await res.json();
            if (!res.ok || json.error) {
                showToast(json.error ?? 'Erro ao liberar o número.', 'error');
            } else {
                showToast('Número excluído e liberado com sucesso!', 'success');
                setNumbers(prev => prev.filter(n => n.id !== num.id));
            }
        } catch (err: any) {
            showToast(`Erro ao liberar número: ${err.message}`, 'error');
        } finally {
            setReleasingId(null);
        }
    };

    if (numbers.length === 0) {
        return (
            <div className="text-center py-6">
                <p className="text-sm text-graphite-300 font-medium">Nenhum número ativo.</p>
                <p className="text-xs text-graphite-300 mt-1">Clique em "Comprar número" para adicionar.</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {numbers.map((num) => (
                <div key={num.id} className="flex items-center justify-between p-3 bg-ice-50 rounded-xl border border-ice-100">
                    <div>
                        <p className="text-sm font-black text-graphite-800 font-mono">{num.phone_number}</p>
                        <p className="text-xs text-graphite-400">
                            {num.friendly_name ?? num.country_code}
                            {num.capabilities?.voice && ' · Voz'}
                            {num.capabilities?.sms && ' · SMS'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {releasingId === num.id ? (
                            <RefreshCw size={14} className="text-graphite-400 animate-spin" />
                        ) : (
                            <button
                                onClick={() => handleRelease(num)}
                                title="Excluir e liberar número"
                                className="p-2 text-graphite-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors border-none cursor-pointer bg-transparent"
                            >
                                <Trash2 size={16} />
                            </button>
                        )}
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export const Settings = () => {
    const { tenant: currentTenant, updateTenant: updateTenantContext, userRole, userProfile } = useTenant();
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState('clinics');
    const [loading, setLoading] = useState(true);
    const [tenants, setTenants] = useState<any[]>([]);
    const [profile, setProfile] = useState<any>(null);

    // Locations state
    const [locations, setLocations] = useState<ClinicLocation[]>([]);
    const [locForm, setLocForm] = useState<Partial<ClinicLocation>>({
        name: '',
        address: '',
        address_number: '',
        address_complement: '',
        address_neighborhood: '',
        address_zip_code: '',
        phone: '',
        latitude: null,
        longitude: null,
        google_maps_url: '',
        type: 'clinica',
        objectives: [],
        operating_hours: {
            1: { start: '08:00', end: '18:00', closed: false },
            2: { start: '08:00', end: '18:00', closed: false },
            3: { start: '08:00', end: '18:00', closed: false },
            4: { start: '08:00', end: '18:00', closed: false },
            5: { start: '08:00', end: '18:00', closed: false },
            6: { start: '08:00', end: '12:00', closed: true },
            0: { start: '00:00', end: '00:00', closed: true },
        }
    });
    const [showLocForm, setShowLocForm] = useState(false);
    const [editingLocId, setEditingLocId] = useState<string | null>(null);

    // Insurance Plans state
    const [insurancePlans, setInsurancePlans] = useState<InsurancePlan[]>([]);
    const [insForm, setInsForm] = useState({ name: '', code: '' });
    const [showInsForm, setShowInsForm] = useState(false);
    const [editingInsId, setEditingInsId] = useState<string | null>(null);

    // Meta Messaging Pages state
    const [metaPages, setMetaPages] = useState<any[]>([]);
    const [connectingMeta, setConnectingMeta] = useState(false);

    // Modal: Comprar número Telnyx
    const [showBuyNumber, setShowBuyNumber]       = useState(false);
    const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);


    useEffect(() => {
        fetchSettingsData();
        fetchMetaPages();

        // Ouvir mensagem do popup de OAuth Meta Messaging
        const handleOAuthMessage = (event: MessageEvent) => {
            if (event.data?.type === 'META_MESSAGING_CONNECTED') {
                fetchMetaPages();
                showToast('Páginas Meta conectadas com sucesso!', 'success');
                setConnectingMeta(false);
            } else if (event.data?.type === 'META_MESSAGING_ERROR') {
                showToast(`Erro ao conectar: ${event.data.message}`, 'error');
                setConnectingMeta(false);
            }
        };
        window.addEventListener('message', handleOAuthMessage);
        return () => window.removeEventListener('message', handleOAuthMessage);
    }, []);

    const fetchMetaPages = async () => {
        const tenantId = currentTenant?.id;
        if (!tenantId) return;
        const { data } = await supabase
            .from('tenant_meta_pages')
            .select('id, page_id, page_name, page_category, instagram_account_id, instagram_username, is_active, last_refreshed_at')
            .eq('tenant_id', tenantId)
            .order('page_name');
        setMetaPages(data ?? []);
    };

    const openMetaMessagingOAuth = () => {
        const tenantId = currentTenant?.id;
        if (!tenantId) { showToast('Selecione uma clínica primeiro', 'error'); return; }
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
        const oauthUrl = `${supabaseUrl}/functions/v1/auth-meta-messaging?tenant_id=${tenantId}`;
        setConnectingMeta(true);
        const popup = window.open(oauthUrl, 'meta_messaging_oauth', 'width=580,height=680,left=200,top=100');
        if (!popup) {
            showToast('Permita popups para conectar o Meta', 'error');
            setConnectingMeta(false);
        }
    };

    const disconnectMetaPage = async (pageId: string) => {
        await supabase
            .from('tenant_meta_pages')
            .update({ is_active: false })
            .eq('id', pageId);
        fetchMetaPages();
        showToast('Página desconectada', 'success');
    };

    const fetchSettingsData = async () => {
        try {
            setLoading(true);

            // Fetch Profile
            const { data: { user } } = await supabase.auth.getUser();
            
            if (user) {
                // Fetch from profiles
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .maybeSingle();

                // Fetch from doctors if exists
                const { data: doctorData } = await supabase
                    .from('doctors')
                    .select('*')
                    .eq('email', user.email)
                    .maybeSingle();

                setProfile({
                    id: user.id,
                    full_name: profileData?.full_name || user.user_metadata?.full_name || '',
                    email: profileData?.email || user.email || '',
                    role: profileData?.role || 'staff',
                    specialty: doctorData?.specialty || '',
                    crm: doctorData?.crm || '',
                    doctor_id: doctorData?.id
                });
            } else {
                // Fallback for dev/testing if no user is logged in
                setProfile({
                    id: 'guest',
                    full_name: 'Usuário Convidado',
                    email: 'guest@traffio.com.br',
                    role: 'staff',
                    specialty: 'Visitante',
                    crm: '0000-00'
                });
            }

            // If no auth, we might need a fallback or just query profiles based on listing
            // For this demo, let's fetch the first profile we find if no user is logged in
            // or if we are in a dev environment with anonymous access to lists

            // Real fetch: Get tenants for the current user
            // Since we are mocking the context often, let's just fetch ALL tenants for display
            // In production, this would be: 
            // supabase.from('members').select('tenant_id, tenants(*)').eq('user_id', user.id)

            const { data: tenantsData, error: tenantsError } = await supabase
                .from('tenants')
                .select('*');

            if (tenantsError) throw tenantsError;
            setTenants(tenantsData || []);




        } catch (error) {
            console.error('Error fetching settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveProfile = async () => {
        if (!profile?.id) {
            showToast('error', 'Nenhum perfil identificado para salvar.');
            return;
        }

        if (profile.id === 'guest') {
            showToast('info', 'Modo demonstração: alterações não persistidas.');
            return;
        }

        try {
            // 1. Try to update by ID
            const { error: updateError, count } = await supabase
                .from('profiles')
                .update({
                    full_name: profile.full_name,
                    email: profile.email,
                    role: profile.role,
                    updated_at: new Date().toISOString()
                })
                .eq('id', profile.id);

            // 2. Determine if we need to merge due to email conflict
            const isEmailConflict = updateError && updateError.code === '23505' && updateError.message.includes('profiles_email_key');
            const shouldCheckEmail = isEmailConflict || count === 0;

            if (shouldCheckEmail) {
                // Find if another record owns this email
                const { data: owner } = await supabase
                    .from('profiles')
                    .select('id')
                    .eq('email', profile.email)
                    .maybeSingle();

                if (owner && owner.id !== profile.id) {
                    // CLAIM LOGIC: Migrate the existing record to the new ID
                    // First delete any stub record that might have been created for the new ID
                    await supabase.from('profiles').delete().eq('id', profile.id);
                    
                    const { error: mergeError } = await supabase
                        .from('profiles')
                        .update({ 
                            id: profile.id, 
                            full_name: profile.full_name,
                            role: profile.role,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', owner.id);
                    
                    if (mergeError) throw mergeError;
                } else if (count === 0) {
                    // No existing record by ID or Email? Then create one.
                    const { error: insertError } = await supabase
                        .from('profiles')
                        .insert({
                            id: profile.id,
                            full_name: profile.full_name,
                            email: profile.email,
                            role: profile.role,
                            updated_at: new Date().toISOString()
                        });
                    if (insertError) throw insertError;
                } else if (updateError) {
                    throw updateError;
                }
            }

            // Update Doctors table if applicable
            if (profile.doctor_id) {
                const { error: doctorError } = await supabase
                    .from('doctors')
                    .update({
                        full_name: profile.full_name,
                        email: profile.email,
                        specialty: profile.specialty,
                        crm: profile.crm
                    })
                    .eq('id', profile.doctor_id);
                
                if (doctorError) throw doctorError;
            }

            showToast('success', 'Perfil atualizado com sucesso!');
        } catch (error) {
            console.error('Error saving profile:', error);
            showToast('error', 'Erro ao atualizar perfil.');
        }
    };

    const handleSaveTenant = async (id: string, updates: any, silent = false) => {
        try {
            const { error } = await supabase
                .from('tenants')
                .update(updates)
                .eq('id', id);

            if (error) throw error;
            if (!silent) {
                showToast('success', 'Clínica atualizada com sucesso!');
                fetchSettingsData();
            }
        } catch (error) {
            if (!silent) showToast('error', 'Erro ao atualizar clínica.');
        }
    };
    
    // --- Locations CRUD ---
    const fetchLocations = async () => {
        if (!tenants.length) return;
        try {
            const data = await locationService.getAll(tenants[0].id);
            setLocations(data);
        } catch (e) { console.error('Error fetching locations:', e); }
    };

    const handleSaveLocation = async () => {
        if (!locForm.name?.trim() || !tenants.length) return;
        try {
            if (editingLocId) {
                await locationService.update(editingLocId, locForm);
            } else {
                // Ensure required fields are present for creation
                const newLoc = {
                    ...locForm,
                    name: locForm.name,
                    tenant_id: tenants[0].id,
                    is_active: true
                } as Omit<ClinicLocation, 'id'>;
                await locationService.create(newLoc);
            }
            setLocForm({
                name: '',
                address: '',
                address_number: '',
                address_complement: '',
                address_neighborhood: '',
                address_zip_code: '',
                phone: '',
                latitude: null,
                longitude: null,
                google_maps_url: '',
                operating_hours: {
                    1: { start: '08:00', end: '18:00', closed: false },
                    2: { start: '08:00', end: '18:00', closed: false },
                    3: { start: '08:00', end: '18:00', closed: false },
                    4: { start: '08:00', end: '18:00', closed: false },
                    5: { start: '08:00', end: '18:00', closed: false },
                    6: { start: '08:00', end: '12:00', closed: true },
                    0: { start: '00:00', end: '00:00', closed: true },
                }
            });
            setShowLocForm(false);
            setEditingLocId(null);
            fetchLocations();
            showToast('success', editingLocId ? 'Local atualizado!' : 'Local criado!');
        } catch (e) { showToast('error', 'Erro ao salvar local.'); }
    };

    const handleDeleteLocation = async (id: string) => {
        if (!confirm('Remover este local de atendimento?')) return;
        try {
            await locationService.delete(id);
            fetchLocations();
            showToast('success', 'Local removido!');
        } catch (e) { showToast('error', 'Erro ao remover local.'); }
    };

    // --- Insurance Plans CRUD ---
    const fetchInsurancePlans = async () => {
        if (!tenants.length) return;
        try {
            const data = await insurancePlanService.getAll(tenants[0].id);
            setInsurancePlans(data);
        } catch (e) { console.error('Error fetching insurance plans:', e); }
    };

    const handleSaveInsurance = async () => {
        if (!insForm.name.trim() || !tenants.length) return;
        try {
            if (editingInsId) {
                await insurancePlanService.update(editingInsId, insForm);
            } else {
                await insurancePlanService.create({ ...insForm, tenant_id: tenants[0].id, is_active: true });
            }
            setInsForm({ name: '', code: '' });
            setShowInsForm(false);
            setEditingInsId(null);
            fetchInsurancePlans();
            showToast('success', editingInsId ? 'Convênio atualizado!' : 'Convênio criado!');
        } catch (e) { showToast('error', 'Erro ao salvar convênio.'); }
    };

    const handleDeleteInsurance = async (id: string) => {
        if (!confirm('Remover este convênio?')) return;
        try {
            await insurancePlanService.delete(id);
            fetchInsurancePlans();
            showToast('success', 'Convênio removido!');
        } catch (e) { showToast('error', 'Erro ao remover convênio.'); }
    };

    useEffect(() => {
        if (tenants.length) {
            fetchLocations();
            fetchInsurancePlans();
        }
    }, [tenants]);

    return (
        <>
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">

            {/* Header */}
            <div>
                <h1 className="text-3xl font-black text-graphite-900 tracking-tight">Configurações</h1>
                <p className="text-graphite-500 font-medium">Gerencie suas unidades, horários e perfil.</p>
            </div>

            {/* Tabs */}
            <div className="flex bg-white p-1.5 rounded-2xl border border-ice-100 shadow-sm w-full">
                {[
                    { id: 'clinics', label: 'Clínicas', icon: Building2 },
                    { id: 'locations', label: 'Unidades', icon: MapPin },
                    { id: 'insurance', label: 'Convênios', icon: Shield },
                    { id: 'team', label: 'Equipe', icon: Users },
                    { id: 'communications', label: 'Comunicações', icon: Phone },
                    { id: 'profile', label: 'Meu Perfil', icon: User },
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold transition-all border-none cursor-pointer ${activeTab === tab.id
                            ? 'bg-brand-primary text-white shadow-md'
                            : 'text-graphite-400 hover:text-brand-primary hover:bg-ice-50'
                            }`}
                    >
                        <tab.icon size={18} />
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="bg-white rounded-[32px] border border-ice-200 shadow-sm min-h-[400px] overflow-hidden">

                {/* Clinics Tab */}
                {activeTab === 'clinics' && (
                    <div className="p-8 space-y-8">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-xl font-black text-graphite-900">Unidades de Atendimento</h3>
                                <p className="text-sm text-graphite-400">Gerencie os dados dos locais onde você atende.</p>
                            </div>
                            <button className="flex items-center gap-2 bg-ice-50 text-brand-primary px-4 py-2 rounded-xl font-bold hover:bg-ice-100 transition-colors border-none cursor-pointer">
                                <Plus size={18} />
                                <span>Adicionar Clínica</span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {loading ? (
                                <p className="text-center text-graphite-400 py-8">Carregando unidades...</p>
                            ) : tenants.length === 0 ? (
                                <p className="text-center text-graphite-400 py-8">Nenhuma clínica cadastrada.</p>
                            ) : (
                                tenants.map((tenant) => (
                                    <div key={tenant.id} className="group border border-ice-100 rounded-2xl p-6 hover:border-brand-primary/30 hover:shadow-md transition-all">
                                        <div className="flex flex-col md:flex-row md:items-center gap-6">
                                            <div className="w-16 h-16 rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary shrink-0">
                                                <Building2 size={32} />
                                            </div>

                                            <div className="flex-1 space-y-4">
                                                <div className="flex flex-col gap-4">
                                                    <div>
                                                        <label className="text-xs font-black text-graphite-400 uppercase">Nome da Unidade</label>
                                                        <input
                                                            type="text"
                                                            defaultValue={tenant.name}
                                                            onBlur={(e) => handleSaveTenant(tenant.id, { name: e.target.value })}
                                                            className="w-full font-bold text-lg text-graphite-900 border-b-2 border-transparent hover:border-ice-200 focus:border-brand-primary outline-none bg-transparent transition-colors py-1"
                                                        />
                                                    </div>

                                                    {/* Specialty Selector */}
                                                    <div>
                                                        <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">Especialidade da Clínica</label>
                                                        <div className="flex gap-3">
                                                            <button
                                                                onClick={() => {
                                                                    const currentSpecs = Array.isArray(tenant.specialty) ? tenant.specialty : [tenant.specialty].filter(Boolean) as string[];
                                                                    const newSpecs = currentSpecs.includes('general') 
                                                                        ? currentSpecs.filter((s: string) => s !== 'general') 
                                                                        : [...currentSpecs, 'general'];
                                                                    handleSaveTenant(tenant.id, { specialty: newSpecs });
                                                                    if (currentTenant?.id === tenant.id) updateTenantContext({ specialty: newSpecs });
                                                                }}
                                                                className={clsx(
                                                                    "flex-1 flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all cursor-pointer bg-white",
                                                                    tenant.specialty?.includes?.('general') 
                                                                        ? 'border-brand-primary bg-brand-primary/5 text-brand-primary shadow-sm' 
                                                                        : 'border-ice-100 text-graphite-400 hover:border-ice-200'
                                                                )}
                                                            >
                                                                <Stethoscope size={20} />
                                                                <div className="text-left">
                                                                    <p className="font-black text-sm leading-none">Clínica Geral</p>
                                                                    <p className="text-[10px] font-bold opacity-60">Medicina e Especialidades</p>
                                                                </div>
                                                                {tenant.specialty?.includes?.('general') && <Check size={16} className="ml-auto" />}
                                                            </button>
                                                            
                                                             <button
                                                                onClick={() => {
                                                                    const currentSpecs = Array.isArray(tenant.specialty) ? tenant.specialty : [tenant.specialty].filter(Boolean) as string[];
                                                                    const newSpecs = currentSpecs.includes('dental') 
                                                                        ? currentSpecs.filter((s: string) => s !== 'dental') 
                                                                        : [...currentSpecs, 'dental'];
                                                                    handleSaveTenant(tenant.id, { specialty: newSpecs });
                                                                    if (currentTenant?.id === tenant.id) updateTenantContext({ specialty: newSpecs });
                                                                }}
                                                                className={clsx(
                                                                    "flex-1 flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all cursor-pointer bg-white",
                                                                    tenant.specialty?.includes?.('dental') 
                                                                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm' 
                                                                        : 'border-ice-100 text-graphite-400 hover:border-ice-200'
                                                                )}
                                                            >
                                                                <Activity size={20} />
                                                                <div className="text-left">
                                                                    <p className="font-black text-sm leading-none">Odontologia</p>
                                                                    <p className="text-[10px] font-bold opacity-60">Painel Odonto Ativado</p>
                                                                </div>
                                                                {tenant.specialty?.includes?.('dental') && <Check size={16} className="ml-auto" />}
                                                            </button>
                                                            
                                                            <button
                                                                onClick={() => {
                                                                    const currentSpecs = Array.isArray(tenant.specialty) ? tenant.specialty : [tenant.specialty].filter(Boolean) as string[];
                                                                    const newSpecs = currentSpecs.includes('nutrition') 
                                                                        ? currentSpecs.filter((s: string) => s !== 'nutrition') 
                                                                        : [...currentSpecs, 'nutrition'];
                                                                    handleSaveTenant(tenant.id, { specialty: newSpecs });
                                                                    if (currentTenant?.id === tenant.id) updateTenantContext({ specialty: newSpecs });
                                                                }}
                                                                className={clsx(
                                                                    "flex-1 flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all cursor-pointer bg-white",
                                                                    tenant.specialty?.includes?.('nutrition') 
                                                                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' 
                                                                        : 'border-ice-100 text-graphite-400 hover:border-ice-200'
                                                                )}
                                                            >
                                                                <Apple size={20} />
                                                                <div className="text-left">
                                                                    <p className="font-black text-sm leading-none">Nutrição</p>
                                                                    <p className="text-[10px] font-bold opacity-60">Painel Nutri Ativado</p>
                                                                </div>
                                                                {tenant.specialty?.includes?.('nutrition') && <Check size={16} className="ml-auto" />}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <TenantAddressForm
                                                        initialData={tenant}
                                                        onSave={(updates: any) => {
                                                            setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, ...updates } : t));
                                                            handleSaveTenant(tenant.id, updates, true);
                                                        }}
                                                    />
                                                </div>

                                                {/* Geofence Config */}
                                                <div className="border-t border-ice-100 pt-4 mt-4">
                                                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5 mb-3">
                                                        <Navigation size={12} /> Geofence (Check-in Express)
                                                    </h4>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                        <div>
                                                            <label className="text-[10px] font-bold text-graphite-400">Latitude</label>
                                                            <input
                                                                type="number"
                                                                step="0.000001"
                                                                key={`lat-${tenant.address}-${tenant.address_number}-${tenant.address_zip_code}`}
                                                                defaultValue={tenant.latitude || ''}
                                                                placeholder="-23.550520"
                                                                onBlur={(e) => handleSaveTenant(tenant.id, { latitude: parseFloat(e.target.value) || null })}
                                                                className="w-full bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-medium text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-graphite-400">Longitude</label>
                                                            <input
                                                                type="number"
                                                                step="0.000001"
                                                                key={`lng-${tenant.address}-${tenant.address_number}-${tenant.address_zip_code}`}
                                                                defaultValue={tenant.longitude || ''}
                                                                placeholder="-46.633308"
                                                                onBlur={(e) => handleSaveTenant(tenant.id, { longitude: parseFloat(e.target.value) || null })}
                                                                className="w-full bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-medium text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-graphite-400">Raio (metros)</label>
                                                            <input
                                                                type="number"
                                                                defaultValue={tenant.geofence_radius || 100}
                                                                onBlur={(e) => handleSaveTenant(tenant.id, { geofence_radius: parseInt(e.target.value) || 100 })}
                                                                className="w-full bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-medium text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Timezone Config */}
                                                <div className="border-t border-ice-100 pt-4 mt-4">
                                                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5 mb-3">
                                                        <Globe size={12} /> Fuso Horário
                                                    </h4>
                                                    <div>
                                                        <label className="text-[10px] font-bold text-graphite-400 block mb-1">Timezone da Clínica</label>
                                                        <select
                                                            key={`tz-${tenant.id}`}
                                                            defaultValue={tenant.timezone || 'America/Sao_Paulo'}
                                                            onChange={(e) => {
                                                                handleSaveTenant(tenant.id, { timezone: e.target.value });
                                                                if (currentTenant?.id === tenant.id) updateTenantContext({ timezone: e.target.value });
                                                            }}
                                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-medium text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                        >
                                                            {TIMEZONE_REGIONS.map(region => (
                                                                <optgroup key={region} label={region}>
                                                                    {TIMEZONE_OPTIONS.filter(tz => tz.region === region).map(tz => (
                                                                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                                                                    ))}
                                                                </optgroup>
                                                            ))}
                                                        </select>
                                                        <p className="text-[10px] text-graphite-400 mt-1">
                                                            Aplica-se a agendamentos, lembretes, WhatsApp, Messenger, Instagram e todos os cron jobs.
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Brand Color */}
                                                <div className="border-t border-ice-100 pt-4 mt-4">
                                                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5 mb-3">
                                                        <Palette size={12} /> Cor da Marca
                                                    </h4>
                                                    <div className="flex items-center gap-3">
                                                        <input
                                                            type="color"
                                                            defaultValue={tenant.color_primary || '#1152d4'}
                                                            onBlur={(e) => handleSaveTenant(tenant.id, { color_primary: e.target.value })}
                                                            className="w-10 h-10 rounded-xl border border-ice-200 cursor-pointer"
                                                        />
                                                        <span className="text-sm font-medium text-graphite-500">{tenant.color_primary || '#1152d4'}</span>
                                                    </div>
                                                </div>

                                                {/* Integration Keys */}
                                                <div className="border-t border-ice-100 pt-4 mt-4">
                                                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5 mb-3">
                                                        <Key size={12} /> Integrações
                                                    </h4>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="text-[10px] font-bold text-graphite-400">Z-API Instance ID</label>
                                                            <input
                                                                type="password"
                                                                defaultValue={tenant.zapi_instance_id || ''}
                                                                placeholder="Instance ID"
                                                                onBlur={(e) => handleSaveTenant(tenant.id, { zapi_instance_id: e.target.value })}
                                                                className="w-full bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-mono text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-graphite-400">Asaas API Key</label>
                                                            <input
                                                                type="password"
                                                                defaultValue={tenant.asaas_api_key || ''}
                                                                placeholder="API Key"
                                                                onBlur={(e) => handleSaveTenant(tenant.id, { asaas_api_key: e.target.value })}
                                                                className="w-full bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-mono text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Meta Messaging — Instagram DM + Facebook Messenger */}
                                                <div className="border-t border-ice-100 pt-4 mt-4">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5">
                                                            <MessageCircle size={12} /> Mensagens — Instagram DM &amp; Facebook Messenger
                                                        </h4>
                                                        <button
                                                            onClick={openMetaMessagingOAuth}
                                                            disabled={connectingMeta}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-none cursor-pointer"
                                                        >
                                                            {connectingMeta ? (
                                                                <><RefreshCw size={12} className="animate-spin" /> Conectando...</>
                                                            ) : (
                                                                <><ExternalLink size={12} /> Conectar Páginas</>
                                                            )}
                                                        </button>
                                                    </div>

                                                    {metaPages.length === 0 ? (
                                                        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100">
                                                            <AlertCircle size={14} className="text-amber-500 shrink-0" />
                                                            <p className="text-xs text-amber-700 font-medium">
                                                                Nenhuma página conectada. Clique em "Conectar Páginas" para autorizar o Instagram DM e Facebook Messenger.
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {metaPages.map((page) => (
                                                                <div key={page.id} className="flex items-center justify-between p-3 rounded-xl bg-ice-50 border border-ice-100">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className={`w-2 h-2 rounded-full ${page.is_active ? 'bg-green-500' : 'bg-red-400'}`} />
                                                                        <div>
                                                                            <p className="text-sm font-bold text-graphite-700">{page.page_name}</p>
                                                                            {page.instagram_username && (
                                                                                <p className="text-xs text-graphite-400 flex items-center gap-1">
                                                                                    <Instagram size={10} />
                                                                                    @{page.instagram_username}
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        {page.is_active ? (
                                                                            <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                                                                <CheckCircle2 size={10} /> Ativo
                                                                            </span>
                                                                        ) : (
                                                                            <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                                                                                <AlertCircle size={10} /> Inativo
                                                                            </span>
                                                                        )}
                                                                        <button
                                                                            onClick={() => disconnectMetaPage(page.id)}
                                                                            className="p-1 text-graphite-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border-none cursor-pointer"
                                                                            title="Desconectar"
                                                                        >
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            <p className="text-[10px] text-graphite-400 mt-1">
                                                                Clique em "Conectar Páginas" novamente para adicionar mais páginas ou renovar o acesso.
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <button className="opacity-0 group-hover:opacity-100 p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all border-none cursor-pointer self-start">
                                                <Trash2 size={20} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}



                {/* Locations Tab */}
                {activeTab === 'locations' && (
                    <div className="p-8 space-y-6">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-xl font-black text-graphite-900">Locais de Atendimento</h3>
                                <p className="text-sm text-graphite-400">Cadastre os locais onde seus profissionais atendem.</p>
                            </div>
                            <button onClick={() => {
                                setShowLocForm(true);
                                setEditingLocId(null);
                                setLocForm({
                                    name: '',
                                    address: '',
                                    address_number: '',
                                    address_complement: '',
                                    address_neighborhood: '',
                                    phone: '',
                                    latitude: null,
                                    longitude: null,
                                    google_maps_url: '',
                                    type: 'clinica',
                                    objectives: [],
                                    operating_hours: {
                                        1: { start: '08:00', end: '18:00', closed: false },
                                        2: { start: '08:00', end: '18:00', closed: false },
                                        3: { start: '08:00', end: '18:00', closed: false },
                                        4: { start: '08:00', end: '18:00', closed: false },
                                        5: { start: '08:00', end: '18:00', closed: false },
                                        6: { start: '08:00', end: '12:00', closed: true },
                                        0: { start: '00:00', end: '00:00', closed: true },
                                    }
                                });
                            }} className="flex items-center gap-2 bg-brand-primary text-white px-4 py-2 rounded-xl font-bold hover:bg-brand-primary/90 transition-colors border-none cursor-pointer shadow-lg shadow-brand-primary/20">
                                <Plus size={18} /> Novo Local
                            </button>
                        </div>

                        {showLocForm && (
                            <div className="border border-brand-primary/20 bg-brand-primary/5 rounded-2xl p-6 space-y-4">
                                <h4 className="font-bold text-graphite-900">{editingLocId ? 'Editar Local' : 'Novo Local'}</h4>
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-graphite-500">Nome *</label>
                                            <input value={locForm.name} onChange={e => setLocForm({ ...locForm, name: e.target.value })} placeholder="Ex: Clínica Centro" className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-graphite-500">Tipo de Local *</label>
                                            <select
                                                value={locForm.type || 'clinica'}
                                                onChange={e => setLocForm({ ...locForm, type: e.target.value as any })}
                                                className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors h-[42px]"
                                            >
                                                <option value="consultorio">Consultório</option>
                                                <option value="clinica">Clínica</option>
                                                <option value="hospital">Hospital</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-graphite-500">Objetivos (separados por vírgula)</label>
                                            <input
                                                value={locForm.objectives?.join(', ')}
                                                onChange={e => setLocForm({ ...locForm, objectives: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                                placeholder="Ex: Consultas, Exames"
                                                className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors"
                                            />
                                        </div>
                                        <div className="col-span-1 md:col-span-3">
                                            <TenantAddressForm
                                                initialData={locForm}
                                                onSave={(updates: Partial<ClinicLocation>) => setLocForm((prev: Partial<ClinicLocation>) => ({ ...prev, ...updates }))}
                                            />
                                        </div>
                                    </div>

                                    {/* Geofence Config */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-ice-100 pt-6">
                                        <div className="space-y-4">
                                            <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5">
                                                <Navigation size={12} /> Geofence (Check-in Express)
                                            </h4>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-[10px] font-bold text-graphite-400 uppercase">Latitude</label>
                                                    <input
                                                        type="number"
                                                        step="0.000001"
                                                        key={`lat-${locForm.address}-${locForm.address_number}-${locForm.address_zip_code}`}
                                                        defaultValue={locForm.latitude || ''}
                                                        placeholder="-23.550520"
                                                        onBlur={(e) => setLocForm({ ...locForm, latitude: parseFloat(e.target.value) || null })}
                                                        className="w-full bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-medium text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-bold text-graphite-400 uppercase">Longitude</label>
                                                    <input
                                                        type="number"
                                                        step="0.000001"
                                                        key={`lng-${locForm.address}-${locForm.address_number}-${locForm.address_zip_code}`}
                                                        defaultValue={locForm.longitude || ''}
                                                        placeholder="-46.633308"
                                                        onBlur={(e) => setLocForm({ ...locForm, longitude: parseFloat(e.target.value) || null })}
                                                        className="w-full bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-medium text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5">
                                                <Clock size={12} /> Horário de Funcionamento
                                            </h4>
                                            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                                                {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                                                    const dayName = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][day];
                                                    const hours = locForm.operating_hours?.[day] || { start: '08:00', end: '18:00', closed: true };

                                                    return (
                                                        <div key={day} className="flex items-center gap-3 bg-white p-2 rounded-lg border border-ice-100">
                                                            <span className="text-[10px] font-black w-8 text-graphite-400 uppercase">{dayName}</span>
                                                            <div className="flex-1 flex gap-2 items-center">
                                                                <input
                                                                    type="time"
                                                                    disabled={hours.closed}
                                                                    value={hours.start}
                                                                    onChange={(e) => setLocForm({
                                                                        ...locForm,
                                                                        operating_hours: {
                                                                            ...locForm.operating_hours,
                                                                            [day]: { ...hours, start: e.target.value }
                                                                        }
                                                                    })}
                                                                    className="bg-ice-50 border border-ice-100 rounded px-1.5 py-0.5 text-[11px] font-bold focus:outline-none focus:border-brand-primary disabled:opacity-30"
                                                                />
                                                                <span className="text-[10px] text-graphite-300">até</span>
                                                                <input
                                                                    type="time"
                                                                    disabled={hours.closed}
                                                                    value={hours.end}
                                                                    onChange={(e) => setLocForm({
                                                                        ...locForm,
                                                                        operating_hours: {
                                                                            ...locForm.operating_hours,
                                                                            [day]: { ...hours, end: e.target.value }
                                                                        }
                                                                    })}
                                                                    className="bg-ice-50 border border-ice-100 rounded px-1.5 py-0.5 text-[11px] font-bold focus:outline-none focus:border-brand-primary disabled:opacity-30"
                                                                />
                                                            </div>
                                                            <button
                                                                onClick={() => setLocForm({
                                                                    ...locForm,
                                                                    operating_hours: {
                                                                        ...locForm.operating_hours,
                                                                        [day]: { ...hours, closed: !hours.closed }
                                                                    }
                                                                })}
                                                                className={`px-2 py-1 rounded text-[10px] font-black uppercase transition-colors border-none cursor-pointer ${!hours.closed ? 'bg-emerald-100 text-emerald-600' : 'bg-ice-100 text-graphite-400'
                                                                    }`}
                                                            >
                                                                {!hours.closed ? 'Aberto' : 'Fechado'}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        
                                        <div className="col-span-1 md:col-span-3">
                                            <label className="text-xs font-bold text-graphite-500 flex items-center gap-1.5 mb-1.5">
                                                <MapPinHouse size={14} className="text-brand-primary" />
                                                Link do Google Maps (Manual)
                                            </label>
                                            <input 
                                                value={locForm.google_maps_url || ''} 
                                                onChange={e => setLocForm({ ...locForm, google_maps_url: e.target.value })} 
                                                placeholder="https://maps.google.com/..." 
                                                className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors" 
                                            />
                                            <p className="text-[10px] font-bold text-graphite-400 mt-1">Se deixado em branco, o sistema gerará um link automático baseado no endereço.</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button onClick={() => { setShowLocForm(false); setEditingLocId(null); }} className="px-4 py-2 rounded-xl font-bold text-graphite-500 hover:bg-ice-100 transition-colors border-none cursor-pointer"><X size={16} className="inline mr-1" />Cancelar</button>
                                    <button onClick={handleSaveLocation} className="px-5 py-2 rounded-xl font-bold bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors border-none cursor-pointer shadow-md"><Check size={16} className="inline mr-1" />Salvar</button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-3">
                            {locations.length === 0 ? (
                                <div className="text-center py-12 text-graphite-400">
                                    <MapPinHouse size={48} className="mx-auto mb-3 text-ice-300" />
                                    <p className="font-bold">Nenhum local cadastrado</p>
                                    <p className="text-sm">Adicione locais para vincular à agenda dos profissionais.</p>
                                </div>
                            ) : locations.map(loc => (
                                <div key={loc.id} className="flex items-center gap-4 p-4 border border-ice-100 rounded-2xl hover:border-brand-primary/20 hover:shadow-sm transition-all group">
                                    <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0"><MapPinHouse size={24} /></div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="font-bold text-graphite-900 truncate">{loc.name}</p>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${loc.type === 'hospital' ? 'bg-rose-100 text-rose-600' :
                                                loc.type === 'clinica' ? 'bg-sky-100 text-sky-600' :
                                                    'bg-amber-100 text-amber-600'
                                                }`}>
                                                {loc.type}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {loc.objectives?.map((obj: string, i: number) => (
                                                <span key={i} className="text-[10px] font-bold text-graphite-400 bg-ice-100 px-1.5 py-0.5 rounded italic">
                                                    {obj}
                                                </span>
                                            ))}
                                            {!loc.objectives?.length && (
                                                <div className="flex items-center gap-1.5 text-sm text-graphite-400 truncate">
                                                    <p className="truncate">{loc.address}</p>
                                                    {loc.google_maps_url && (
                                                        <Navigation size={12} className="text-brand-primary" title="Link manual configurado" />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {loc.phone && <span className="text-sm text-graphite-500 hidden md:block">{loc.phone}</span>}
                                    <div className="flex gap-1">
                                        <button onClick={() => {
                                            setEditingLocId(loc.id);
                                            setLocForm({
                                                name: loc.name,
                                                address: loc.address || '',
                                                address_number: loc.address_number || '',
                                                address_complement: loc.address_complement || '',
                                                address_neighborhood: loc.address_neighborhood || '',
                                                address_zip_code: loc.address_zip_code || '',
                                                phone: loc.phone || '',
                                                latitude: loc.latitude || null,
                                                longitude: loc.longitude || null,
                                                google_maps_url: loc.google_maps_url || '',
                                                type: loc.type || 'clinica',
                                                objectives: loc.objectives || [],
                                                operating_hours: loc.operating_hours || {
                                                    1: { start: '08:00', end: '18:00', closed: false },
                                                    2: { start: '08:00', end: '18:00', closed: false },
                                                    3: { start: '08:00', end: '18:00', closed: false },
                                                    4: { start: '08:00', end: '18:00', closed: false },
                                                    5: { start: '08:00', end: '18:00', closed: false },
                                                    6: { start: '08:00', end: '12:00', closed: true },
                                                    0: { start: '00:00', end: '00:00', closed: true },
                                                }
                                            });
                                            setShowLocForm(true);
                                        }} className="p-2 text-graphite-400 hover:text-brand-primary hover:bg-ice-50 rounded-xl transition-colors border-none cursor-pointer"><Edit3 size={16} /></button>
                                        <button onClick={() => handleDeleteLocation(loc.id)} className="p-2 text-graphite-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors border-none cursor-pointer"><Trash2 size={16} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Insurance Plans Tab */}
                {activeTab === 'insurance' && (
                    <div className="p-8 space-y-6">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-xl font-black text-graphite-900">Convênios Aceitos</h3>
                                <p className="text-sm text-graphite-400">Cadastre os planos de saúde aceitos pela clínica.</p>
                            </div>
                            <button onClick={() => { setShowInsForm(true); setEditingInsId(null); setInsForm({ name: '', code: '' }); }} className="flex items-center gap-2 bg-brand-primary text-white px-4 py-2 rounded-xl font-bold hover:bg-brand-primary/90 transition-colors border-none cursor-pointer shadow-lg shadow-brand-primary/20">
                                <Plus size={18} /> Novo Convênio
                            </button>
                        </div>

                        {showInsForm && (
                            <div className="border border-brand-primary/20 bg-brand-primary/5 rounded-2xl p-6 space-y-4">
                                <h4 className="font-bold text-graphite-900">{editingInsId ? 'Editar Convênio' : 'Novo Convênio'}</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-graphite-500">Nome do Convênio *</label>
                                        <input value={insForm.name} onChange={e => setInsForm({ ...insForm, name: e.target.value })} placeholder="Ex: Unimed" className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-graphite-500">Código ANS (opcional)</label>
                                        <input value={insForm.code} onChange={e => setInsForm({ ...insForm, code: e.target.value })} placeholder="Ex: 302147" className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors" />
                                    </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button onClick={() => { setShowInsForm(false); setEditingInsId(null); }} className="px-4 py-2 rounded-xl font-bold text-graphite-500 hover:bg-ice-100 transition-colors border-none cursor-pointer"><X size={16} className="inline mr-1" />Cancelar</button>
                                    <button onClick={handleSaveInsurance} className="px-5 py-2 rounded-xl font-bold bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors border-none cursor-pointer shadow-md"><Check size={16} className="inline mr-1" />Salvar</button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-3">
                            {insurancePlans.length === 0 ? (
                                <div className="text-center py-12 text-graphite-400">
                                    <Shield size={48} className="mx-auto mb-3 text-ice-300" />
                                    <p className="font-bold">Nenhum convênio cadastrado</p>
                                    <p className="text-sm">Adicione convênios para vincular aos seus profissionais.</p>
                                </div>
                            ) : insurancePlans.map(plan => (
                                <div key={plan.id} className="flex items-center gap-4 p-4 border border-ice-100 rounded-2xl hover:border-brand-primary/20 hover:shadow-sm transition-all group">
                                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0"><Shield size={24} /></div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-graphite-900">{plan.name}</p>
                                        {plan.code && <p className="text-xs text-graphite-400">ANS: {plan.code}</p>}
                                    </div>
                                    <div className="flex gap-1">
                                        <button onClick={() => { setEditingInsId(plan.id); setInsForm({ name: plan.name, code: plan.code || '' }); setShowInsForm(true); }} className="p-2 text-graphite-400 hover:text-brand-primary hover:bg-ice-50 rounded-xl transition-colors border-none cursor-pointer"><Edit3 size={16} /></button>
                                        <button onClick={() => handleDeleteInsurance(plan.id)} className="p-2 text-graphite-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors border-none cursor-pointer"><Trash2 size={16} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}


                {/* Team Tab */}
                {activeTab === 'team' && (
                    <div className="p-8">
                        <TeamManagement
                            currentUserRole={userRole || profile?.role || 'staff'}
                            currentUserId={profile?.id || ''}
                        />
                    </div>
                )}

                {/* Communications Tab */}
                {activeTab === 'communications' && (
                    <div className="p-8 space-y-8 max-w-3xl">
                        <div>
                            <h3 className="text-xl font-black text-graphite-900">Comunicações (Softphone)</h3>
                            <p className="text-sm text-graphite-400 mt-1">
                                Gerencie voz, SMS e números de telefone da plataforma. Powered by Telnyx.
                            </p>
                        </div>

                        {tenants.map((tenant) => (
                            <div key={tenant.id} className="space-y-6">

                                {/* Banner informativo — modelo de revendedor */}
                                <div className="flex items-start gap-3 p-4 rounded-2xl bg-blue-50 border border-blue-100">
                                    <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                                        <Phone size={16} className="text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-black text-blue-800">Comunicações gerenciadas pela Traffio</p>
                                        <p className="text-xs text-blue-600 mt-0.5 leading-relaxed">
                                            A infraestrutura de voz e SMS é provida diretamente pela plataforma.
                                            Nenhuma credencial externa é necessária — basta ativar e contratar números abaixo.
                                        </p>
                                    </div>
                                </div>

                                {/* Ativar/desativar Softphone — sem campos de credenciais */}
                                <div className={`bg-white rounded-2xl p-6 border-2 transition-all ${tenant.telnyx_enabled ? 'border-brand-primary/30' : 'border-ice-100'}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${tenant.telnyx_enabled ? 'bg-brand-primary' : 'bg-ice-100'}`}>
                                                <Phone size={22} className={tenant.telnyx_enabled ? 'text-white' : 'text-graphite-400'} />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-black text-graphite-800">
                                                    Softphone — Voz + SMS
                                                </h4>
                                                <p className="text-xs text-graphite-400 mt-0.5">
                                                    {tenant.telnyx_enabled
                                                        ? '✅ Ativo — widget de discagem disponível para toda a equipe'
                                                        : 'Ativa chamadas e SMS pelo navegador para toda a equipe'}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleSaveTenant(tenant.id, { telnyx_enabled: !tenant.telnyx_enabled })}
                                            className={`p-1 rounded-full transition-colors border-none cursor-pointer ${
                                                tenant.telnyx_enabled ? 'text-brand-primary' : 'text-graphite-300'
                                            }`}
                                        >
                                            {tenant.telnyx_enabled
                                                ? <ToggleRight size={40} />
                                                : <ToggleLeft size={40} />}
                                        </button>
                                    </div>

                                    {/* O que está incluído */}
                                    {!tenant.telnyx_enabled && (
                                        <div className="mt-4 pt-4 border-t border-ice-50 grid grid-cols-2 gap-3">
                                            {[
                                                { icon: Phone,        label: 'Chamadas pelo navegador',    sub: 'Sem app, sem telefone físico' },
                                                { icon: MessageSquare, label: 'SMS bidirecional',           sub: 'Enviar e receber SMS' },
                                                { icon: Voicemail,    label: 'Voicemail com gravação',     sub: 'Caixa postal digital' },
                                                { icon: Hash,         label: 'Múltiplos números',          sub: 'Contratar por país/cidade' },
                                            ].map((item) => (
                                                <div key={item.label} className="flex items-start gap-2 p-3 bg-ice-50 rounded-xl">
                                                    <item.icon size={14} className="text-brand-primary mt-0.5 shrink-0" />
                                                    <div>
                                                        <p className="text-xs font-bold text-graphite-700">{item.label}</p>
                                                        <p className="text-[10px] text-graphite-400">{item.sub}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Gravar chamadas */}
                                {tenant.telnyx_enabled && (
                                    <div className="bg-white border border-ice-100 rounded-2xl p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h4 className="text-sm font-black text-graphite-800">Gravar todas as chamadas</h4>
                                                <p className="text-xs text-graphite-400 mt-1">
                                                    As gravações ficam disponíveis em Comunicações → Chamadas.
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleSaveTenant(tenant.id, { telnyx_auto_record: !tenant.telnyx_auto_record })}
                                                className={`p-1 rounded-full transition-colors border-none cursor-pointer ${
                                                    tenant.telnyx_auto_record !== false ? 'text-brand-primary' : 'text-graphite-300'
                                                }`}
                                            >
                                                {tenant.telnyx_auto_record !== false
                                                    ? <ToggleRight size={36} />
                                                    : <ToggleLeft size={36} />}
                                            </button>
                                        </div>

                                        <div className="mt-4 pt-4 border-t border-ice-50">
                                            <label className="text-[10px] font-bold text-graphite-400">Retenção de gravações</label>
                                            <select
                                                defaultValue={tenant.telnyx_recording_retention_days ?? 90}
                                                onBlur={(e) => handleSaveTenant(tenant.id, { telnyx_recording_retention_days: parseInt(e.target.value) })}
                                                className="w-full mt-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
                                            >
                                                <option value={30}>30 dias</option>
                                                <option value={60}>60 dias</option>
                                                <option value={90}>90 dias</option>
                                                <option value={180}>180 dias</option>
                                                <option value={365}>1 ano</option>
                                            </select>
                                        </div>
                                    </div>
                                )}

                                {/* Números de telefone */}
                                {tenant.telnyx_enabled && (
                                    <div className="bg-white border border-ice-100 rounded-2xl p-6 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-sm font-black text-graphite-800 flex items-center gap-2">
                                                <Hash size={16} className="text-brand-primary" />
                                                Números de Telefone
                                            </h4>
                                            <button
                                                onClick={() => setShowBuyNumber(true)}
                                                className="flex items-center gap-1 text-xs font-bold text-brand-primary hover:underline border-none bg-transparent cursor-pointer"
                                            >
                                                <Plus size={12} /> Comprar número
                                            </button>
                                        </div>

                                        <PhoneNumbersList tenantId={tenant.id} showToast={showToast} />

                                        <PendingOrdersList
                                            tenantId={tenant.id}
                                            refreshKey={ordersRefreshKey}
                                            onResubmit={(_orderId, phoneNumber) => {
                                                setShowBuyNumber(true);
                                            }}
                                        />
                                    </div>
                                )}

                                {/* SMS */}
                                <div className="bg-white border border-ice-100 rounded-2xl p-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="text-sm font-black text-graphite-800 flex items-center gap-2">
                                                <MessageCircle size={16} className="text-brand-primary" />
                                                SMS nas Automações
                                            </h4>
                                            <p className="text-xs text-graphite-400 mt-1">
                                                Permite enviar alertas de No-Show e NPS por SMS quando o paciente preferir.
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleSaveTenant(tenant.id, { sms_enabled: !tenant.sms_enabled })}
                                            className={`p-1 rounded-full transition-colors border-none cursor-pointer ${
                                                tenant.sms_enabled ? 'text-brand-primary' : 'text-graphite-300'
                                            }`}
                                        >
                                            {tenant.sms_enabled
                                                ? <ToggleRight size={36} />
                                                : <ToggleLeft size={36} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Profile Tab */}
                {activeTab === 'profile' && profile && (
                    <div className="p-8 space-y-8">
                        <div className="flex items-start gap-8">
                            {/* Profile Identity - Purely Nominal */}
                            <div className="flex-1 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-graphite-900">Nome Completo</label>
                                        <input
                                            type="text"
                                            value={profile.full_name}
                                            onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                                            className="w-full bg-white border border-ice-200 rounded-xl px-4 py-3 font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-graphite-900">E-mail</label>
                                        <input
                                            type="email"
                                            value={profile.email}
                                            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                                            className="w-full bg-white border border-ice-200 rounded-xl px-4 py-3 font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-graphite-900">Cargo na Plataforma</label>
                                        <select
                                            value={profile.role}
                                            onChange={(e) => setProfile({ ...profile, role: e.target.value })}
                                            className="w-full bg-white border border-ice-200 rounded-xl px-4 py-3 font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all cursor-pointer"
                                        >
                                            <option value="owner">Administrador do Tenant</option>
                                            <option value="staff">Funcionário / Staff</option>
                                            <option value="doctor">Profissional de Saúde</option>
                                            {profile.role === 'super_admin' && (
                                                <option value="super_admin">Gestor da Plataforma (Super Admin)</option>
                                            )}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-graphite-900">Especialidade</label>
                                        <input
                                            type="text"
                                            value={profile.specialty}
                                            onChange={(e) => setProfile({ ...profile, specialty: e.target.value })}
                                            className="w-full bg-white border border-ice-200 rounded-xl px-4 py-3 font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-graphite-900">CRM/Registro</label>
                                        <input
                                            type="text"
                                            value={profile.crm}
                                            onChange={(e) => setProfile({ ...profile, crm: e.target.value })}
                                            className="w-full bg-white border border-ice-200 rounded-xl px-4 py-3 font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all"
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-end pt-4">
                                    <button 
                                        onClick={handleSaveProfile}
                                        className="flex items-center gap-2 bg-brand-primary text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-105 transition-transform border-none cursor-pointer"
                                    >
                                        <Check size={18} />
                                        <span>Salvar Alterações</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>

        {/* ── Modal: Comprar número Telnyx (com KYC) ───────────────────────── */}
        {showBuyNumber && currentTenant && (
            <BuyNumberModal
                tenantId={currentTenant.id}
                onClose={() => setShowBuyNumber(false)}
                onPurchased={() => {
                    setOrdersRefreshKey((k) => k + 1);
                    fetchSettingsData();
                }}
                showToast={showToast}
            />
        )}
        </>
    );
};
