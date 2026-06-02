import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Mail, Lock, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';

export const LoginPage = () => {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

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
            showToast('error', 'Erro ao entrar: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-ice-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-[32px] shadow-xl p-8 md:p-12 border border-ice-100 animate-in fade-in zoom-in duration-500">
                <div className="flex justify-center mb-8">
                    <div className="w-16 h-16 bg-brand-primary rounded-2xl flex items-center justify-center text-white shadow-lg shadow-brand-primary/20">
                        <Activity size={32} />
                    </div>
                </div>

                <div className="text-center mb-8">
                    <h1 className="text-2xl font-black text-graphite-900 mb-2">Bem-vindo de volta</h1>
                    <p className="text-graphite-500 font-medium">Acesse sua conta Traffio</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-black text-graphite-400 uppercase ml-1">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400" size={20} />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-12 pr-4 py-3.5 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary transition-all"
                                placeholder="seu@email.com"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between items-center ml-1">
                            <label className="text-xs font-black text-graphite-400 uppercase">Senha</label>
                            <button
                                type="button"
                                onClick={() => navigate('/forgot-password')}
                                className="text-xs font-bold text-brand-primary hover:text-brand-secondary transition-colors border-none bg-transparent cursor-pointer"
                            >
                                Esqueceu a senha?
                            </button>
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400" size={20} />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-12 pr-4 py-3.5 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary transition-all"
                                placeholder="••••••••"
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-brand-primary text-white py-4 rounded-xl font-bold shadow-lg shadow-brand-primary/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed border-none cursor-pointer"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : (
                            <>
                                Entrar
                                <ArrowRight size={20} />
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-8 text-center">
                    <p className="text-sm font-medium text-graphite-500">
                        Não tem uma conta?{' '}
                        <button
                            onClick={() => navigate('/register')}
                            className="text-brand-primary font-bold hover:underline border-none bg-transparent cursor-pointer"
                        >
                            Criar agora
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};
