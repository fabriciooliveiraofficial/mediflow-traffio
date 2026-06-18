import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { usePortalTenant } from '../hooks/usePortalTenant';
import {
    LayoutDashboard,
    Calendar,
    User,
    LogOut,
    Menu,
    X
} from 'lucide-react';

export function PatientPortalLayout() {
    const { t } = useTranslation('portal');
    const { tenant, loading: tenantLoading, slug } = usePortalTenant();
    const navigate = useNavigate();
    const location = useLocation();
    const [session, setSession] = useState<any>(null);
    const [patient, setPatient] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        if (tenantLoading) return;
        if (!tenant) {
            setLoading(false);
            return;
        }

        async function checkAuth() {
            const { data: { session } } = await supabase.auth.getSession();

            if (!session) {
                navigate(`/portal/${slug}/login`);
                return;
            }

            setSession(session);

            // Verify Patient Membership
            const { data: patientData, error } = await supabase
                .from('patients')
                .select('*')
                .eq('tenant_id', tenant.id)
                .eq('user_id', session.user.id)
                .single();

            if (error || !patientData) {
                console.warn('User authenticated but not a patient of this tenant');
                // Redirect to login which has "Join" logic or distinct page
                // For now, redirect to login to handle "Join" flow
                navigate(`/portal/${slug}/login`);
                return;
            }

            setPatient(patientData);
            setLoading(false);
        }

        checkAuth();
    }, [tenant, tenantLoading, slug, navigate]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate(`/portal/${slug}/login`);
    };

    if (loading || tenantLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!tenant || !patient) return null;

    const navItems = [
        { icon: LayoutDashboard, label: t('nav.home'), path: `/portal/${slug}/dashboard` },
        { icon: Calendar, label: t('nav.book'), path: `/portal/${slug}/book` },
        { icon: User, label: t('nav.myProfile'), path: `/portal/${slug}/profile` },
    ];

    return (
        <div className="min-h-screen bg-gray-50 flex font-sans">
            {/* Mobile Header */}
            <div className="lg:hidden fixed top-0 w-full bg-white shadow-sm z-20 px-4 py-3 flex justify-between items-center">
                {tenant.logo_url && <img src={tenant.logo_url} className="h-8" alt={tenant.name} />}
                <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                    {mobileMenuOpen ? <X /> : <Menu />}
                </button>
            </div>

            {/* Sidebar */}
            <aside className={`
        fixed lg:static inset-y-0 left-0 z-10 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
                <div className="h-full flex flex-col">
                    {/* Tenant Logo */}
                    <div className="p-6 border-b border-gray-100 hidden lg:block">
                        {tenant.logo_url ? (
                            <img src={tenant.logo_url} alt={tenant.name} className="h-10 object-contain" />
                        ) : (
                            <h2 className="text-xl font-bold text-gray-800">{tenant.name}</h2>
                        )}
                    </div>

                    {/* User Info */}
                    <div className="p-4 bg-gray-50 border-b border-gray-100">
                        <p className="text-sm font-medium text-gray-900 truncate">{patient.full_name}</p>
                        <p className="text-xs text-gray-500 truncate">{patient.email}</p>
                    </div>

                    {/* Nav */}
                    <nav className="flex-1 p-4 space-y-1">
                        {navItems.map(item => {
                            const isActive = location.pathname === item.path;
                            return (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                        }`}
                                    style={isActive ? { color: tenant.color_primary, backgroundColor: `${tenant.color_primary}1A` } : {}}
                                    onClick={() => setMobileMenuOpen(false)}
                                >
                                    <item.icon size={18} />
                                    {item.label}
                                </Link>
                            )
                        })}
                    </nav>

                    {/* Footer */}
                    <div className="p-4 border-t border-gray-100">
                        <button
                            onClick={handleSignOut}
                            className="flex items-center gap-3 px-3 py-2 w-full text-left text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                            <LogOut size={18} />
                            {t('nav.signOut')}
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 p-4 lg:p-8 pt-20 lg:pt-8 overflow-y-auto">
                <Outlet context={{ tenant, patient }} />
            </main>

            {/* Mobile Backdrop */}
            {mobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/20 z-0 lg:hidden"
                    onClick={() => setMobileMenuOpen(false)}
                />
            )}
        </div>
    );
}
