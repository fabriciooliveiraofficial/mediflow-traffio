import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
    session: null,
    user: null,
    loading: true,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let settled = false;

        const finish = (s: Session | null) => {
            if (settled) return;
            settled = true;
            setSession(s);
            setLoading(false);
        };

        // Safety timeout: if getSession hangs (e.g. network offline / ERR_NAME_NOT_RESOLVED),
        // unblock the UI after 3s so the app renders (user is treated as logged out).
        const timeout = setTimeout(() => finish(null), 3000);

        // Single auth call — avoids Navigator Lock contention from multiple contexts
        supabase.auth.getSession()
            .then(({ data: { session } }) => {
                clearTimeout(timeout);
                finish(session);
            })
            .catch(() => {
                clearTimeout(timeout);
                finish(null);
            });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            clearTimeout(timeout);
            setSession(session);
            setLoading(false);
        });

        return () => {
            clearTimeout(timeout);
            subscription.unsubscribe();
        };
    }, []);

    return (
        <AuthContext.Provider value={{ session, user: session?.user ?? null, loading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
