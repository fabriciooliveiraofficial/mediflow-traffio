import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
    Facebook,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { TIMEZONE_OPTIONS, TIMEZONE_REGIONS } from '../lib/timezoneUtils';
import { useToast } from '../contexts/ToastContext';
import { locationService, type ClinicLocation } from '../services/locationService';
import { insurancePlanService, type InsurancePlan } from '../services/insurancePlanService';
import { TenantAddressForm } from '../components/TenantAddressForm';
import { TeamManagement } from '../components/settings/TeamManagement';
import { useTenant } from '../contexts/TenantContext';
import { listCountries, getCountry, DEFAULT_COUNTRY, type CountryCode } from '../lib/i18n/countryFormats';
import { formatPhone, phoneFlag } from '../lib/formatPhone';
import { Activity, Stethoscope, Apple } from 'lucide-react';
import { clsx } from 'clsx';
import { BuyNumberModal } from '../components/numbers/BuyNumberModal';
import { PendingOrdersList } from '../components/numbers/PendingOrdersList';



// Sub-componente: lista de números do tenant
function PhoneNumbersList({ tenantId, showToast, refreshKey }: { tenantId: string; showToast: (type: 'success' | 'error' | 'warning' | 'info', msg: string) => void; refreshKey?: number }) {
    const { t } = useTranslation('settings');
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
    }, [loadNumbers, refreshKey]);

    const handleRelease = async (num: any) => {
        const confirm = window.confirm(t('confirms.releaseNumber', { number: num.phone_number }));
        if (!confirm) return;

        setReleasingId(num.id);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                showToast('error', t('toasts.notAuthenticated'));
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
                showToast('error', json.error ?? t('toasts.numberReleaseError'));
            } else {
                showToast('success', t('toasts.numberReleased'));
                setNumbers(prev => prev.filter(n => n.id !== num.id));
            }
        } catch (err: any) {
            showToast('error', `${t('toasts.numberReleaseErrorPrefix')} ${err.message}`);
        } finally {
            setReleasingId(null);
        }
    };

    if (numbers.length === 0) {
        return (
            <div className="text-center py-6">
                <p className="text-sm text-graphite-300 font-medium">{t('phoneNumbers.empty')}</p>
                <p className="text-xs text-graphite-300 mt-1">{t('phoneNumbers.emptyHint')}</p>
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
                            {num.capabilities?.voice && ` · ${t('phoneNumbers.voiceSuffix')}`}
                            {num.capabilities?.sms && ` · ${t('phoneNumbers.smsSuffix')}`}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {releasingId === num.id ? (
                            <RefreshCw size={14} className="text-graphite-400 animate-spin" />
                        ) : (
                            <button
                                onClick={() => handleRelease(num)}
                                title={t('phoneNumbers.releaseTitle')}
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

const loadStripeScript = () => {
    return new Promise<any>((resolve, reject) => {
        if (typeof window === 'undefined') {
            reject(new Error('Window is undefined'));
            return;
        }
        if ((window as any).Stripe) {
            resolve((window as any).Stripe);
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://js.stripe.com/v3/';
        script.onload = () => resolve((window as any).Stripe);
        script.onerror = () => reject(new Error('Failed to load Stripe script'));
        document.body.appendChild(script);
    });
};

export const Settings = () => {
    const { t } = useTranslation('settings');
    const { tenant: currentTenant, updateTenant: updateTenantContext, userRole } = useTenant();
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
        country: undefined,
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

    // Meta connection features choice
    const [metaConnectModal, setMetaConnectModal] = useState(false);
    const [metaFeatures, setMetaFeatures] = useState({ ads: true, messaging: true });

    // Modal: Comprar número Telnyx
    const [showBuyNumber, setShowBuyNumber]       = useState(false);
    const [resubmitOrderId, setResubmitOrderId]   = useState<string | undefined>(undefined);
    const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
    const [syncing, setSyncing] = useState(false);

    // Wallet & Consumption states
    const [wallet, setWallet] = useState<any>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [usageLogs, setUsageLogs] = useState<any[]>([]);
    const [showRechargeModal, setShowRechargeModal] = useState(false);
    const [rechargeAmount, setRechargeAmount] = useState('50');
    const [recharging, setRecharging] = useState(false);
    const [stripeClientSecret, setStripeClientSecret] = useState<string | null>(null);
    const checkoutRef = useRef<any>(null);

    useEffect(() => {
        let active = true;
        
        async function initEmbedded() {
            if (!stripeClientSecret) return;
            
            try {
                if (!(window as any).Stripe) {
                    await loadStripeScript();
                }
                
                const stripe = (window as any).Stripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
                
                if (active) {
                    const container = document.getElementById('stripe-checkout-container');
                    if (container) {
                        container.innerHTML = '';
                    }

                    const checkout = await stripe.initEmbeddedCheckout({
                        clientSecret: stripeClientSecret,
                    });
                    
                    if (active) {
                        checkoutRef.current = checkout;
                        checkout.mount('#stripe-checkout-container');
                    } else {
                        checkout.destroy();
                    }
                }
            } catch (err) {
                console.error('Failed to init embedded checkout:', err);
                showToast('error', 'Erro ao carregar o faturamento do Stripe');
                setStripeClientSecret(null);
            }
        }

        initEmbedded();

        return () => {
            active = false;
            if (checkoutRef.current) {
                try {
                    checkoutRef.current.destroy();
                } catch (e) {
                    console.error('Error destroying checkout:', e);
                }
                checkoutRef.current = null;
            }
        };
    }, [stripeClientSecret, showToast]);

    const fetchWalletAndUsageData = useCallback(async () => {
        if (!currentTenant?.id) return;
        try {
            // 1. Fetch wallet
            const { data: walletData } = await supabase
                .from('tenant_wallets')
                .select('*')
                .eq('tenant_id', currentTenant.id)
                .maybeSingle();
            
            if (walletData) {
                setWallet(walletData);
            } else {
                const { data: newWallet } = await supabase
                    .from('tenant_wallets')
                    .insert({ tenant_id: currentTenant.id, balance_brl: 0.00 })
                    .select()
                    .maybeSingle();
                if (newWallet) setWallet(newWallet);
            }

            // 2. Fetch transactions
            const { data: txs } = await supabase
                .from('wallet_transactions')
                .select('*')
                .eq('tenant_id', currentTenant.id)
                .order('created_at', { ascending: false })
                .limit(20);
            setTransactions(txs ?? []);

            // 3. Fetch usage logs
            const { data: logs } = await supabase
                .from('tenant_usage_log')
                .select('*')
                .eq('tenant_id', currentTenant.id)
                .order('created_at', { ascending: false });
            setUsageLogs(logs ?? []);
        } catch (e) {
            console.error('Error fetching wallet/usage data:', e);
        }
    }, [currentTenant]);

    const handleRechargeWallet = async () => {
        if (!currentTenant?.id) {
            showToast('error', 'Clínica não selecionada');
            return;
        }

        const amount = parseFloat(rechargeAmount);
        if (isNaN(amount) || amount < 10) {
            showToast('error', 'O valor mínimo de recarga é de R$ 10,00');
            return;
        }

        setRecharging(true);
        try {
            const { data, error } = await supabase.functions.invoke('stripe-create-wallet-checkout', {
                body: {
                    amount,
                    embedded: true,
                }
            });

            if (error) throw new Error(error.message);
            if (data?.error) throw new Error(data.error);

            if (data?.clientSecret) {
                setShowRechargeModal(false);
                setStripeClientSecret(data.clientSecret);
            } else {
                throw new Error('Retorno inválido da API do Stripe');
            }
        } catch (err: any) {
            showToast('error', `Erro ao abrir faturamento Stripe: ${err.message}`);
        } finally {
            setRecharging(false);
        }
    };

    useEffect(() => {
        const queryParams = new URLSearchParams(window.location.search);
        if (queryParams.get('recharge') === 'success') {
            showToast('success', 'Solicitação de recarga iniciada! Seus créditos serão atualizados em instantes.');
            queryParams.delete('recharge');
            const newSearch = queryParams.toString();
            const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
            window.history.replaceState({}, '', newUrl);
        }
    }, [showToast]);

    const handleSync = async () => {
        setSyncing(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                showToast('error', t('toasts.notAuthenticated'));
                return;
            }

            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telnyx-numbers`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action: 'sync' })
            });

            const json = res.ok ? await res.json() : null;
            if (!res.ok || json?.error) {
                showToast('error', json?.error ?? t('toasts.syncError'));
            } else {
                showToast('success', t('toasts.syncSuccess'));
                // Forçar atualização das duas listas
                setOrdersRefreshKey(k => k + 1);
            }
        } catch (err: any) {
            showToast('error', `${t('toasts.syncErrorPrefix')} ${err.message}`);
        } finally {
            setSyncing(false);
        }
    };


    useEffect(() => {
        fetchSettingsData();
        fetchMetaPages();

        // Ouvir mensagem do popup de OAuth Meta Messaging / Unified
        const handleOAuthMessage = (event: MessageEvent) => {
            if (
                event.data?.type === 'META_MESSAGING_CONNECTED' || 
                (event.data?.type === 'OAUTH_CONNECTED' && event.data?.platform === 'meta')
            ) {
                fetchMetaPages();
                showToast('success', t('toasts.metaConnectedSuccess'));
                setConnectingMeta(false);
            } else if (
                event.data?.type === 'META_MESSAGING_ERROR' ||
                (event.data?.type === 'OAUTH_ERROR' && event.data?.platform === 'meta')
            ) {
                showToast('error', `${t('toasts.metaConnectErrorPrefix')} ${event.data.message || t('toasts.metaAuthErrorFallback')}`);
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

    const openMetaMessagingOAuth = (features?: string) => {
        const tenantId = currentTenant?.id;
        if (!tenantId) { showToast('error', t('toasts.metaSelectClinicFirst')); return; }
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
        const redirectBack = window.location.origin;
        const featuresParam = features ? `&features=${features}` : '';
        const oauthUrl = `${supabaseUrl}/functions/v1/auth-meta?tenant_id=${tenantId}&redirect_back=${encodeURIComponent(redirectBack)}${featuresParam}`;
        setConnectingMeta(true);
        const popup = window.open(oauthUrl, 'meta_oauth', 'width=580,height=680,left=200,top=100');
        if (!popup) {
            showToast('error', t('toasts.metaAllowPopups'));
            setConnectingMeta(false);
        }
    };

    const disconnectMetaPage = async (pageId: string) => {
        await supabase
            .from('tenant_meta_pages')
            .update({ is_active: false })
            .eq('id', pageId);
        fetchMetaPages();
        showToast('success', t('toasts.metaPageDisconnected'));
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
                    full_name: t('guestProfile.fullName'),
                    email: 'guest@traffio.com.br',
                    role: 'staff',
                    specialty: t('guestProfile.specialty'),
                    crm: '0000-00'
                });
            }

            // If no auth, we might need a fallback or just query profiles based on listing
            // For this demo, let's fetch the first profile we find if no user is logged in
            // or if we are in a dev environment with anonymous access to lists

            // Real fetch: Get tenants for the current user
            if (user) {
                const { data: membersData, error: membersError } = await supabase
                    .from('members')
                    .select('tenant_id, tenants(*)')
                    .eq('user_id', user.id)
                    .eq('is_active', true);

                if (membersError) throw membersError;

                // Extract the tenants from the members array
                const tenantsData = membersData
                    ?.map((m: any) => m.tenants)
                    ?.filter(Boolean) || [];

                setTenants(tenantsData);
            }
        } catch (error) {
            console.error('Error fetching settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveProfile = async () => {
        if (!profile?.id) {
            showToast('error', t('toasts.profileNotFound'));
            return;
        }

        if (profile.id === 'guest') {
            showToast('info', t('toasts.demoModeInfo'));
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

            showToast('success', t('toasts.profileUpdated'));
        } catch (error) {
            console.error('Error saving profile:', error);
            showToast('error', t('toasts.profileUpdateError'));
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
                showToast('success', t('toasts.tenantUpdated'));
                fetchSettingsData();
            }
        } catch (error) {
            if (!silent) showToast('error', t('toasts.tenantUpdateError'));
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
                country: undefined,
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
            showToast('success', editingLocId ? t('toasts.locationUpdated') : t('toasts.locationCreated'));
        } catch (e) { showToast('error', t('toasts.locationSaveError')); }
    };

    const handleDeleteLocation = async (id: string) => {
        if (!confirm(t('confirms.deleteLocation'))) return;
        try {
            await locationService.delete(id);
            fetchLocations();
            showToast('success', t('toasts.locationRemoved'));
        } catch (e) { showToast('error', t('toasts.locationRemoveError')); }
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
            showToast('success', editingInsId ? t('toasts.insuranceUpdated') : t('toasts.insuranceCreated'));
        } catch (e) { showToast('error', t('toasts.insuranceSaveError')); }
    };

    const handleDeleteInsurance = async (id: string) => {
        if (!confirm(t('confirms.deleteInsurance'))) return;
        try {
            await insurancePlanService.delete(id);
            fetchInsurancePlans();
            showToast('success', t('toasts.insuranceRemoved'));
        } catch (e) { showToast('error', t('toasts.insuranceRemoveError')); }
    };

    useEffect(() => {
        if (tenants.length) {
            fetchLocations();
            fetchInsurancePlans();
        }
    }, [tenants]);

    useEffect(() => {
        if (activeTab === 'communications') {
            fetchWalletAndUsageData();
        }
    }, [activeTab, fetchWalletAndUsageData, ordersRefreshKey]);

    const consumptionSummary = useMemo(() => {
        let voiceBrl = 0;
        let voiceMin = 0;
        let smsBrl = 0;
        let smsCount = 0;
        let numbersBrl = 0;
        let numbersCount = 0;

        usageLogs.forEach(log => {
            const price = Number(log.total_price_brl) || 0;
            const qty = Number(log.quantity) || 0;
            
            if (log.resource_type?.startsWith('call')) {
                voiceBrl += price;
                voiceMin += qty;
            } else if (log.resource_type?.startsWith('sms')) {
                smsBrl += price;
                smsCount += qty;
            } else if (log.resource_type?.startsWith('number')) {
                numbersBrl += price;
                numbersCount += qty;
            }
        });

        const totalBrl = voiceBrl + smsBrl + numbersBrl;

        return {
            voiceBrl,
            voiceMin,
            smsBrl,
            smsCount,
            numbersBrl,
            numbersCount,
            totalBrl
        };
    }, [usageLogs]);

    return (
        <>
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">

            {/* Header */}
            <div>
                <h1 className="text-3xl font-black text-graphite-900 tracking-tight">{t('header.title')}</h1>
                <p className="text-graphite-500 font-medium">{t('header.subtitle')}</p>
            </div>

            {/* Tabs */}
            <div className="flex bg-white p-1.5 rounded-2xl border border-ice-100 shadow-sm w-full">
                {[
                    { id: 'clinics', label: t('tabs.clinics'), icon: Building2 },
                    { id: 'locations', label: t('tabs.locations'), icon: MapPin },
                    { id: 'insurance', label: t('tabs.insurance'), icon: Shield },
                    { id: 'team', label: t('tabs.team'), icon: Users },
                    { id: 'communications', label: t('tabs.communications'), icon: Phone },
                    { id: 'profile', label: t('tabs.profile'), icon: User },
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
                                <h3 className="text-xl font-black text-graphite-900">{t('clinics.title')}</h3>
                                <p className="text-sm text-graphite-400">{t('clinics.subtitle')}</p>
                            </div>
                            <button className="flex items-center gap-2 bg-ice-50 text-brand-primary px-4 py-2 rounded-xl font-bold hover:bg-ice-100 transition-colors border-none cursor-pointer">
                                <Plus size={18} />
                                <span>{t('clinics.addClinic')}</span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {loading ? (
                                <p className="text-center text-graphite-400 py-8">{t('clinics.loading')}</p>
                            ) : tenants.length === 0 ? (
                                <p className="text-center text-graphite-400 py-8">{t('clinics.empty')}</p>
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
                                                        <label className="text-xs font-black text-graphite-400 uppercase">{t('clinics.unitNameLabel')}</label>
                                                        <input
                                                            type="text"
                                                            defaultValue={tenant.name}
                                                            onBlur={(e) => handleSaveTenant(tenant.id, { name: e.target.value })}
                                                            className="w-full font-bold text-lg text-graphite-900 border-b-2 border-transparent hover:border-ice-200 focus:border-brand-primary outline-none bg-transparent transition-colors py-1"
                                                        />
                                                    </div>

                                                    {/* Specialty Selector */}
                                                    <div>
                                                        <label className="text-xs font-black text-graphite-400 uppercase mb-2 block">{t('clinics.specialtyLabel')}</label>
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
                                                                    <p className="font-black text-sm leading-none">{t('clinics.specialtyGeneral')}</p>
                                                                    <p className="text-[10px] font-bold opacity-60">{t('clinics.specialtyGeneralSub')}</p>
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
                                                                    <p className="font-black text-sm leading-none">{t('clinics.specialtyDental')}</p>
                                                                    <p className="text-[10px] font-bold opacity-60">{t('clinics.specialtyDentalSub')}</p>
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
                                                                    <p className="font-black text-sm leading-none">{t('clinics.specialtyNutrition')}</p>
                                                                    <p className="text-[10px] font-bold opacity-60">{t('clinics.specialtyNutritionSub')}</p>
                                                                </div>
                                                                {tenant.specialty?.includes?.('nutrition') && <Check size={16} className="ml-auto" />}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <TenantAddressForm
                                                        initialData={tenant}
                                                        country={tenant.country || DEFAULT_COUNTRY}
                                                        onSave={(updates: any) => {
                                                            setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, ...updates } : t));
                                                            handleSaveTenant(tenant.id, updates, true);
                                                        }}
                                                    />
                                                </div>

                                                {/* Country Config */}
                                                <div className="border-t border-ice-100 pt-4 mt-4">
                                                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5 mb-3">
                                                        <Globe size={12} /> {t('clinics.countrySectionTitle')}
                                                    </h4>
                                                    <div>
                                                        <label className="text-[10px] font-bold text-graphite-400 block mb-1">{t('clinics.countryLabel')}</label>
                                                        <select
                                                            key={`country-${tenant.id}`}
                                                            defaultValue={tenant.country || DEFAULT_COUNTRY}
                                                            onChange={(e) => {
                                                                const country = e.target.value as CountryCode;
                                                                const locale = getCountry(country).locale;
                                                                setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, country, locale } : t));
                                                                handleSaveTenant(tenant.id, { country, locale });
                                                                if (currentTenant?.id === tenant.id) updateTenantContext({ country, locale });
                                                            }}
                                                            className="w-full bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-medium text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                        >
                                                            {listCountries().map(c => (
                                                                <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                                                            ))}
                                                        </select>
                                                        <p className="text-[10px] text-graphite-400 mt-1">
                                                            {t('clinics.countryHint')}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Geofence Config */}
                                                <div className="border-t border-ice-100 pt-4 mt-4">
                                                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5 mb-3">
                                                        <Navigation size={12} /> {t('clinics.geofenceSectionTitle')}
                                                    </h4>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                        <div>
                                                            <label className="text-[10px] font-bold text-graphite-400">{t('clinics.latitudeLabel')}</label>
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
                                                            <label className="text-[10px] font-bold text-graphite-400">{t('clinics.longitudeLabel')}</label>
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
                                                            <label className="text-[10px] font-bold text-graphite-400">{t('clinics.radiusLabel')}</label>
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
                                                        <Globe size={12} /> {t('clinics.timezoneSectionTitle')}
                                                    </h4>
                                                    <div>
                                                        <label className="text-[10px] font-bold text-graphite-400 block mb-1">{t('clinics.timezoneLabel')}</label>
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
                                                            {t('clinics.timezoneHint')}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Booking Widget — Antecedência mínima */}
                                                <div className="border-t border-ice-100 pt-4 mt-4">
                                                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5 mb-3">
                                                        <Clock size={12} /> {t('clinics.widgetSectionTitle')}
                                                    </h4>
                                                    <div>
                                                        <label className="text-[10px] font-bold text-graphite-400 block mb-1">{t('clinics.minLeadLabel')}</label>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            step={5}
                                                            key={`lead-${tenant.id}`}
                                                            defaultValue={tenant.booking_min_lead_minutes ?? 30}
                                                            onBlur={(e) => handleSaveTenant(tenant.id, { booking_min_lead_minutes: parseInt(e.target.value, 10) || 0 })}
                                                            className="w-full max-w-[200px] bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-medium text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                        />
                                                        <p className="text-[10px] text-graphite-400 mt-1">
                                                            {t('clinics.minLeadHint')}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Brand Color */}
                                                <div className="border-t border-ice-100 pt-4 mt-4">
                                                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5 mb-3">
                                                        <Palette size={12} /> {t('clinics.brandColorSectionTitle')}
                                                    </h4>
                                                    <div className="flex items-center gap-3">
                                                        <input
                                                            type="color"
                                                            value={tenant.color_primary || '#1152d4'}
                                                            onChange={(e) => {
                                                                setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, color_primary: e.target.value } : t));
                                                                if (currentTenant?.id === tenant.id) {
                                                                    updateTenantContext({ color_primary: e.target.value });
                                                                }
                                                            }}
                                                            onBlur={(e) => handleSaveTenant(tenant.id, { color_primary: e.target.value })}
                                                            className="w-10 h-10 rounded-xl border border-ice-200 cursor-pointer"
                                                        />
                                                        <span className="text-sm font-medium text-graphite-500">{tenant.color_primary || '#1152d4'}</span>
                                                    </div>
                                                </div>

                                                {/* Integration Keys */}
                                                <div className="border-t border-ice-100 pt-4 mt-4">
                                                    <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5 mb-3">
                                                        <Key size={12} /> {t('clinics.integrationsSectionTitle')}
                                                    </h4>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="text-[10px] font-bold text-graphite-400">{t('clinics.zapiInstanceLabel')}</label>
                                                            <input
                                                                type="password"
                                                                defaultValue={tenant.zapi_instance_id || ''}
                                                                placeholder="Instance ID"
                                                                onBlur={(e) => handleSaveTenant(tenant.id, { zapi_instance_id: e.target.value })}
                                                                className="w-full bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-mono text-graphite-700 focus:outline-none focus:border-brand-primary transition-colors"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-graphite-400">{t('clinics.asaasApiKeyLabel')}</label>
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
                                                            <MessageCircle size={12} /> {t('clinics.metaMessagingSectionTitle')}
                                                        </h4>
                                                        <button
                                                            onClick={() => setMetaConnectModal(true)}
                                                            disabled={connectingMeta}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-none cursor-pointer"
                                                        >
                                                            {connectingMeta ? (
                                                                <><RefreshCw size={12} className="animate-spin" /> {t('clinics.metaConnecting')}</>
                                                            ) : (
                                                                <><ExternalLink size={12} /> {t('clinics.metaConnectPages')}</>
                                                            )}
                                                        </button>
                                                    </div>

                                                    {metaPages.length === 0 ? (
                                                        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100">
                                                            <AlertCircle size={14} className="text-amber-500 shrink-0" />
                                                            <p className="text-xs text-amber-700 font-medium">
                                                                {t('clinics.metaNoPagesConnected')}
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
                                                                                <CheckCircle2 size={10} /> {t('clinics.metaPageActive')}
                                                                            </span>
                                                                        ) : (
                                                                            <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                                                                                <AlertCircle size={10} /> {t('clinics.metaPageInactive')}
                                                                            </span>
                                                                        )}
                                                                        <button
                                                                            onClick={() => disconnectMetaPage(page.id)}
                                                                            className="p-1 text-graphite-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border-none cursor-pointer"
                                                                            title={t('clinics.metaDisconnectTitle')}
                                                                        >
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            <p className="text-[10px] text-graphite-400 mt-1">
                                                                {t('clinics.metaReconnectHint')}
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
                                <h3 className="text-xl font-black text-graphite-900">{t('locations.title')}</h3>
                                <p className="text-sm text-graphite-400">{t('locations.subtitle')}</p>
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
                                <Plus size={18} /> {t('locations.newLocation')}
                            </button>
                        </div>

                        {showLocForm && (
                            <div className="border border-brand-primary/20 bg-brand-primary/5 rounded-2xl p-6 space-y-4">
                                <h4 className="font-bold text-graphite-900">{editingLocId ? t('locations.editLocation') : t('locations.newLocation')}</h4>
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-graphite-500">{t('locations.nameLabel')}</label>
                                            <input value={locForm.name} onChange={e => setLocForm({ ...locForm, name: e.target.value })} placeholder={t('locations.namePlaceholder')} className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-graphite-500">{t('locations.typeLabel')}</label>
                                            <select
                                                value={locForm.type || 'clinica'}
                                                onChange={e => setLocForm({ ...locForm, type: e.target.value as any })}
                                                className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors h-[42px]"
                                            >
                                                <option value="consultorio">{t('locations.typeOffice')}</option>
                                                <option value="clinica">{t('locations.typeClinic')}</option>
                                                <option value="hospital">{t('locations.typeHospital')}</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-graphite-500">{t('locations.objectivesLabel')}</label>
                                            <input
                                                value={locForm.objectives?.join(', ')}
                                                onChange={e => setLocForm({ ...locForm, objectives: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                                placeholder={t('locations.objectivesPlaceholder')}
                                                className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-graphite-500">{t('locations.countryLabel')}</label>
                                            <select
                                                value={locForm.country || tenants[0]?.country || DEFAULT_COUNTRY}
                                                onChange={e => setLocForm({ ...locForm, country: e.target.value as CountryCode })}
                                                className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary transition-colors h-[42px]"
                                            >
                                                {listCountries().map(c => (
                                                    <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="col-span-1 md:col-span-3">
                                            <TenantAddressForm
                                                initialData={locForm}
                                                country={(locForm.country || tenants[0]?.country || DEFAULT_COUNTRY) as CountryCode}
                                                onSave={(updates: Partial<ClinicLocation>) => setLocForm((prev: Partial<ClinicLocation>) => ({ ...prev, ...updates }))}
                                            />
                                        </div>
                                    </div>

                                    {/* Geofence Config */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-ice-100 pt-6">
                                        <div className="space-y-4">
                                            <h4 className="text-xs font-black text-graphite-400 uppercase flex items-center gap-1.5">
                                                <Navigation size={12} /> {t('locations.geofenceSectionTitle')}
                                            </h4>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-[10px] font-bold text-graphite-400 uppercase">{t('locations.latitudeLabel')}</label>
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
                                                    <label className="text-[10px] font-bold text-graphite-400 uppercase">{t('locations.longitudeLabel')}</label>
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
                                                <Clock size={12} /> {t('locations.operatingHoursSectionTitle')}
                                            </h4>
                                            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                                                {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                                                    const weekdaysShort = t('locations.weekdaysShort', { returnObjects: true }) as string[];
                                                    const dayName = weekdaysShort[day];
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
                                                                <span className="text-[10px] text-graphite-300">{t('locations.until')}</span>
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
                                                                {!hours.closed ? t('locations.open') : t('locations.closed')}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        
                                        <div className="col-span-1 md:col-span-3">
                                            <label className="text-xs font-bold text-graphite-500 flex items-center gap-1.5 mb-1.5">
                                                <MapPinHouse size={14} className="text-brand-primary" />
                                                {t('locations.googleMapsLabel')}
                                            </label>
                                            <input
                                                value={locForm.google_maps_url || ''}
                                                onChange={e => setLocForm({ ...locForm, google_maps_url: e.target.value })}
                                                placeholder={t('locations.googleMapsPlaceholder')}
                                                className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors"
                                            />
                                            <p className="text-[10px] font-bold text-graphite-400 mt-1">{t('locations.googleMapsHint')}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button onClick={() => { setShowLocForm(false); setEditingLocId(null); }} className="px-4 py-2 rounded-xl font-bold text-graphite-500 hover:bg-ice-100 transition-colors border-none cursor-pointer"><X size={16} className="inline mr-1" />{t('actions.cancel')}</button>
                                    <button onClick={handleSaveLocation} className="px-5 py-2 rounded-xl font-bold bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors border-none cursor-pointer shadow-md"><Check size={16} className="inline mr-1" />{t('actions.save')}</button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-3">
                            {locations.length === 0 ? (
                                <div className="text-center py-12 text-graphite-400">
                                    <MapPinHouse size={48} className="mx-auto mb-3 text-ice-300" />
                                    <p className="font-bold">{t('locations.empty')}</p>
                                    <p className="text-sm">{t('locations.emptyHint')}</p>
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
                                                        <span title={t('locations.manualLinkConfigured')}><Navigation size={12} className="text-brand-primary" /></span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {loc.phone && <span className="text-sm text-graphite-500 hidden md:block">{phoneFlag(loc.phone)} {formatPhone(loc.phone)}</span>}
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
                                                country: loc.country,
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
                                <h3 className="text-xl font-black text-graphite-900">{t('insurance.title')}</h3>
                                <p className="text-sm text-graphite-400">{t('insurance.subtitle')}</p>
                            </div>
                            <button onClick={() => { setShowInsForm(true); setEditingInsId(null); setInsForm({ name: '', code: '' }); }} className="flex items-center gap-2 bg-brand-primary text-white px-4 py-2 rounded-xl font-bold hover:bg-brand-primary/90 transition-colors border-none cursor-pointer shadow-lg shadow-brand-primary/20">
                                <Plus size={18} /> {t('insurance.newInsurance')}
                            </button>
                        </div>

                        {showInsForm && (
                            <div className="border border-brand-primary/20 bg-brand-primary/5 rounded-2xl p-6 space-y-4">
                                <h4 className="font-bold text-graphite-900">{editingInsId ? t('insurance.editInsurance') : t('insurance.newInsurance')}</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-graphite-500">{t('insurance.nameLabel')}</label>
                                        <input value={insForm.name} onChange={e => setInsForm({ ...insForm, name: e.target.value })} placeholder={t('insurance.namePlaceholder')} className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-graphite-500">{t('insurance.codeLabel')}</label>
                                        <input value={insForm.code} onChange={e => setInsForm({ ...insForm, code: e.target.value })} placeholder={t('insurance.codePlaceholder')} className="w-full bg-white border border-ice-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors" />
                                    </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button onClick={() => { setShowInsForm(false); setEditingInsId(null); }} className="px-4 py-2 rounded-xl font-bold text-graphite-500 hover:bg-ice-100 transition-colors border-none cursor-pointer"><X size={16} className="inline mr-1" />{t('actions.cancel')}</button>
                                    <button onClick={handleSaveInsurance} className="px-5 py-2 rounded-xl font-bold bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors border-none cursor-pointer shadow-md"><Check size={16} className="inline mr-1" />{t('actions.save')}</button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-3">
                            {insurancePlans.length === 0 ? (
                                <div className="text-center py-12 text-graphite-400">
                                    <Shield size={48} className="mx-auto mb-3 text-ice-300" />
                                    <p className="font-bold">{t('insurance.empty')}</p>
                                    <p className="text-sm">{t('insurance.emptyHint')}</p>
                                </div>
                            ) : insurancePlans.map(plan => (
                                <div key={plan.id} className="flex items-center gap-4 p-4 border border-ice-100 rounded-2xl hover:border-brand-primary/20 hover:shadow-sm transition-all group">
                                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0"><Shield size={24} /></div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-graphite-900">{plan.name}</p>
                                        {plan.code && <p className="text-xs text-graphite-400">{t('locations.ansLabel')}: {plan.code}</p>}
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
                            <h3 className="text-xl font-black text-graphite-900">{t('communications.title')}</h3>
                            <p className="text-sm text-graphite-400 mt-1">
                                {t('communications.subtitle')}
                            </p>
                        </div>

                        {tenants.map((tenant) => (
                            <div key={tenant.id} className="space-y-6">

                                {/* PAINEL DE CARTEIRA E CONSUMO DE COMUNICAÇÕES */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {/* Card de Saldo */}
                                    <div className="md:col-span-1 bg-gradient-to-br from-brand-primary to-indigo-600 rounded-2xl p-6 text-white shadow-lg flex flex-col justify-between">
                                        <div>
                                            <p className="text-xs font-black uppercase tracking-wider text-white/70">Saldo Disponível</p>
                                            <h3 className="text-3xl font-black mt-2 font-mono">
                                                R$ {wallet?.balance_brl ? Number(wallet.balance_brl).toFixed(2) : '0.00'}
                                            </h3>
                                        </div>
                                        <div className="mt-6">
                                            <button
                                                onClick={() => setShowRechargeModal(true)}
                                                className="w-full bg-white text-indigo-600 hover:bg-ice-50 font-black text-sm px-4 py-2.5 rounded-xl border-none cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98] shadow-md flex items-center justify-center gap-1.5"
                                            >
                                                <Plus size={16} /> Adicionar Créditos
                                            </button>
                                        </div>
                                    </div>

                                    {/* Barras de Consumo */}
                                    <div className="md:col-span-2 bg-white border border-ice-100 rounded-2xl p-6 flex flex-col justify-between">
                                        <div>
                                            <h4 className="text-sm font-black text-graphite-900 mb-4 flex items-center gap-2">
                                                <Activity size={16} className="text-brand-primary" /> Consumo Acumulado
                                            </h4>
                                            
                                            <div className="space-y-4">
                                                {/* Barra Voz */}
                                                <div>
                                                    <div className="flex justify-between text-xs font-bold text-graphite-600 mb-1">
                                                        <span>Voz ({consumptionSummary.voiceMin.toFixed(1)} min)</span>
                                                        <span className="font-mono">R$ {consumptionSummary.voiceBrl.toFixed(2)}</span>
                                                    </div>
                                                    <div className="w-full bg-ice-100 h-2.5 rounded-full overflow-hidden">
                                                        <div 
                                                            className="bg-indigo-500 h-full rounded-full transition-all duration-500" 
                                                            style={{ width: `${consumptionSummary.totalBrl > 0 ? (consumptionSummary.voiceBrl / consumptionSummary.totalBrl) * 100 : 0}%` }}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Barra SMS */}
                                                <div>
                                                    <div className="flex justify-between text-xs font-bold text-graphite-600 mb-1">
                                                        <span>SMS ({consumptionSummary.smsCount} envios)</span>
                                                        <span className="font-mono">R$ {consumptionSummary.smsBrl.toFixed(2)}</span>
                                                    </div>
                                                    <div className="w-full bg-ice-100 h-2.5 rounded-full overflow-hidden">
                                                        <div 
                                                            className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                                                            style={{ width: `${consumptionSummary.totalBrl > 0 ? (consumptionSummary.smsBrl / consumptionSummary.totalBrl) * 100 : 0}%` }}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Barra Números */}
                                                <div>
                                                    <div className="flex justify-between text-xs font-bold text-graphite-600 mb-1">
                                                        <span>Números de Telefone</span>
                                                        <span className="font-mono">R$ {consumptionSummary.numbersBrl.toFixed(2)}</span>
                                                    </div>
                                                    <div className="w-full bg-ice-100 h-2.5 rounded-full overflow-hidden">
                                                        <div 
                                                            className="bg-amber-500 h-full rounded-full transition-all duration-500" 
                                                            style={{ width: `${consumptionSummary.totalBrl > 0 ? (consumptionSummary.numbersBrl / consumptionSummary.totalBrl) * 100 : 0}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* LISTA DE TRANSAÇÕES RECENTES */}
                                <div className="bg-white border border-ice-100 rounded-2xl p-6">
                                    <h4 className="text-sm font-black text-graphite-900 mb-4 flex items-center gap-2">
                                        <Clock size={16} className="text-brand-primary" /> Histórico Recente de Transações
                                    </h4>
                                    
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-ice-50 text-[10px] font-black text-graphite-400 uppercase tracking-wider">
                                                    <th className="py-2.5">Data</th>
                                                    <th className="py-2.5">Descrição</th>
                                                    <th className="py-2.5 text-center">Tipo</th>
                                                    <th className="py-2.5 text-right">Valor</th>
                                                    <th className="py-2.5 text-right">Saldo</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-ice-50 text-xs font-medium text-graphite-600">
                                                {transactions.slice(0, 5).map(tx => {
                                                    const isCredit = tx.type === 'recharge' || tx.type === 'refund' || tx.type === 'bonus';
                                                    return (
                                                        <tr key={tx.id} className="hover:bg-ice-50/50 transition-colors">
                                                            <td className="py-3">
                                                                {new Date(tx.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                            </td>
                                                            <td className="py-3 font-semibold text-graphite-800">{tx.description}</td>
                                                            <td className="py-3 text-center">
                                                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                                                    tx.type === 'recharge' ? 'bg-emerald-100 text-emerald-600' :
                                                                    tx.type === 'deduction' ? 'bg-slate-100 text-slate-600' :
                                                                    'bg-blue-100 text-blue-600'
                                                                }`}>
                                                                    {tx.type === 'recharge' ? 'Recarga' : tx.type === 'deduction' ? 'Débito' : tx.type}
                                                                </span>
                                                            </td>
                                                            <td className={`py-3 text-right font-bold font-mono ${isCredit ? 'text-emerald-500' : 'text-slate-700'}`}>
                                                                {isCredit ? '+' : '-'} R$ {Number(tx.amount_brl).toFixed(2)}
                                                            </td>
                                                            <td className="py-3 text-right font-bold font-mono text-graphite-400">
                                                                R$ {Number(tx.balance_after_brl).toFixed(2)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                                {transactions.length === 0 && (
                                                    <tr>
                                                        <td colSpan={5} className="py-6 text-center text-graphite-400 font-semibold">
                                                            Nenhuma transação registrada ainda.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Banner informativo — modelo de revendedor */}
                                <div className="flex items-start gap-3 p-4 rounded-2xl bg-blue-50 border border-blue-100">
                                    <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                                        <Phone size={16} className="text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-black text-blue-800">{t('communications.bannerTitle')}</p>
                                        <p className="text-xs text-blue-600 mt-0.5 leading-relaxed">
                                            {t('communications.bannerText')}
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
                                                    {t('communications.softphoneTitle')}
                                                </h4>
                                                <p className="text-xs text-graphite-400 mt-0.5">
                                                    {tenant.telnyx_enabled
                                                        ? t('communications.softphoneActiveHint')
                                                        : t('communications.softphoneInactiveHint')}
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
                                                { icon: Phone,        label: t('communications.featureBrowserCalls'),    sub: t('communications.featureBrowserCallsSub') },
                                                { icon: MessageSquare, label: t('communications.featureSms'),           sub: t('communications.featureSmsSub') },
                                                { icon: Voicemail,    label: t('communications.featureVoicemail'),     sub: t('communications.featureVoicemailSub') },
                                                { icon: Hash,         label: t('communications.featureMultipleNumbers'),          sub: t('communications.featureMultipleNumbersSub') },
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
                                                <h4 className="text-sm font-black text-graphite-800">{t('communications.recordCallsTitle')}</h4>
                                                <p className="text-xs text-graphite-400 mt-1">
                                                    {t('communications.recordCallsHint')}
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
                                            <label className="text-[10px] font-bold text-graphite-400">{t('communications.retentionLabel')}</label>
                                            <select
                                                defaultValue={tenant.telnyx_recording_retention_days ?? 90}
                                                onBlur={(e) => handleSaveTenant(tenant.id, { telnyx_recording_retention_days: parseInt(e.target.value) })}
                                                className="w-full mt-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
                                            >
                                                <option value={30}>{t('communications.retention30')}</option>
                                                <option value={60}>{t('communications.retention60')}</option>
                                                <option value={90}>{t('communications.retention90')}</option>
                                                <option value={180}>{t('communications.retention180')}</option>
                                                <option value={365}>{t('communications.retention365')}</option>
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
                                                {t('communications.phoneNumbersTitle')}
                                            </h4>
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={() => handleSync()}
                                                    disabled={syncing}
                                                    className="flex items-center gap-1.5 text-xs font-bold text-graphite-500 hover:text-brand-primary border-none bg-transparent cursor-pointer disabled:opacity-50"
                                                    title={t('communications.syncStatusTitle')}
                                                >
                                                    <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                                                    <span>{syncing ? t('communications.syncing') : t('communications.syncStatus')}</span>
                                                </button>
                                                <span className="text-graphite-200">|</span>
                                                <button
                                                    onClick={() => setShowBuyNumber(true)}
                                                    className="flex items-center gap-1 text-xs font-bold text-brand-primary hover:underline border-none bg-transparent cursor-pointer"
                                                >
                                                    <Plus size={12} /> {t('communications.buyNumber')}
                                                </button>
                                            </div>
                                        </div>

                                        <PhoneNumbersList tenantId={tenant.id} showToast={showToast} refreshKey={ordersRefreshKey} />

                                        <PendingOrdersList
                                            tenantId={tenant.id}
                                            refreshKey={ordersRefreshKey}
                                            onResubmit={(orderId) => {
                                                setResubmitOrderId(orderId);
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
                                                {t('communications.smsAutomationsTitle')}
                                            </h4>
                                            <p className="text-xs text-graphite-400 mt-1">
                                                {t('communications.smsAutomationsHint')}
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
                                        <label className="text-sm font-bold text-graphite-900">{t('profile.fullNameLabel')}</label>
                                        <input
                                            type="text"
                                            value={profile.full_name}
                                            onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                                            className="w-full bg-white border border-ice-200 rounded-xl px-4 py-3 font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-graphite-900">{t('profile.emailLabel')}</label>
                                        <input
                                            type="email"
                                            value={profile.email}
                                            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                                            className="w-full bg-white border border-ice-200 rounded-xl px-4 py-3 font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-graphite-900">{t('profile.roleLabel')}</label>
                                        <select
                                            value={profile.role}
                                            onChange={(e) => setProfile({ ...profile, role: e.target.value })}
                                            className="w-full bg-white border border-ice-200 rounded-xl px-4 py-3 font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all cursor-pointer"
                                        >
                                            <option value="owner">{t('profile.roleOwner')}</option>
                                            <option value="staff">{t('profile.roleStaff')}</option>
                                            <option value="doctor">{t('profile.roleDoctor')}</option>
                                            {profile.role === 'super_admin' && (
                                                <option value="super_admin">{t('profile.roleSuperAdmin')}</option>
                                            )}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-graphite-900">{t('profile.specialtyLabel')}</label>
                                        <input
                                            type="text"
                                            value={profile.specialty}
                                            onChange={(e) => setProfile({ ...profile, specialty: e.target.value })}
                                            className="w-full bg-white border border-ice-200 rounded-xl px-4 py-3 font-medium text-graphite-900 focus:outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-graphite-900">{t('profile.crmLabel')}</label>
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
                                        <span>{t('profile.saveChanges')}</span>
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
                onClose={() => {
                    setShowBuyNumber(false);
                    setResubmitOrderId(undefined);
                }}
                onPurchased={() => {
                    setOrdersRefreshKey((k) => k + 1);
                    fetchSettingsData();
                }}
                showToast={showToast}
                resubmitOrderId={resubmitOrderId}
            />
        )}

        {/* ── CONEXÃO META SELEÇÃO DE RECURSOS MODAL ───────────────────────── */}
        {metaConnectModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
                <div
                    onClick={() => setMetaConnectModal(false)}
                    className="absolute inset-0 bg-graphite-900/40 backdrop-blur-sm transition-opacity"
                />
                <div className="relative w-full max-w-md bg-white rounded-[32px] border border-ice-100 shadow-2xl p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-[#0081FB] flex items-center justify-center shrink-0">
                                <Facebook className="text-white" fill="white" size={22} />
                            </div>
                            <div>
                                <h3 className="text-base font-black text-graphite-900 tracking-tight">
                                    {t('metaConnectModal.title')}
                                </h3>
                                <p className="text-[10px] font-bold text-graphite-400">{t('metaConnectModal.subtitle')}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setMetaConnectModal(false)}
                            className="p-2 rounded-xl hover:bg-ice-50 border-none cursor-pointer transition-colors"
                        >
                            <X size={18} className="text-graphite-400" />
                        </button>
                    </div>

                    <div className="space-y-4">
                        <label className="flex items-start gap-3 p-4 rounded-2xl border-2 border-ice-100 hover:border-brand-primary/30 transition-all cursor-pointer bg-white">
                            <input
                                type="checkbox"
                                checked={metaFeatures.ads}
                                onChange={(e) => setMetaFeatures(prev => ({ ...prev, ads: e.target.checked }))}
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
                            />
                            <div>
                                <p className="font-black text-sm text-graphite-900 leading-none">{t('metaConnectModal.adsLabel')}</p>
                                <p className="text-[11px] font-bold text-graphite-400 mt-1">
                                    {t('metaConnectModal.adsHint')}
                                </p>
                            </div>
                        </label>

                        <label className="flex items-start gap-3 p-4 rounded-2xl border-2 border-ice-100 hover:border-brand-primary/30 transition-all cursor-pointer bg-white">
                            <input
                                type="checkbox"
                                checked={metaFeatures.messaging}
                                onChange={(e) => setMetaFeatures(prev => ({ ...prev, messaging: e.target.checked }))}
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
                            />
                            <div>
                                <p className="font-black text-sm text-graphite-900 leading-none">{t('metaConnectModal.messagingLabel')}</p>
                                <p className="text-[11px] font-bold text-graphite-400 mt-1">
                                    {t('metaConnectModal.messagingHint')}
                                </p>
                            </div>
                        </label>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={() => setMetaConnectModal(false)}
                            className="flex-1 py-3.5 bg-ice-50 hover:bg-ice-100 text-graphite-600 rounded-2xl font-black text-xs transition-colors border-none cursor-pointer"
                        >
                            {t('metaConnectModal.cancel')}
                        </button>
                        <button
                            disabled={!metaFeatures.ads && !metaFeatures.messaging}
                            onClick={() => {
                                const featuresStr = [
                                    metaFeatures.ads ? 'ads' : '',
                                    metaFeatures.messaging ? 'messaging' : ''
                                ].filter(Boolean).join(',');
                                openMetaMessagingOAuth(featuresStr);
                                setMetaConnectModal(false);
                            }}
                            className="flex-1 py-3.5 bg-[#0081FB] hover:bg-blue-600 text-white rounded-2xl font-black text-xs transition-colors border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {t('metaConnectModal.continueToFacebook')}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* ── Modal: Recarregar Carteira ───────────────────────────────────── */}
        {showRechargeModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12 animate-in fade-in duration-200">
                <div
                    onClick={() => setShowRechargeModal(false)}
                    className="absolute inset-0 bg-graphite-900/40 backdrop-blur-sm transition-opacity"
                />
                <div className="relative w-full max-w-md bg-white rounded-[32px] border border-ice-100 shadow-2xl p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center shrink-0">
                                <Plus size={22} className="text-indigo-600" />
                            </div>
                            <div>
                                <h3 className="text-base font-black text-graphite-900 tracking-tight">
                                    Adicionar Créditos
                                </h3>
                                <p className="text-[10px] font-bold text-graphite-400">Recarga instantânea para comunicações</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowRechargeModal(false)}
                            className="p-2 rounded-xl hover:bg-ice-50 border-none cursor-pointer transition-colors bg-transparent text-graphite-400"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    <div className="space-y-4">
                        <label className="text-xs font-bold text-graphite-500">Selecione o valor da recarga</label>
                        <div className="grid grid-cols-3 gap-3">
                            {['50', '100', '200'].map(val => (
                                <button
                                    key={val}
                                    type="button"
                                    onClick={() => setRechargeAmount(val)}
                                    className={`py-3 rounded-xl font-black text-sm cursor-pointer transition-all border ${
                                        rechargeAmount === val
                                            ? 'bg-brand-primary border-brand-primary text-white shadow-md'
                                            : 'bg-ice-50 border-ice-200 text-graphite-600 hover:bg-ice-100'
                                    }`}
                                >
                                    R$ {val}
                                </button>
                            ))}
                        </div>

                        <div className="pt-2">
                            <label className="text-xs font-bold text-graphite-500">Ou digite outro valor (R$)</label>
                            <input
                                type="number"
                                min="10"
                                value={rechargeAmount}
                                onChange={e => setRechargeAmount(e.target.value)}
                                className="w-full mt-1 bg-white border border-ice-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:border-brand-primary transition-colors font-mono"
                                placeholder="Min. R$ 10"
                            />
                        </div>
                    </div>

                    <div className="flex gap-2 justify-end pt-4 border-t border-ice-50">
                        <button
                            onClick={() => setShowRechargeModal(false)}
                            className="px-4 py-2.5 rounded-xl font-bold text-graphite-500 hover:bg-ice-100 transition-colors border-none cursor-pointer bg-transparent"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleRechargeWallet}
                            disabled={recharging}
                            className="px-6 py-2.5 rounded-xl font-bold bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors border-none cursor-pointer shadow-md flex items-center gap-1.5 disabled:opacity-60"
                        >
                            {recharging && <RefreshCw size={14} className="animate-spin" />}
                            Confirmar Recarga
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Modal de Checkout Incorporado (Stripe Embedded) */}
        {stripeClientSecret && (
            <div className="fixed inset-0 bg-graphite-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl p-6 w-full max-w-2xl shadow-2xl relative flex flex-col max-h-[90vh]">
                    <div className="flex justify-between items-center pb-4 border-b border-ice-50">
                        <h3 className="text-lg font-black text-graphite-900">Pagamento Seguro (Stripe)</h3>
                        <button
                            onClick={() => setStripeClientSecret(null)}
                            className="w-8 h-8 rounded-full border-none cursor-pointer bg-ice-50 hover:bg-ice-100 flex items-center justify-center text-graphite-500 font-bold transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto pt-4 min-h-[450px]" id="stripe-checkout-container">
                        {/* O iframe do Stripe será renderizado aqui */}
                        <div className="flex items-center justify-center h-full min-h-[400px]">
                            <RefreshCw size={24} className="animate-spin text-brand-primary" />
                        </div>
                    </div>
                </div>
            </div>
        )}
        </>
    );
};
