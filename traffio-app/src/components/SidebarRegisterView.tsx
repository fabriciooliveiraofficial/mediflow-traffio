import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Mail, ChevronLeft, Loader2, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { IntlPhoneInput } from './intl/IntlPhoneInput';
import { IntlDocInput } from './intl/IntlDocInput';
import { DEFAULT_COUNTRY, type CountryCode } from '../lib/i18n/countryFormats';
import { docType } from '../lib/i18n/doc';

interface SidebarRegisterViewProps {
  onBack: () => void;
  onSuccess: (patient: any) => void;
  initialPhone?: string;
}

export function SidebarRegisterView({ onBack, onSuccess, initialPhone }: SidebarRegisterViewProps) {
  const { t } = useTranslation('crm');
  const { tenant } = useTenant();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    national_id: '',
    country: (tenant?.country || DEFAULT_COUNTRY) as CountryCode,
    phone: initialPhone || '',
    email: '',
    type: 'particular' as 'particular' | 'convenio'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant?.id) return;
    setLoading(true);

    try {
      // Validate duplicate CPF/Document under same tenant
      const formattedCpf = formData.national_id;
      const cleanedCpf = formData.national_id ? formData.national_id.replace(/\D/g, '') : null;

      if (cleanedCpf && tenant?.id) {
        const orConditions = [
          `cpf.eq.${cleanedCpf}`,
          `cpf.eq.${formattedCpf}`,
          `national_id.eq.${cleanedCpf}`,
          `national_id.eq.${formattedCpf}`
        ];

        const { data: existingPatients, error: checkError } = await supabase
          .from('patients')
          .select('id, cpf, national_id')
          .eq('tenant_id', tenant.id)
          .or(orConditions.join(','));

        if (checkError) {
          console.error('Error checking duplicate patients:', checkError);
        } else if (existingPatients && existingPatients.length > 0) {
          throw new Error(t('sidebarRegisterView.errors.duplicateCpf') || 'Já existe um paciente cadastrado com este CPF.');
        }
      }
      const { data, error } = await supabase
        .from('patients')
        .insert({
          tenant_id: tenant.id,
          full_name: formData.full_name,
          // `cpf` kept for BR retrocompat; `national_id`/`national_id_type`/`country` are the generic fields.
          cpf: formData.country === 'BR' ? formData.national_id : null,
          national_id: formData.national_id || null,
          national_id_type: formData.national_id ? docType(formData.country) : null,
          country: formData.country,
          phone: formData.phone,
          email: formData.email,
          type: formData.type
        })
        .select()
        .single();

      if (error) throw error;
      showToast('success', t('sidebarRegisterView.toasts.created'));
      onSuccess(data);
    } catch (err: any) {
      showToast('error', err.message || t('sidebarRegisterView.errors.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-blue-50/50">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white text-gray-500 transition-colors shadow-sm">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-bold text-blue-700">{t('sidebarRegisterView.headerTitle')}</span>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">{t('sidebarRegisterView.fullNameLabel')}</label>
          <div className="relative">
            <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              required
              className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder={t('sidebarRegisterView.fullNamePlaceholder')}
              value={formData.full_name}
              onChange={e => setFormData({ ...formData, full_name: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <IntlDocInput
            value={formData.national_id}
            onChange={v => setFormData({ ...formData, national_id: v })}
            country={formData.country}
            onCountryChange={c => setFormData({ ...formData, country: c })}
          />
        </div>

        <div className="space-y-1.5">
          <IntlPhoneInput
            value={formData.phone}
            onChange={v => setFormData({ ...formData, phone: v })}
            country={formData.country}
            label={t('sidebarRegisterView.phoneLabel')}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">{t('sidebarRegisterView.emailLabel')}</label>
          <div className="relative">
            <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="email"
              className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder={t('sidebarRegisterView.emailPlaceholder')}
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5 pb-4">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">{t('sidebarRegisterView.careTypeLabel')}</label>
          <div className="flex p-1 bg-gray-100 rounded-xl">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, type: 'particular' })}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                formData.type === 'particular'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t('sidebarRegisterView.particular')}
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, type: 'convenio' })}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                formData.type === 'convenio'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t('sidebarRegisterView.insurance')}
            </button>
          </div>
        </div>
      </form>

      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <button
          onClick={handleSubmit}
          disabled={loading || !formData.full_name}
          className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <><UserPlus size={16} /> {t('sidebarRegisterView.register')}</>
          )}
        </button>
      </div>
    </div>
  );
}
