import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import type { PlanId, SubscriptionStatus, BillingCycle } from '../config/planConfig';
import type { CountryCode } from '../lib/i18n/countryFormats';
import { useApplyDefaultLanguage } from '../hooks/useLang';

interface Tenant {
    id: string;
    name: string;
    slug: string;
    specialty: string[];
    settings: any;
    timezone: string;
    country?: CountryCode;
    locale?: string;
    time_format?: '12h' | '24h' | null;
    whatsapp_provider?: 'zapi' | 'cloud_api';
    zapi_instance_id?: string;
    zapi_token?: string;
    zapi_client_token?: string;
    cloud_api_phone_number_id?: string;
    cloud_api_access_token?: string;
    cloud_api_business_account_id?: string;
    whatsapp_status?: string;
    whatsapp_phone?: string;
    // Assinatura
    plan: PlanId;
    subscription_status: SubscriptionStatus;
    billing_cycle: BillingCycle;
    subscription_started_at: string | null;
    subscription_renews_at: string | null;
    trial_ends_at: string | null;
    card_on_file: boolean;
    admin_granted_trial: boolean;
    // SMTP (SMTP próprio)
    smtp_host?: string;
    smtp_port?: number;
    smtp_user?: string;
    smtp_pass?: string;
    smtp_from?: string;
    color_primary?: string;
    bot_config?: any;
}

export interface UserProfile {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
    role: string;
    preferred_locale?: string | null;
}

interface TenantContextType {
    tenant: Tenant | null;
    userRole: string;          // role do usuário logado no tenant atual
    userProfile: UserProfile | null;
    loading: boolean;
    refresh: (user?: any, showLoading?: boolean) => Promise<void>;
    updateTenant: (updates: Partial<Tenant>) => Promise<void>;
}

export const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, loading: authLoading } = useAuth();
    const [tenant, setTenant] = useState<Tenant | null>(() => {
        const cached = localStorage.getItem('traffio_tenant');
        return cached ? JSON.parse(cached) : null;
    });
    const [userRole, setUserRole]       = useState<string>(() => {
        return localStorage.getItem('traffio_user_role') ?? '';
    });
    const [userProfile, setUserProfile] = useState<UserProfile | null>(() => {
        const cached = localStorage.getItem('traffio_user_profile');
        return cached ? JSON.parse(cached) : null;
    });

    const [loading, setLoading] = useState(!localStorage.getItem('traffio_tenant'));

    const fetchTenant = async (currentUser = user, showLoading = false) => {
        try {
            if (showLoading) setLoading(true);

            if (!currentUser) {
                setTenant(null);
                setUserRole('');
                setUserProfile(null);
                setLoading(false);
                return;
            }

            // Buscar member + role
            const { data: memberData, error: memberError } = await supabase
                .from('members')
                .select('tenant_id, role')
                .eq('user_id', currentUser.id)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();

            if (memberError) {
                console.error('Error fetching member data:', memberError);
                setTenant(null);
                return;
            }

            if (memberData) {
                // Salvar role
                const role = memberData.role as string;
                setUserRole(role);
                localStorage.setItem('traffio_user_role', role);

                // Buscar tenant
                const { data: tenantData, error: tenantError } = await supabase
                    .from('tenants')
                    .select('*')
                    .eq('id', memberData.tenant_id)
                    .single();

                if (tenantError) {
                    console.error('Error fetching tenant data:', tenantError);
                } else {
                    const newTenant = tenantData as Tenant;
                    setTenant(newTenant);
                    localStorage.setItem('traffio_tenant', JSON.stringify(newTenant));
                }

                // Buscar profile
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('id, full_name, email, avatar_url, role, preferred_locale')
                    .eq('id', currentUser.id)
                    .maybeSingle();

                if (profileData) {
                    const profile: UserProfile = {
                        id:         profileData.id,
                        full_name:  profileData.full_name,
                        email:      profileData.email,
                        avatar_url: profileData.avatar_url,
                        role,
                        preferred_locale: profileData.preferred_locale,
                    };
                    setUserProfile(profile);
                    localStorage.setItem('traffio_user_profile', JSON.stringify(profile));
                }
            } else {
                // Sem member — pode ser super_admin sem tenant
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('id, full_name, email, avatar_url, role')
                    .eq('id', currentUser.id)
                    .maybeSingle();

                if (profileData?.role === 'super_admin') {
                    setUserRole('super_admin');
                    localStorage.setItem('traffio_user_role', 'super_admin');
                } else {
                    setUserRole('');
                }

                setTenant(null);
                localStorage.removeItem('traffio_tenant');
            }
        } catch (error) {
            console.error('Error in fetchTenant:', error);
        } finally {
            setLoading(false);
        }
    };

    const updateTenant = async (updates: Partial<Tenant>) => {
        if (!tenant) return;
        try {
            const { error } = await supabase
                .from('tenants')
                .update(updates)
                .eq('id', tenant.id);

            if (error) throw error;
            setTenant(prev => {
                const updated = prev ? { ...prev, ...updates } : null;
                if (updated) {
                    localStorage.setItem('traffio_tenant', JSON.stringify(updated));
                }
                return updated;
            });
        } catch (error) {
            console.error('Error updating tenant:', error);
            throw error;
        }
    };

    // React to auth state changes via AuthContext (no direct Supabase auth calls)
    useEffect(() => {
        if (authLoading) return;

        if (user) {
            fetchTenant(user, true);
        } else {
            setTenant(null);
            setUserRole('');
            setUserProfile(null);
            localStorage.removeItem('traffio_tenant');
            localStorage.removeItem('traffio_user_role');
            localStorage.removeItem('traffio_user_profile');
            setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, authLoading]);

    // Idioma padrão da equipe: localStorage (já aplicado no boot) > userProfile.preferred_locale > tenant.country
    useApplyDefaultLanguage({
        userPreferredLocale: userProfile?.preferred_locale,
        tenantCountry: tenant?.country,
    });

    // Apply custom brand primary color dynamically to Tailwind v4 variable mapping
    useEffect(() => {
        if (tenant?.color_primary) {
            document.documentElement.style.setProperty('--color-brand-primary', tenant.color_primary);
        } else {
            document.documentElement.style.removeProperty('--color-brand-primary');
        }
    }, [tenant?.color_primary]);

    return (
        <TenantContext.Provider value={{ tenant, userRole, userProfile, loading, refresh: fetchTenant, updateTenant }}>
            {children}
        </TenantContext.Provider>
    );
};

export const useTenant = () => {
    const context = useContext(TenantContext);
    if (context === undefined) {
        throw new Error('useTenant must be used within a TenantProvider');
    }
    return context;
};
