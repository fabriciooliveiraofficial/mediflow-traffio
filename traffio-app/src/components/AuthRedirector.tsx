import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export const AuthRedirector = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, loading } = useAuth();

    useEffect(() => {
        if (loading) return;

        const checkUserAndRedirect = async () => {
            if (user) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', user.id)
                    .maybeSingle();

                const role = profile?.role || user.user_metadata?.role || user.app_metadata?.role;
                const path = location.pathname;

                // 1. Super Admin Redirection Rules
                if (role === 'super_admin') {
                    // Prevent access to standard dashboard, redirect to master
                    if (path.startsWith('/dashboard') || path === '/') {
                        console.log('🛡️ [AuthRedirector] Super Admin detected on wrong route. Redirecting to Master...');
                        navigate('/master/dashboard', { replace: true });
                    }
                }
                // 2. Tenant Staff (Owner, Admin, Doctor, Staff) Redirection Rules
                else if (role === 'owner' || role === 'admin' || role === 'doctor' || role === 'staff') {
                    // Prevent access to master dashboard
                    if (path.startsWith('/master')) {
                        console.warn('🛡️ [AuthRedirector] Unauthorized access to Master. Redirecting to Tenant Dashboard...');
                        navigate('/dashboard', { replace: true });
                    }
                    // Redirect from root to dashboard if logged in
                    if (path === '/') {
                        navigate('/dashboard', { replace: true });
                    }
                }
                // 3. Patient Redirection Rules
                else if (role === 'patient') {
                    // Prevent access to master dashboard OR tenant dashboard
                    if (path.startsWith('/master') || path.startsWith('/dashboard')) {
                        console.warn('🛡️ [AuthRedirector] Patient attempted to access Staff area. Redirecting to Root...');
                        navigate('/', { replace: true });
                    }
                }
            } else {
                // Not logged in
                // If trying to access protected routes, letting the route guards handle it
                // But for root, we might want to stay on landing page
            }
        };

        checkUserAndRedirect();
    }, [navigate, location.pathname, user, loading]);

    return null; // This component does not render anything
};
