import React, { useState } from 'react';
import { useOutletContext, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { User, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { IntlPhoneInput } from '../../components/intl/IntlPhoneInput';
import { IntlDocInput } from '../../components/intl/IntlDocInput';
import { DEFAULT_COUNTRY, type CountryCode } from '../../lib/i18n/countryFormats';
import { docType } from '../../lib/i18n/doc';

export function PortalRegister() {
    const { t } = useTranslation('portal');
    // @ts-ignore
    const { tenant } = useOutletContext<{ tenant: any }>();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [formData, setFormData] = useState({
        fullName: '',
        email: '',
        phone: '',
        nationalId: '',
        country: (tenant?.country as CountryCode) || DEFAULT_COUNTRY,
        password: '',
        confirmPassword: ''
    });
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (formData.password !== formData.confirmPassword) {
            setError(t('register.errors.passwordMismatch'));
            setLoading(false);
            return;
        }

        try {
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: formData.email,
                password: formData.password,
                options: {
                    data: {
                        full_name: formData.fullName,
                        phone: formData.phone,
                        tenant_id: tenant.id.toString(),
                        // `cpf` kept for retrocompat with the existing DB trigger; new generic fields below.
                        cpf: formData.country === 'BR' ? (formData.nationalId || '').toString() : '',
                        national_id: formData.nationalId || '',
                        national_id_type: formData.nationalId ? docType(formData.country) : '',
                        country: formData.country,
                        role: 'patient',
                        source: 'patient_portal'
                    }
                }
            });

            if (authError) throw authError;
            if (!authData.user) throw new Error(t('register.errors.createUserFailed'));

            // Note: Patient record is now created automatically by DB trigger 'handle_new_user'
            // to avoid 401 Unauthorized errors when email confirmation is enabled.

            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData.session) {
                navigate(`/portal/${tenant.slug}/dashboard`);
            } else {
                showToast('success', t('register.signUpSuccess'));
                navigate(`/portal/${tenant.slug}/login`);
            }

        } catch (err: any) {
            console.error(err);
            setError(err.message || t('register.errors.generic'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-8 font-sans">
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-gray-900">{t('register.title')}</h2>
                <p className="text-gray-500">{t('register.subtitle')}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                    <div className="p-4 bg-red-50 text-red-700 text-sm rounded-xl border border-red-100 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                        {error}
                    </div>
                )}

                {/* Nome */}
                <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('register.fullName')}</label>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <User className="h-5 w-5 text-gray-400 group-focus-within:text-primary transition-colors" />
                        </div>
                        <input
                            type="text"
                            required
                            className="block w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                            style={{ '--tw-ring-color': tenant.color_primary } as any}
                            value={formData.fullName}
                            onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                            placeholder={t('register.fullNamePlaceholder')}
                        />
                    </div>
                </div>

                {/* Whatsapp & Documento Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <IntlPhoneInput
                        value={formData.phone}
                        onChange={v => setFormData({ ...formData, phone: v })}
                        country={formData.country}
                        label="WhatsApp"
                    />
                    <IntlDocInput
                        value={formData.nationalId}
                        onChange={v => setFormData({ ...formData, nationalId: v })}
                        country={formData.country}
                        onCountryChange={c => setFormData({ ...formData, country: c })}
                    />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('register.email')}</label>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <Mail className="h-5 w-5 text-gray-400 group-focus-within:text-primary transition-colors" />
                        </div>
                        <input
                            type="email"
                            required
                            className="block w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                            style={{ '--tw-ring-color': tenant.color_primary } as any}
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            placeholder={t('register.emailPlaceholder')}
                        />
                    </div>
                </div>

                {/* Senha */}
                <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('register.password')}</label>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-primary transition-colors" />
                        </div>
                        <input
                            type={showPassword ? "text" : "password"}
                            required
                            minLength={6}
                            className="block w-full pl-11 pr-11 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                            style={{ '--tw-ring-color': tenant.color_primary } as any}
                            value={formData.password}
                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                            placeholder={t('register.passwordPlaceholder')}
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

                {/* Confirmar Senha */}
                <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('register.confirmPassword')}</label>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-primary transition-colors" />
                        </div>
                        <input
                            type={showPassword ? "text" : "password"}
                            required
                            className="block w-full pl-11 pr-11 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                            style={{ '--tw-ring-color': tenant.color_primary } as any}
                            value={formData.confirmPassword}
                            onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                            placeholder={t('register.confirmPasswordPlaceholder')}
                        />
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
                        <span>{t('register.submit')}</span>
                    )}
                </button>
            </form>

            <div className="text-center pt-2">
                <p className="text-sm text-gray-600">
                    {t('register.alreadyHaveAccount')}{' '}
                    <Link
                        to={`/portal/${tenant.slug}/login`}
                        className="font-bold hover:underline"
                        style={{ color: tenant.color_primary }}
                    >
                        {t('register.signIn')}
                    </Link>
                </p>
            </div>
        </div>
    );
}
