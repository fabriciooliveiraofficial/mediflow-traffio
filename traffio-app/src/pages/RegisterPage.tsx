import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Mail, Lock, Loader2, User, Building2, Phone, CheckCircle2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const RegisterPage = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1); // 1: Form, 2: Provisioning
    const [provisioningStatus, setProvisioningStatus] = useState<string[]>([]);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [registerError, setRegisterError] = useState<string | null>(null);

    const [form, setForm] = useState({
        clinicName: '',
        adminName: '',
        phone: '',
        email: '',
        password: '',
        confirmPassword: '',
    });

    const [errors, setErrors] = useState({
        email: '',
        password: '',
    });

    const validateForm = () => {
        let valid = true;
        const newErrors = { email: '', password: '' };

        if (form.password !== form.confirmPassword) {
            newErrors.password = 'As senhas não conferem.';
            valid = false;
        } else if (form.password.length < 6) {
            newErrors.password = 'A senha deve ter no mínimo 6 caracteres.';
            valid = false;
        }

        setErrors(newErrors);
        return valid;
    };

    const addStep = (msg: string) => setProvisioningStatus(prev => [...prev, msg]);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;

        setLoading(true);
        setStep(2);

        try {
            // ── 1. Criar auth user ───────────────────────────────────────────
            addStep('Criando sua conta...');
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: form.email,
                password: form.password,
                options: {
                    data: {
                        full_name: form.adminName,
                        clinic_name: form.clinicName,
                        phone: form.phone,
                        role: 'owner'
                    }
                }
            });
            if (authError) throw authError;

            const userId = authData.user?.id;
            if (!userId) throw new Error('Usuário não criado corretamente.');

            // ── 2. Aguardar trigger criar o profile ──────────────────────────
            addStep('Configurando perfil...');
            await new Promise(r => setTimeout(r, 1000));

            // Garantir profile com dados corretos
            await supabase.from('profiles').upsert({
                id:        userId,
                full_name: form.adminName,
                email:     form.email.toLowerCase(),
                phone:     form.phone || null,
                role:      'owner',
            }, { onConflict: 'id' });

            // ── 3. Criar tenant ──────────────────────────────────────────────
            addStep('Criando sua clínica...');
            const slug = form.clinicName
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');

            const { data: tenantData, error: tenantError } = await supabase
                .from('tenants')
                .insert({
                    name:     form.clinicName,
                    slug:     `${slug}-${Date.now().toString(36)}`,
                    specialty: [],
                })
                .select()
                .single();

            if (tenantError) throw tenantError;

            // ── 4. Criar member como owner ───────────────────────────────────
            addStep('Configurando permissões de proprietário...');
            const { error: memberError } = await supabase
                .from('members')
                .insert({
                    tenant_id: tenantData.id,
                    user_id:   userId,
                    role:      'owner',
                    is_active: true,
                });
            if (memberError) throw memberError;

            // ── 5. Finalizar ─────────────────────────────────────────────────
            addStep('Finalizando... quase lá!');
            await new Promise(r => setTimeout(r, 600));

            addStep('✅ Tudo pronto! Redirecionando...');
            setTimeout(() => navigate('/dashboard'), 1200);

        } catch (error: any) {
            setRegisterError(error.message || 'Erro ao criar conta. Tente novamente.');
            setStep(1);
            setProvisioningStatus([]);
            setLoading(false);
        }
    };

    if (step === 2) {
        return (
            <div className="min-h-screen bg-ice-50 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white rounded-[32px] shadow-xl p-8 md:p-12 border border-ice-100 text-center">
                    <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                        <Activity size={40} />
                    </div>
                    <h2 className="text-2xl font-black text-graphite-900 mb-6">Preparando seu ambiente...</h2>
                    <div className="space-y-4 text-left">
                        {provisioningStatus.map((status, i) => (
                            <div key={i} className="flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-300">
                                <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                                <span className="text-sm font-medium text-graphite-600">{status}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-ice-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-[32px] shadow-xl p-8 md:p-12 border border-ice-100 animate-in fade-in zoom-in duration-500">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-primary rounded-xl text-white shadow-lg shadow-brand-primary/20 mb-4">
                        <Activity size={24} />
                    </div>
                    <h1 className="text-2xl font-black text-graphite-900 mb-2">Crie sua conta</h1>
                    <p className="text-graphite-500 font-medium">Comece a transformar sua clínica hoje</p>
                </div>

                <form onSubmit={handleRegister} className="space-y-4">
                    {/* Toast de Erro */}
                    {registerError && (
                        <div className="bg-rose-50 text-rose-600 p-4 rounded-xl flex items-start gap-3 text-sm font-medium animate-in fade-in slide-in-from-top-2">
                            <AlertCircle size={18} className="shrink-0 mt-0.5" />
                            <span className="flex-1">{registerError}</span>
                            <button
                                type="button"
                                onClick={() => setRegisterError(null)}
                                className="text-rose-400 hover:text-rose-600 transition-colors bg-transparent border-none cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>
                    )}
                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">Nome da Clínica</label>
                            <div className="relative">
                                <Building2 className="absolute left-4 top-3.5 text-graphite-400" size={18} />
                                <input
                                    type="text"
                                    value={form.clinicName}
                                    onChange={(e) => setForm({ ...form, clinicName: e.target.value })}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary"
                                    placeholder="Ex: Clínica Saúde"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">Seu Nome</label>
                            <div className="relative">
                                <User className="absolute left-4 top-3.5 text-graphite-400" size={18} />
                                <input
                                    type="text"
                                    value={form.adminName}
                                    onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary"
                                    placeholder="Ex: Dr. Silva"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">WhatsApp</label>
                            <div className="relative">
                                <Phone className="absolute left-4 top-3.5 text-graphite-400" size={18} />
                                <input
                                    type="tel"
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary"
                                    placeholder="(11) 99999-9999"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">Email</label>
                            <div className="relative">
                                <Mail className="absolute left-4 top-3.5 text-graphite-400" size={18} />
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => {
                                        setForm({ ...form, email: e.target.value });
                                        if (errors.email) setErrors({ ...errors, email: '' });
                                    }}
                                    className={`w-full bg-ice-50 border rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary ${errors.email ? 'border-red-300 bg-red-50' : 'border-ice-200'}`}
                                    placeholder="seu@email.com"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">Senha</label>
                            <div className="relative">
                                <Lock className="absolute left-4 top-3.5 text-graphite-400" size={18} />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={form.password}
                                    onChange={(e) => {
                                        setForm({ ...form, password: e.target.value });
                                        if (errors.password) setErrors({ ...errors, password: '' });
                                    }}
                                    className={`w-full bg-ice-50 border rounded-xl pl-11 pr-12 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary ${errors.password ? 'border-red-300 bg-red-50' : 'border-ice-200'}`}
                                    placeholder="No mínimo 6 caracteres"
                                    required
                                    minLength={6}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-3.5 text-graphite-400 hover:text-brand-primary transition-colors bg-transparent border-none cursor-pointer"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">Confirmar Senha</label>
                            <div className="relative">
                                <Lock className="absolute left-4 top-3.5 text-graphite-400" size={18} />
                                <input
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    value={form.confirmPassword}
                                    onChange={(e) => {
                                        setForm({ ...form, confirmPassword: e.target.value });
                                        if (errors.password) setErrors({ ...errors, password: '' });
                                    }}
                                    className={`w-full bg-ice-50 border rounded-xl pl-11 pr-12 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary ${errors.password ? 'border-red-300 bg-red-50' : 'border-ice-200'}`}
                                    placeholder="Repita sua senha"
                                    required
                                    minLength={6}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-4 top-3.5 text-graphite-400 hover:text-brand-primary transition-colors bg-transparent border-none cursor-pointer"
                                    tabIndex={-1}
                                >
                                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            {errors.password && (
                                <p className="text-[10px] text-red-500 font-bold flex items-center gap-1 ml-1 animate-in fade-in slide-in-from-top-1">
                                    <AlertCircle size={10} /> {errors.password}
                                </p>
                            )}
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full mt-4 bg-brand-primary text-white py-4 rounded-xl font-bold shadow-lg shadow-brand-primary/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed border-none cursor-pointer"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : 'Criar Conta'}
                    </button>
                </form>

                <div className="mt-8 text-center">
                    <p className="text-sm font-medium text-graphite-500">
                        Já tem uma conta?{' '}
                        <button
                            onClick={() => navigate('/login')}
                            className="text-brand-primary font-bold hover:underline border-none bg-transparent cursor-pointer"
                        >
                            Entrar
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};
