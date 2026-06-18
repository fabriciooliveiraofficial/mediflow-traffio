import React, { useState, useEffect } from 'react';
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
          relationship: interlocutor.isPatient ? 'Self' : interlocutor.relationship,
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

      showToast('success', 'Informações atualizadas!');
      onSuccess(updatedPatient);
      onSessionUpdate(updatedSession);
    } catch (err: any) {
      showToast('error', err.message || 'Falha ao atualizar');
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
        <span className="text-sm font-bold text-white">Editar Perfil</span>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-6">
        
        {/* Section: Interlocutor Identity */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-blue-600" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest">Identidade no WhatsApp</h3>
          </div>
          
          <div className="bg-blue-50/50 rounded-2xl p-4 space-y-4 border border-blue-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-800 uppercase">O contato é o próprio paciente?</span>
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
                  <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Quem está falando?</label>
                  <input
                    className="w-full px-3 py-2 text-sm bg-white border border-blue-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    placeholder="Nome do responsável"
                    value={interlocutor.name}
                    onChange={e => setInterlocutor({ ...interlocutor, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Parentesco/Relação</label>
                  <select
                    className="w-full px-3 py-2 text-sm bg-white border border-blue-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    value={interlocutor.relationship}
                    onChange={e => setInterlocutor({ ...interlocutor, relationship: e.target.value })}
                  >
                    <option value="">Selecione...</option>
                    <option value="Pai/Mãe">Pai/Mãe</option>
                    <option value="Cônjuge">Cônjuge</option>
                    <option value="Filho(a)">Filho(a)</option>
                    <option value="Irmão/Irmã">Irmão/Irmã</option>
                    <option value="Secretária/Assessor">Secretária/Assessor</option>
                    <option value="Outro">Outro</option>
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
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest">Informações do Paciente</h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Nome Completo</label>
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
                <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Nascimento</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="DD/MM/AAAA"
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
                  label="Telefone"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">E-mail</label>
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
              <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Tipo de Atendimento</label>
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
                    {type === 'particular' ? 'Particular' : 'Convênio'}
                  </button>
                ))}
              </div>
            </div>

            {/* Sticky Notes Section */}
            <div className="space-y-1.5 pt-2">
              <label className="text-[10px] font-bold text-amber-600 uppercase ml-1">Notas Sticky (Front Desk)</label>
              <textarea
                className="w-full px-3 py-2 text-sm bg-amber-50 border border-amber-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all min-h-[80px] placeholder:text-amber-300"
                placeholder="Ex: Prefere atendimento pela manhã. Necessita de acessibilidade..."
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
            <><Save size={18} /> Salvar Alterações</>
          )}
        </button>
      </div>
    </div>
  );
}
