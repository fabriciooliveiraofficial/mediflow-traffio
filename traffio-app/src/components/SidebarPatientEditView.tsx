import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Mail, ChevronLeft, Loader2, Save, UserCheck, Users, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';
import { clsx } from 'clsx';
import { IntlPhoneInput } from './intl/IntlPhoneInput';
import { IntlDocInput } from './intl/IntlDocInput';
import { DEFAULT_COUNTRY, type CountryCode } from '../lib/i18n/countryFormats';
import { docType } from '../lib/i18n/doc';

interface SidebarPatientEditViewProps {
  onBack: () => void;
  onSuccess: (patient: any) => void;
  patient: any;
  session: any;
  onSessionUpdate: (session: any) => void;
}

export function SidebarPatientEditView({ onBack, onSuccess, patient, session, onSessionUpdate }: SidebarPatientEditViewProps) {
  const { t } = useTranslation('crm');
  const { tenant } = useTenant();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  // Patient Form State
  const [formData, setFormData] = useState({
    full_name: patient?.full_name || '',
    national_id: patient?.national_id || patient?.cpf || '',
    // Legacy patients have no `country` but already have a `cpf` -> BR.
    country: (patient?.country as CountryCode) || (patient?.cpf ? 'BR' : (tenant?.country || DEFAULT_COUNTRY)),
    birth_date: patient?.birth_date ? toDisplayDate(patient.birth_date) : '',
    phone: patient?.phone || '',
    email: patient?.email || '',
    type: (patient?.type || 'particular') as 'particular' | 'insurance',
    notes: patient?.notes || ''
  });

  function toDisplayDate(dbDate: string) {
    if (!dbDate) return '';
    const datePart = dbDate.split('T')[0];
    const [year, month, day] = datePart.split('-');
    if (!year || !month || !day) return '';
    return `${day}/${month}/${year}`;
  }

  function toDBDate(displayDate: string) {
    if (!displayDate) return null;
    const [day, month, year] = displayDate.split('/');
    if (!day || !month || !year || year.length < 4) return null;
    return `${year}-${month}-${day}`;
  }

  const applyDateMask = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  };

  // Interlocutor (Contact) State - From session context
  const [interlocutor, setInterlocutor] = useState({
    name: session?.context?.interlocutor?.name || '',
    relationship: session?.context?.interlocutor?.relationship || '',
    isPatient: session?.context?.interlocutor?.isPatient !== false // Default to true if not set
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant?.id || !patient?.id) return;
    setLoading(true);

    try {
      // Validate duplicate CPF/Document under same tenant (excluding current patient)
      const formattedCpf = formData.national_id;
      const cleanedCpf = formData.national_id ? formData.national_id.replace(/\D/g, '') : null;

      if (cleanedCpf && tenant?.id && patient?.id) {
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
          .neq('id', patient.id)
          .or(orConditions.join(','));

        if (checkError) {
          console.error('Error checking duplicate patients:', checkError);
        } else if (existingPatients && existingPatients.length > 0) {
          throw new Error(t('sidebarPatientEditView.errors.duplicateCpf') || 'Já existe um paciente cadastrado com este CPF.');
        }
      }
      // 1. Update Patient Data
      const { data: updatedPatient, error: pError } = await supabase
        .from('patients')
        .update({
          full_name: formData.full_name,
          // `cpf` kept for BR retrocompat; `national_id`/`national_id_type`/`country` are the generic fields.
          cpf: formData.country === 'BR' ? formData.national_id : null,
          national_id: formData.national_id || null,
          national_id_type: formData.national_id ? docType(formData.country) : null,
          country: formData.country,
          birth_date: toDBDate(formData.birth_date),
          phone: formData.phone,
          email: formData.email,
          type: formData.type,
          notes: formData.notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', patient.id)
        .select()
        .single();

      if (pError) throw pError;

      // 2. Update Session Context (Interlocutor Info)
      const updatedContext = {
        ...(session.context || {}),
        interlocutor: {
          name: interlocutor.isPatient ? formData.full_name : interlocutor.name,
          relationship: interlocutor.isPatient ? t('sidebarPatientEditView.self') : interlocutor.relationship,
          isPatient: interlocutor.isPatient
        }
      };

      const { data: updatedSession, error: sError } = await supabase
        .from('conversation_sessions')
        .update({ 
          context: updatedContext,
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id)
        .select()
        .single();

      if (sError) throw sError;

      showToast('success', t('sidebarPatientEditView.toasts.updated'));
      onSuccess(updatedPatient);
      onSessionUpdate(updatedSession);
    } catch (err: any) {
      showToast('error', err.message || t('sidebarPatientEditView.errors.updateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-blue-600">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors border-0 bg-transparent cursor-pointer">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-sm font-bold text-white">{t('sidebarPatientEditView.headerTitle')}</span>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-6">
        
        {/* Section: Interlocutor Identity */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest">{t('sidebarPatientEditView.whatsappIdentity')}</h3>
          </div>

          <div className="bg-blue-50/50 rounded-2xl p-4 space-y-4 border border-blue-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-800 uppercase">{t('sidebarPatientEditView.isPatientQuestion')}</span>
              <button
                type="button"
                onClick={() => setInterlocutor({ ...interlocutor, isPatient: !interlocutor.isPatient })}
                className={clsx(
                  "w-10 h-5 rounded-full transition-all relative",
                  interlocutor.isPatient ? "bg-blue-600" : "bg-gray-300"
                )}
              >
                <div className={clsx(
                  "absolute top-1 w-3 h-3 rounded-full bg-white transition-all",
                  interlocutor.isPatient ? "right-1" : "left-1"
                )} />
              </button>
            </div>

            {!interlocutor.isPatient && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-1">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">{t('sidebarPatientEditView.whoIsTalkingLabel')}</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-white border border-blue-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    placeholder={t('sidebarPatientEditView.responsibleNamePlaceholder')}
                    value={interlocutor.name}
                    onChange={e => setInterlocutor({ ...interlocutor, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">{t('sidebarPatientEditView.relationshipLabel')}</label>
                  <select
                    className="w-full px-3 py-2 text-sm bg-white border border-blue-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    value={interlocutor.relationship}
                    onChange={e => setInterlocutor({ ...interlocutor, relationship: e.target.value })}
                  >
                    <option value="">{t('sidebarPatientEditView.selectPlaceholder')}</option>
                    <option value="Pai/Mãe">{t('sidebarPatientEditView.relationships.parent')}</option>
                    <option value="Cônjuge">{t('sidebarPatientEditView.relationships.spouse')}</option>
                    <option value="Filho(a)">{t('sidebarPatientEditView.relationships.child')}</option>
                    <option value="Irmão/Irmã">{t('sidebarPatientEditView.relationships.sibling')}</option>
                    <option value="Secretária/Assessor">{t('sidebarPatientEditView.relationships.secretary')}</option>
                    <option value="Outro">{t('sidebarPatientEditView.relationships.other')}</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Section: Patient Data */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <UserCheck className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest">{t('sidebarPatientEditView.patientInfo')}</h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">{t('sidebarPatientEditView.fullNameLabel')}</label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  required
                  className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  value={formData.full_name}
                  onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <IntlDocInput
                  value={formData.national_id}
                  onChange={v => setFormData({ ...formData, national_id: v })}
                  country={formData.country}
                  onCountryChange={c => setFormData({ ...formData, country: c })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">{t('sidebarPatientEditView.birthLabel')}</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder={t('sidebarPatientEditView.birthPlaceholder')}
                    maxLength={10}
                    value={formData.birth_date}
                    onChange={e => setFormData({ ...formData, birth_date: applyDateMask(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <IntlPhoneInput
                  value={formData.phone}
                  onChange={v => setFormData({ ...formData, phone: v })}
                  country={formData.country}
                  label={t('sidebarPatientEditView.phoneLabel')}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">{t('sidebarPatientEditView.emailLabel')}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">{t('sidebarPatientEditView.careTypeLabel')}</label>
              <div className="flex p-1 bg-gray-100 rounded-xl">
                {['particular', 'insurance'].map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFormData({ ...formData, type: type as any })}
                    className={clsx(
                      "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all border-none cursor-pointer capitalize",
                      formData.type === type ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    {type === 'particular' ? t('sidebarPatientEditView.particular') : t('sidebarPatientEditView.insurance')}
                  </button>
                ))}
              </div>
            </div>

            {/* Sticky Notes Section */}
            <div className="space-y-1.5 pt-2">
              <label className="text-[10px] font-bold text-amber-600 uppercase ml-1">{t('sidebarPatientEditView.stickyNotesLabel')}</label>
              <textarea
                className="w-full px-3 py-2 text-sm bg-amber-50 border border-amber-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all min-h-[80px] placeholder:text-amber-300"
                placeholder={t('sidebarPatientEditView.stickyNotesPlaceholder')}
                value={formData.notes || ''}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>
        </section>
      </form>

      {/* Footer Actions */}
      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <button
          onClick={handleSubmit}
          disabled={loading || !formData.full_name}
          className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed border-none cursor-pointer"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <><Save size={18} /> {t('sidebarPatientEditView.saveChanges')}</>
          )}
        </button>
      </div>
    </div>
  );
}
