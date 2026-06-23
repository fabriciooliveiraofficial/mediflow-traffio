import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, Mail, Lock, Loader2, User, Building2, Phone, CheckCircle2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PLANS, PLAN_ORDER, formatPrice, type PlanId, type BillingCycle } from '../config/planConfig';
import { PaymentRequiredModal } from '../components/billing/PaymentRequiredModal';

export const RegisterPage = () => {
    const { t } = useTranslation(['auth', 'billing']);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Plano e ciclo vindos da Landing (?plan=&cycle=) — default: essencial/mensal
    const planParam = searchParams.get('plan');
    const cycleParam = searchParams.get('cycle');
    const selectedPlanId: PlanId = (PLAN_ORDER as string[]).includes(planParam ?? '') ? (planParam as PlanId) : 'essencial';
    const billingCycle: BillingCycle = cycleParam === 'annual' ? 'annual' : 'monthly';
    const selectedPlan = PLANS[selectedPlanId];
    const selectedPrice = billingCycle === 'annual' ? selectedPlan.annualMonthlyPrice : selectedPlan.monthlyPrice;
    const PlanIcon = selectedPlan.icon;

    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1); // 1: Form, 2: Provisioning, 3: Payment
    const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
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
            newErrors.password = t('register.errors.passwordMismatch');
            valid = false;
        } else if (form.password.length < 6) {
            newErrors.password = t('register.errors.passwordTooShort');
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

        // ── 0. Capturar lead SEMPRE (fire-and-forget, antes do provisionamento)
        // Mesmo que o cliente desista no meio, os dados de contato ficam
        // registrados para remarketing (registration_leads + e-mail).
        supabase.functions.invoke('register-lead', {
            body: {
                clinic_name:   form.clinicName,
                admin_name:    form.adminName,
                email:         form.email,
                phone:         form.phone,
                plan_id:       selectedPlanId,
                billing_cycle: billingCycle,
            },
        }).catch(err => console.error('[register-lead] falha na captura do lead:', err));

        try {
            // ── 1. Criar auth user ───────────────────────────────────────────
            addStep(t('register.provisioning.creatingAccount'));
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
            if (!userId) throw new Error(t('register.errors.userNotCreated'));

            // ── 2. Aguardar trigger criar o profile ──────────────────────────
            addStep(t('register.provisioning.settingUpProfile'));
            await new Promise(r => setTimeout(r, 1000));

            // Garantir profile com dados corretos
            await supabase.from('profiles').upsert({
                id:        userId,
                full_name: form.adminName,
                email:     form.email.toLowerCase(),
                phone:     form.phone || null,
                role:      'owner',
            }, { onConflict: 'id' });

            // ── 3. Criar tenant + member owner (RPC, bypassa RLS) ─────────────
            addStep(t('register.provisioning.creatingClinic'));
            const slug = form.clinicName
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');

            addStep(t('register.provisioning.settingUpPermissions'));
            const { data: tenantData, error: tenantError } = await supabase
                .rpc('register_tenant', {
                    p_name:          form.clinicName,
                    p_slug:          `${slug}-${Date.now().toString(36)}`,
                    p_plan:          selectedPlanId,
                    p_billing_cycle: billingCycle,
                });

            if (tenantError) throw tenantError;

            // ── 5. Finalizar → modal de pagamento (NÃO vai direto ao dashboard)
            addStep(t('register.provisioning.finalizing'));
            await new Promise(r => setTimeout(r, 600));

            addStep(t('register.provisioning.done'));
            setTrialEndsAt(tenantData.trial_ends_at ?? null);
            setTimeout(() => setStep(3), 1200);

        } catch (error: any) {
            setRegisterError(error.message || t('register.errors.generic'));
            setStep(1);
            setProvisioningStatus([]);
            setLoading(false);
        }
    };

    if (step === 3) {
        return (
            <div className="min-h-screen bg-ice-50">
                <PaymentRequiredModal
                    planId={selectedPlanId}
                    billingCycle={billingCycle}
                    trialEndsAt={trialEndsAt}
                />
            </div>
        );
    }

    if (step === 2) {
        return (
            <div className="min-h-screen bg-ice-50 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white rounded-[32px] shadow-xl p-8 md:p-12 border border-ice-100 text-center">
                    <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                        <Activity size={40} />
                    </div>
                    <h2 className="text-2xl font-black text-graphite-900 mb-6">{t('register.provisioning.title')}</h2>
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
                    <h1 className="text-2xl font-black text-graphite-900 mb-2">{t('register.title')}</h1>
                    <p className="text-graphite-500 font-medium">{t('register.subtitle')}</p>
                </div>

                <div className="mb-6 flex items-center justify-between gap-3 p-4 rounded-2xl border border-ice-200 bg-ice-50">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${selectedPlan.badgeClass}`}>
                            <PlanIcon size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wider">{t('register.selectedPlanLabel')}</p>
                            <p className="text-sm font-black text-graphite-900">{t(`plans.${selectedPlanId}.name`, { ns: 'billing' })} · {billingCycle === 'annual' ? t('register.billingAnnual') : t('register.billingMonthly')}</p>
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        <p className="text-lg font-black text-graphite-900">{formatPrice(selectedPrice)}<span className="text-xs font-medium text-graphite-400">{t('register.perMonth')}</span></p>
                    </div>
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
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">{t('register.clinicName')}</label>
                            <div className="relative">
                                <Building2 className="absolute left-4 top-3.5 text-graphite-400" size={18} />
                                <input
                                    type="text"
                                    value={form.clinicName}
                                    onChange={(e) => setForm({ ...form, clinicName: e.target.value })}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary"
                                    placeholder={t('register.clinicNamePlaceholder')}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">{t('register.adminName')}</label>
                            <div className="relative">
                                <User className="absolute left-4 top-3.5 text-graphite-400" size={18} />
                                <input
                                    type="text"
                                    value={form.adminName}
                                    onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary"
                                    placeholder={t('register.adminNamePlaceholder')}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">{t('register.phone')}</label>
                            <div className="relative">
                                <Phone className="absolute left-4 top-3.5 text-graphite-400" size={18} />
                                <input
                                    type="tel"
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                    className="w-full bg-ice-50 border border-ice-200 rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-graphite-900 focus:outline-none focus:border-brand-primary"
                                    placeholder={t('register.phonePlaceholder')}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">{t('register.email')}</label>
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
                                    placeholder={t('register.emailPlaceholder')}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">{t('register.password')}</label>
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
                                    placeholder={t('register.passwordPlaceholder')}
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
                            <label className="text-[10px] font-black text-graphite-400 uppercase ml-1">{t('register.confirmPassword')}</label>
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
                                    placeholder={t('register.confirmPasswordPlaceholder')}
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
                        {loading ? <Loader2 className="animate-spin" size={20} /> : t('register.submit')}
                    </button>
                </form>

                <div className="mt-8 text-center">
                    <p className="text-sm font-medium text-graphite-500">
                        {t('register.alreadyHaveAccount')}{' '}
                        <button
                            onClick={() => navigate('/login')}
                            className="text-brand-primary font-bold hover:underline border-none bg-transparent cursor-pointer"
                        >
                            {t('register.signIn')}
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
};
