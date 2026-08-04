import { useOutletContext, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { User, Mail, Phone, Calendar, CreditCard, Globe, LogOut, ArrowLeft } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatPhone, phoneFlag } from '../../lib/formatPhone';
import { formatDisplayDate } from '../../lib/dateUtils';
import { useLang } from '../../hooks/useLang';
import { useToast } from '../../contexts/ToastContext';
import type { AppLanguage } from '../../lib/i18n';

export function PortalProfile() {
    const { t } = useTranslation('portal');
    const { t: tCommon } = useTranslation('common');
    // @ts-ignore
    const { tenant, patient } = useOutletContext<{ tenant: any; patient: any }>();
    const navigate = useNavigate();
    const { language, setLanguage, supportedLanguages } = useLang();
    const { showToast } = useToast();

    const handleLanguageChange = async (lng: AppLanguage) => {
        setLanguage(lng);
        if (!patient?.id) return;

        try {
            const { error } = await supabase
                .from('patients')
                .update({ preferred_locale: lng })
                .eq('id', patient.id);

            if (error) throw error;
            showToast('success', t('profile.languageUpdated'));
        } catch (error) {
            console.error('Error saving patient language preference:', error);
            showToast('error', t('profile.languageUpdateError'));
        }
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate(`/portal/${tenant.slug}/login`);
    };

    if (!patient) return null;

    return (
        <div className="max-w-2xl mx-auto space-y-6 font-sans">
            <div className="flex items-center gap-4 mb-6">
                <button
                    onClick={() => navigate(`/portal/${tenant.slug}/dashboard`)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
                >
                    <ArrowLeft size={20} />
                </button>
                <h1 className="text-2xl font-black text-gray-900 tracking-tight">{t('profile.title')}</h1>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="h-24 bg-primary/10 relative" style={{ backgroundColor: `${tenant.color_primary}1A` }}>
                    <div className="absolute -bottom-10 left-6">
                        <div className="w-20 h-20 bg-white rounded-2xl shadow-sm p-1 border border-gray-100 flex items-center justify-center">
                            <div className="w-full h-full bg-primary/10 rounded-xl flex items-center justify-center text-primary font-bold text-2xl" style={{ color: tenant.color_primary, backgroundColor: `${tenant.color_primary}1A` }}>
                                {patient.full_name?.charAt(0)}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="pt-14 p-6 space-y-8">
                    {/* Basic Info */}
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 mb-4">{t('profile.personalInfo')}</h2>
                        <div className="space-y-4">
                            <div className="flex items-center gap-4 text-gray-600">
                                <User className="text-gray-400" size={20} />
                                <div>
                                    <p className="text-sm font-medium text-gray-900">{patient.full_name}</p>
                                    <p className="text-xs text-gray-500">{t('profile.fullName')}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 text-gray-600">
                                <Mail className="text-gray-400" size={20} />
                                <div>
                                    <p className="text-sm font-medium text-gray-900">{patient.email || t('profile.notInformed')}</p>
                                    <p className="text-xs text-gray-500">{t('profile.email')}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 text-gray-600">
                                <Phone className="text-gray-400" size={20} />
                                <div>
                                    <p className="text-sm font-medium text-gray-900">{patient.phone ? `${phoneFlag(patient.phone, tenant?.country)} ${formatPhone(patient.phone, tenant?.country)}` : t('profile.notInformed')}</p>
                                    <p className="text-xs text-gray-500">{t('profile.phone')}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 text-gray-600">
                                <CreditCard className="text-gray-400" size={20} />
                                <div>
                                    <p className="text-sm font-medium text-gray-900">{patient.cpf || t('profile.notInformed')}</p>
                                    <p className="text-xs text-gray-500">{t('profile.documentNumber')}</p>
                                </div>
                            </div>

                            {patient.birth_date && (
                                <div className="flex items-center gap-4 text-gray-600">
                                    <Calendar className="text-gray-400" size={20} />
                                    <div>
                                        <p className="text-sm font-medium text-gray-900">{formatDisplayDate(patient.birth_date)}</p>
                                        <p className="text-xs text-gray-500">{t('profile.birthDate')}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Insurance Info */}
                    {patient.insurance_provider && (
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 mb-4">{t('profile.insurance')}</h2>
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                <p className="font-bold text-gray-900">{patient.insurance_provider}</p>
                                <p className="text-sm text-gray-500 mt-1">
                                    {t('profile.cardNumber')} <span className="font-mono">{patient.insurance_card_number || t('profile.cardPending')}</span>
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Language */}
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 mb-4">{t('profile.language')}</h2>
                        <div className="flex items-center gap-4 text-gray-600">
                            <Globe className="text-gray-400" size={20} />
                            <select
                                value={language}
                                onChange={(e) => handleLanguageChange(e.target.value as AppLanguage)}
                                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all cursor-pointer"
                            >
                                {supportedLanguages.map((lng) => (
                                    <option key={lng} value={lng}>{tCommon(`language.${lng}`)}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="pt-6 border-t border-gray-100">
                        <button
                            onClick={handleSignOut}
                            className="w-full flex justify-center items-center gap-2 py-3 px-4 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl font-bold transition-colors"
                        >
                            <LogOut size={18} />
                            {t('profile.signOut')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
