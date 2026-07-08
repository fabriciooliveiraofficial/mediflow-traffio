/**
 * ChannelPreferenceSelector
 *
 * Seletor de canal preferido para notificações de automação (No-Show + NPS).
 * Exibido no painel lateral do paciente no HumanInboxPage.
 *
 * Quando o operador define manualmente, salva em patient_channel_preferences
 * com updated_by = 'manual' — protegido de sobrescrição automática.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Instagram, Facebook, Phone, CheckCircle2, Loader2, Image, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { phoneCountry, formatNational, formatAsYouType, toE164 } from '../../lib/i18n/phone';
import { type CountryCode } from '../../lib/i18n/countryFormats';

type Channel = 'whatsapp' | 'instagram' | 'facebook' | 'sms' | 'email' | 'mms';

interface ChannelOption {
  id:          Channel;
  label:       string;
  icon:        React.ElementType;
  color:       string;
  bgColor:     string;
  requiresId:  boolean;
  idLabel?:    string;
  idPlaceholder?: string;
}

interface Props {
  tenantId:     string;
  patientPhone: string;
  compact?:     boolean;   // modo compacto para sidebar
  enabledChannels?: Record<string, boolean>;
  /** Canal padrão do tenant (bot_config.default_notification_channel) — usado
   *  para os envios automáticos quando o paciente não tem preferência manual. */
  defaultChannel?: Channel;
}

export function ChannelPreferenceSelector({ tenantId, patientPhone, compact = false, enabledChannels, defaultChannel = 'whatsapp' }: Props) {
  const { t } = useTranslation('communications');

  const CHANNELS: ChannelOption[] = [
    {
      id:          'whatsapp',
      label:       'WhatsApp',
      icon:        MessageCircle,
      color:       'text-green-600',
      bgColor:     'bg-green-50 border-green-200',
      requiresId:  false,
    },
    {
      id:          'instagram',
      label:       'Instagram DM',
      icon:        Instagram,
      color:       'text-pink-500',
      bgColor:     'bg-pink-50 border-pink-200',
      requiresId:  false,  // auto-detectado do webhook
    },
    {
      id:          'facebook',
      label:       'Facebook Messenger',
      icon:        Facebook,
      color:       'text-blue-600',
      bgColor:     'bg-blue-50 border-blue-200',
      requiresId:  false,  // auto-detectado do webhook
    },
    {
      id:          'sms',
      label:       'SMS',
      icon:        Phone,
      color:       'text-graphite-600',
      bgColor:     'bg-ice-50 border-ice-200',
      requiresId:  true,
      idLabel:     t('channelPreferenceSelector.smsIdLabel'),
      idPlaceholder: t('channelPreferenceSelector.smsPlaceholder'),
    },
    {
      id:          'mms',
      label:       'MMS',
      icon:        Image,
      color:       'text-indigo-600',
      bgColor:     'bg-indigo-50 border-indigo-200',
      requiresId:  true,
      idLabel:     t('channelPreferenceSelector.mmsIdLabel'),
      idPlaceholder: t('channelPreferenceSelector.mmsPlaceholder'),
    },
    {
      id:          'email',
      label:       'E-mail',
      icon:        Mail,
      color:       'text-violet-600',
      bgColor:     'bg-violet-50 border-violet-200',
      requiresId:  true,
      idLabel:     t('channelPreferenceSelector.emailIdLabel'),
      idPlaceholder: t('channelPreferenceSelector.emailPlaceholder'),
    },
  ];

  const [selectedChannels, setSelectedChannels] = useState<Channel[]>(['whatsapp']);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [smsPhone,      setSmsPhone]      = useState('');
  const [emailAddress,  setEmailAddress]  = useState('');
  const [updatedBy,     setUpdatedBy]     = useState<'auto' | 'manual'>('auto');
  const [saving,        setSaving]        = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [loading,       setLoading]       = useState(true);

  const countryCode = (phoneCountry(patientPhone) || 'BR') as CountryCode;
  const defaultChannelLabel = CHANNELS.find(ch => ch.id === defaultChannel)?.label ?? 'WhatsApp';

  const filteredChannels = CHANNELS.filter(ch => {
    if (!enabledChannels) return true;
    const isDefaultEnabled = ch.id === 'whatsapp' || ch.id === 'sms';
    return enabledChannels[ch.id] ?? isDefaultEnabled;
  });

  // Carregar preferência existente
  useEffect(() => {
    if (!tenantId || !patientPhone) return;
    loadPreference();
  }, [tenantId, patientPhone]);

  async function loadPreference() {
    setLoading(true);
    const { data } = await supabase
      .from('patient_channel_preferences')
      .select('preferred_channel, sms_phone, whatsapp_phone, email, updated_by')
      .eq('tenant_id', tenantId)
      .eq('patient_phone', patientPhone)
      .maybeSingle();

    if (data) {
      const channels = (data.preferred_channel || 'whatsapp').split(',') as Channel[];
      
      // Sanitizar removendo canais desabilitados na matriz
      const activeChannels = channels.filter(id => {
        if (!enabledChannels) return true;
        const isDefaultEnabled = id === 'whatsapp' || id === 'sms';
        return enabledChannels[id] ?? isDefaultEnabled;
      });

      setSelectedChannels(activeChannels);
      setWhatsappPhone(data.whatsapp_phone ? formatNational(data.whatsapp_phone) : '');
      setSmsPhone(data.sms_phone ? formatNational(data.sms_phone) : '');
      setEmailAddress(data.email ?? '');
      setUpdatedBy(data.updated_by ?? 'auto');
    }
    setLoading(false);
  }

  function handleToggle(chId: Channel) {
    let newChannels = [...selectedChannels];
    const isActive = selectedChannels.includes(chId);

    if (isActive) {
      if (newChannels.length > 1) {
        newChannels = newChannels.filter(id => id !== chId);
      } else {
        return; // não permitir desselecionar tudo
      }
    } else {
      newChannels.push(chId);
    }

    const nextHasInput = newChannels.some(id => ['whatsapp', 'sms', 'mms', 'email'].includes(id));
    if (nextHasInput) {
      setSelectedChannels(newChannels);
    } else {
      save(newChannels);
    }
  }

  async function save(channels: Channel[]) {
    setSaving(true);
    setSaved(false);

    // Filtrar canais que estão desabilitados na matriz do tenant
    const activeChannelsToSave = channels.filter(id => {
      if (!enabledChannels) return true;
      const isDefaultEnabled = id === 'whatsapp' || id === 'sms';
      return enabledChannels[id] ?? isDefaultEnabled;
    });

    const channelsString = activeChannelsToSave.join(',');

    const update: any = {
      tenant_id:        tenantId,
      patient_phone:    patientPhone,
      preferred_channel: channelsString,
      updated_by:       'manual',
      last_manual_updated_at: new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    };

    await supabase
      .from('patient_channel_preferences')
      .upsert(update, { onConflict: 'tenant_id,patient_phone' });

    setSelectedChannels(activeChannelsToSave);
    setUpdatedBy('manual');
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSaveDetails() {
    setSaving(true);
    setSaved(false);

    const cleanWhatsapp = whatsappPhone ? toE164(whatsappPhone, countryCode) : null;
    const cleanSms = smsPhone ? toE164(smsPhone, countryCode) : null;
    const cleanEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress.trim()) ? emailAddress.trim() : null;

    const activeChannelsToSave = selectedChannels.filter(id => {
      if (!enabledChannels) return true;
      const isDefaultEnabled = id === 'whatsapp' || id === 'sms';
      return enabledChannels[id] ?? isDefaultEnabled;
    });

    const update: any = {
      tenant_id:        tenantId,
      patient_phone:    patientPhone,
      preferred_channel: activeChannelsToSave.join(','),
      updated_by:       'manual',
      last_manual_updated_at: new Date().toISOString(),
      updated_at:       new Date().toISOString(),
      whatsapp_phone:   cleanWhatsapp,
      sms_phone:        cleanSms,
      email:            cleanEmail,
    };

    await supabase
      .from('patient_channel_preferences')
      .upsert(update, { onConflict: 'tenant_id,patient_phone' });

    setUpdatedBy('manual');
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-graphite-300 py-2">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">{t('channelPreferenceSelector.loading')}</span>
      </div>
    );
  }

  const showWhatsappInput = selectedChannels.includes('whatsapp');
  const showSmsInput = selectedChannels.includes('sms') || selectedChannels.includes('mms');
  const showEmailInput = selectedChannels.includes('email');
  const hasInputs = showWhatsappInput || showSmsInput || showEmailInput;

  // E-mail é obrigatório quando o canal e-mail está selecionado
  const emailValid = !showEmailInput || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress.trim());

  const renderInputFields = (isCompact: boolean) => {
    if (!hasInputs) return null;

    return (
      <div className={`space-y-2.5 mt-2.5 p-3 bg-ice-50/50 rounded-2xl border border-ice-100`}>
        {showWhatsappInput && (
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-graphite-500 uppercase tracking-wider">
              WhatsApp
            </label>
            <input
              type="tel"
              value={whatsappPhone}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '');
                setWhatsappPhone(formatAsYouType(digits, countryCode));
              }}
              placeholder={formatNational(patientPhone) || 'WhatsApp (Opcional)'}
              className={`w-full ${isCompact ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3 py-2'} bg-white border border-ice-200 rounded-xl focus:outline-none focus:border-brand-primary font-medium`}
            />
          </div>
        )}

        {showSmsInput && (
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-graphite-500 uppercase tracking-wider">
              SMS / MMS
            </label>
            <input
              type="tel"
              value={smsPhone}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '');
                setSmsPhone(formatAsYouType(digits, countryCode));
              }}
              placeholder={formatNational(patientPhone) || 'SMS/MMS (Opcional)'}
              className={`w-full ${isCompact ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3 py-2'} bg-white border border-ice-200 rounded-xl focus:outline-none focus:border-brand-primary font-medium`}
            />
          </div>
        )}

        {showEmailInput && (
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-graphite-500 uppercase tracking-wider">
              E-mail
            </label>
            <input
              type="email"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              placeholder={t('channelPreferenceSelector.emailPlaceholder')}
              className={`w-full ${isCompact ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3 py-2'} bg-white border ${emailValid ? 'border-ice-200' : 'border-rose-300'} rounded-xl focus:outline-none focus:border-brand-primary font-medium`}
            />
            {!emailValid && (
              <p className="text-[10px] text-rose-500 font-bold">
                {t('channelPreferenceSelector.emailRequired', { defaultValue: 'Informe um e-mail válido para receber notificações por e-mail.' })}
              </p>
            )}
          </div>
        )}

        <button
          onClick={handleSaveDetails}
          disabled={saving || !emailValid}
          className={`w-full mt-1 px-3 ${isCompact ? 'py-2 text-xs' : 'py-2.5 text-sm'} bg-brand-primary text-white font-bold rounded-xl disabled:opacity-40 border-none cursor-pointer flex items-center justify-center gap-1.5`}
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : saved ? (
            '✓'
          ) : (
            isCompact ? t('channelPreferenceSelector.confirm') : t('channelPreferenceSelector.save')
          )}
        </button>
      </div>
    );
  };

  if (compact) {
    // Modo compacto: badge + dropdown inline
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">
            {t('channelPreferenceSelector.compactHeading')}
          </p>
          {updatedBy === 'manual' && (
            <span className="text-[9px] bg-amber-50 text-amber-600 font-bold px-1.5 py-0.5 rounded-full border border-amber-100">
              {t('channelPreferenceSelector.manual')}
            </span>
          )}
          {updatedBy === 'auto' && (
            <span className="text-[9px] bg-ice-50 text-graphite-400 font-bold px-1.5 py-0.5 rounded-full border border-ice-100">
              {t('channelPreferenceSelector.auto')} · {defaultChannelLabel}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {filteredChannels.map((ch) => {
            const isActive = selectedChannels.includes(ch.id);
            return (
              <button
                key={ch.id}
                onClick={() => handleToggle(ch.id)}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? `${ch.bgColor} ${ch.color}`
                    : 'bg-white border-ice-100 text-graphite-400 hover:border-ice-200'
                }`}
              >
                <ch.icon size={12} />
                <span className="truncate">{ch.label}</span>
                {isActive && <CheckCircle2 size={10} className="ml-auto shrink-0" />}
              </button>
            );
          })}
        </div>

        {renderInputFields(true)}

        {saved && !hasInputs && (
          <p className="text-[10px] text-green-600 font-bold flex items-center gap-1">
            <CheckCircle2 size={10} /> {t('channelPreferenceSelector.savedSuccess')}
          </p>
        )}
      </div>
    );
  }

  // Modo expandido (para uso futuro em página de configurações / PatientDetails)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black text-graphite-700">{t('channelPreferenceSelector.expandedHeading')}</h4>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          updatedBy === 'manual'
            ? 'bg-amber-50 text-amber-600 border border-amber-100'
            : 'bg-ice-50 text-graphite-400 border border-ice-100'
        }`}>
          {updatedBy === 'manual' ? t('channelPreferenceSelector.manuallySet') : `${t('channelPreferenceSelector.autoDetected')} · ${defaultChannelLabel}`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {filteredChannels.map((ch) => {
          const isActive = selectedChannels.includes(ch.id);
          return (
            <button
              key={ch.id}
              onClick={() => handleToggle(ch.id)}
              className={`flex items-center gap-2 p-3 rounded-2xl border text-sm font-bold transition-all cursor-pointer ${
                isActive
                  ? `${ch.bgColor} ${ch.color} shadow-sm`
                  : 'bg-white border-ice-100 text-graphite-500 hover:bg-ice-50'
              }`}
            >
              <ch.icon size={16} />
              {ch.label}
              {isActive && <CheckCircle2 size={14} className="ml-auto" />}
            </button>
          );
        })}
      </div>

      {renderInputFields(false)}
    </div>
  );
}
