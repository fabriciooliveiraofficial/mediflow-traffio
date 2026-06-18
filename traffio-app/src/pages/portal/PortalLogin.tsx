import React, { useState } from 'react';
import { useOutletContext, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react';

export function PortalLogin() {
    // @ts-ignore
    const { tenant } = useOutletContext<{ tenant: any }>();
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        email: '',
        password: ''
    });
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [status, setStatus] = useState<'idle' | 'checking_membership' | 'joining'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [needsToJoin, setNeedsToJoin] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    const checkMembershipAndRedirect = async (uid: string) => {
        setStatus('checking_membership');
        try {
            const { data: patient, error } = await supabase
                .from('patients')
                .select('id')
                .eq('tenant_id', tenant.id)
                .eq('user_id', uid)
                .single();

            if (patient) {
                navigate(`/portal/${tenant.slug}/dashboard`);
            } else {
                setUserId(uid);
                setNeedsToJoin(true);
                setStatus('idle');
            }
        } catch (err) {
            setUserId(uid);
            setNeedsToJoin(true);
            setStatus('idle');
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: formData.email,
                password: formData.password
            });

            if (error) throw error;
            if (data.user) {
                await checkMembershipAndRedirect(data.user.id);
            }
        } catch (err: any) {
            console.error(err);
            setError('E-mail ou senha incorretos.');
        } finally {
            setLoading(false);
        }
    };

    const handleJoinClinic = async () => {
        if (!userId) return;
        setStatus('joining');
        try {
            const { data: user } = await supabase.auth.getUser();
            const metadata = user.user?.user_metadata || {};

            const { error } = await supabase.from('patients').insert({
                tenant_id: tenant.id,
                user_id: userId,
                full_name: metadata.full_name || 'Paciente',
                email: user.user?.email,
                phone: metadata.phone || null,
                cpf: metadata.cpf || null,
                national_id: metadata.national_id || null,
                national_id_type: metadata.national_id_type || null,
                country: metadata.country || null
            });

            if (error) throw error;
            navigate(`/portal/${tenant.slug}/dashboard`);
        } catch (err: any) {
            console.error('Join error:', err);
            setError('Erro ao vincular à clínica: ' + err.message);
            setStatus('idle');
        }
    };

    if (needsToJoin) {
        return (
            <div className="text-center space-y-6">
                <div className="p-4 bg-yellow-50 rounded-xl border border-yellow-200 text-yellow-800 bg-opacity-50">
                    <p className="font-semibold text-lg">Você já tem uma conta!</p>
                    <p className="text-sm mt-1 opacity-90">Mas ainda não está vinculado a <strong>{tenant.name}</strong>.</p>
                </div>

                <button
                    onClick={handleJoinClinic}
                    disabled={status === 'joining'}
                    className="w-full py-3.5 px-4 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
                    style={{ backgroundColor: tenant.color_primary }}
                >
                    {status === 'joining' ? 'Vinculando...' : 'Entrar nesta Clínica'}
                </button>

                <button
                    onClick={() => {
                        supabase.auth.signOut();
                        setNeedsToJoin(false);
                        setFormData({ email: '', password: '' });
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700 font-medium"
                >
                    Sair e usar outra conta
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-8 font-sans">
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-gray-900">Acesse sua conta</h2>
                <p className="text-gray-500">Gerencie seus agendamentos de forma simples</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
                {error && (
                    <div className="p-4 bg-red-50 text-red-700 text-sm rounded-xl border border-red-100 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                        {error}
                    </div>
                )}

                <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Email</label>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <Mail className="h-5 w-5 text-gray-400 group-focus-within:text-primary transition-colors" style={{ color: undefined }} />
                            {/* Note: In real implementation we might want to apply tenant color to icon on focus, but standard gray is cleaner for input icons */}
                        </div>
                        <input
                            type="email"
                            required
                            className="block w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                            style={{ '--tw-ring-color': tenant.color_primary, borderColor: undefined } as any}
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            placeholder="seu@email.com"
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <div className="flex justify-between items-center ml-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Senha</label>
                        <Link to="#" className="text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors">Esqueceu?</Link>
                    </div>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-primary transition-colors" />
                        </div>
                        <input
                            type={showPassword ? "text" : "password"}
                            required
                            className="block w-full pl-11 pr-11 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                            style={{ '--tw-ring-color': tenant.color_primary } as any}
                            value={formData.password}
                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                            placeholder="••••••"
                        />
                        <button
                            type="button"
                            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-400 hover:text-gray-600 transition-colors focus:outline-none"
                            onClick={() => setShowPassword(!showPassword)}
                        >
                            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 px-4 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none flex items-center justify-center gap-2"
                    style={{ backgroundColor: tenant.color_primary }}
                >
                    {loading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>
                            <span>Entrar</span>
                        </>
                    )}
                </button>
            </form>

            <div className="text-center pt-2">
                <p className="text-sm text-gray-600">
                    Não tem uma conta?{' '}
                    <Link
                        to={`/portal/${tenant.slug}/register`}
                        className="font-bold hover:underline"
                        style={{ color: tenant.color_primary }}
                    >
                        Criar conta
                    </Link>
                </p>
            </div>
        </div>
    );
}
