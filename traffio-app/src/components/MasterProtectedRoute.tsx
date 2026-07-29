
import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function MasterProtectedRoute() {
    const { user, loading: authLoading } = useAuth();
    const [loading, setLoading] = useState(true);
    const [isSuperAdmin, setIsSuperAdmin] = useState(false);

    useEffect(() => {
        if (authLoading) return;
        checkUser();
    }, [authLoading, user?.id]);

    const checkUser = async () => {
        try {
            if (!user) {
                setLoading(false);
                return;
            }

            // Check profile for super_admin role
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .maybeSingle();

            console.log('🔒 [MasterProtect] Profile Check:', { id: user.id, role: profile?.role, error });

            if (profile && profile.role === 'super_admin') {
                console.log('🔒 [MasterProtect] Access GRANTED.');
                setIsSuperAdmin(true);
            } else {
                console.warn(`🔒 [MasterProtect] Access DENIED. Redirecting to /dashboard. User: ${user.email} (Role: ${profile?.role})`);
                setIsSuperAdmin(false);
            }
        } catch (error) {
            console.error('Error checking master admin:', error);
            setIsSuperAdmin(false);
        } finally {
            setLoading(false);
        }
    };

    if (authLoading || loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-ice-50">
                <Loader2 className="w-10 h-10 text-brand-primary animate-spin" />
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (!isSuperAdmin) {
        // Redirect unauthorized users (e.g., normal tenants) to their dashboard
        return <Navigate to="/dashboard" replace />;
    }

    return <Outlet />;
}
