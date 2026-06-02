import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Mail, Loader2, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';

export const ForgotPasswordPage = () => {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/reset-password',
            });

            if (error) throw error;
            setSent(true);
        } catch (error: any) {
            showToast('error', 'Erro ao enviar email: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-ice-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-[32px] shadow-xl p-8 md:p-12 border border-ice-100 animate-in fade-in zoom-in duration-500">
                <button
                    onClick={() => navigate('/login')}
                    className="flex items-center gap-2 text-sm font-bold text-graphite-500 hover:text-brand-primary mb-8 transition-colors border-none bg-transparent cursor-pointer"
                >
                    <ArrowLeft size={18} />
                    Voltar
                </button>

                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-12 h-12 bg-ice-100 rounded-xl text-graphite-400 mb-4">
                        <Activity size={24} />
                    </div>
                    <h1 className="text-2xl font-black text-graphite-900 mb-2">Recuperar Senha</h1>
                    <p className="text-graphite-500 font-medium">Digite seu email para receber o link de recuperação</p>
                </div>

                {sent ? (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-6 text-center animate-in fade-in slide-in-from-bottom-2">
                        <p className="text-emerald-800 font-bold mb-2">Email enviado!</p>
                        <p className="text-sm text-emerald-600">Verifique sua caixa de entrada e spam.</p>
                        <button
                            onClick={() => navigate('/login')}
                            className="mt-4 text-emerald-700 font-bold underline hover:text-emerald-900 transition-colors border-none bg-transparent cursor-pointer"
                        >
                            Voltar para o Login
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleReset} className="space-y-6">
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

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-brand-primary text-white py-4 rounded-xl font-bold shadow-lg shadow-brand-primary/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed border-none cursor-pointer"
                        >
                            {loading ? <Loader2 className="animate-spin" size={20} /> : 'Enviar Link de Recuperação'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};
