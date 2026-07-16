import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, Lock, Loader2, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';

export const LoginPage = () => {
    const { t } = useTranslation('auth');
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        const checkAndSignOut = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                // Silently log out existing user if they explicitly navigated to /login
                await supabase.auth.signOut();
            }
        };
        checkAndSignOut();
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) throw error;

            // 1. Get session manually if needed, but signIn returns session usually
            const { data: { session: currentSession } } = await supabase.auth.getSession();

            if (currentSession?.user) {
                // Remove o token antigo para forçar a geração de um novo token de sessão (Last Login Wins)
                localStorage.removeItem('traffio_session_token');

                // 2. Check Role
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', currentSession.user.id)
                    .single();

                if (profile?.role === 'super_admin') {
                    navigate('/master/dashboard');
                } else {
                    navigate('/dashboard');
                }
            } else {
                navigate('/dashboard');
            }
        } catch (error: any) {
            showToast('error', t('login.errors.generic', { message: error.message }));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-ice-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-[32px] shadow-xl p-8 md:p-12 border border-ice-100 animate-in fade-in zoom-in duration-500">
                <div className="flex justify-center mb-8">
                    <img src="/logo_dark.png" alt="Traffio" className="w-16 h-16 rounded-2xl object-cover" />
                </div>

                <div className="text-center mb-8">
                    <h1 className="text-2xl font-black text-graphite-900 mb-2">{t('login.title')}</h1>
                    <p className="text-graphite-500 font-medium">{t('login.subtitle')}</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-black text-graphite-400 uppercase ml-1">{t('login.email')}</label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400" size={20} />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-12 pr-4 py-3.5 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary transition-all"
                                placeholder={t('login.emailPlaceholder')}
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between items-center ml-1">
                            <label className="text-xs font-black text-graphite-400 uppercase">{t('login.password')}</label>
                            <button
                                type="button"
                                onClick={() => navigate('/forgot-password')}
                                className="text-xs font-bold text-brand-primary hover:text-brand-secondary transition-colors border-none bg-transparent cursor-pointer"
                            >
                                {t('login.forgotPassword')}
                            </button>
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400" size={20} />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-12 pr-12 py-3.5 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary transition-all"
                                placeholder={t('login.passwordPlaceholder')}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-graphite-400 hover:text-graphite-600 transition-colors focus:outline-none bg-transparent border-none cursor-pointer"
                            >
                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-brand-primary text-white py-4 rounded-xl font-bold shadow-lg shadow-brand-primary/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed border-none cursor-pointer"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : (
                            <>
                                {t('login.submit')}
                                <ArrowRight size={20} />
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-8 text-center">
                    <p className="text-sm font-medium text-graphite-500">
                        {t('login.noAccount')}{' '}
                        <button
                            onClick={() => navigate('/register')}
                            className="text-brand-primary font-bold hover:underline border-none bg-transparent cursor-pointer"
                        >
                            {t('login.createAccount')}
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};
