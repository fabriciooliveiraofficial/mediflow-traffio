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
}

export function ChannelPreferenceSelector({ tenantId, patientPhone, compact = false, enabledChannels }: Props) {
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
  const [smsPhone,    setSmsPhone]    = useState('');
  const [updatedBy,   setUpdatedBy]   = useState<'auto' | 'manual'>('auto');
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [loading,     setLoading]     = useState(true);

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
      .select('preferred_channel, sms_phone, updated_by')
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
      setSmsPhone(data.sms_phone ?? '');
      setUpdatedBy(data.updated_by ?? 'auto');
    }
    setLoading(false);
  }

  async function save(channels: Channel[], phone?: string) {
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

    if (activeChannelsToSave.includes('sms') || activeChannelsToSave.includes('mms') || activeChannelsToSave.includes('email')) {
      update.sms_phone = phone ?? smsPhone;
    }

    await supabase
      .from('patient_channel_preferences')
      .upsert(update, { onConflict: 'tenant_id,patient_phone' });

    setSelectedChannels(activeChannelsToSave);
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

  const activeRequiresId = selectedChannels.find(id => CHANNELS.find(c => c.id === id)?.requiresId);
  const selectedChannelObj = activeRequiresId ? CHANNELS.find(c => c.id === activeRequiresId) : null;

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
              {t('channelPreferenceSelector.auto')}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {filteredChannels.map((ch) => {
            const isActive = selectedChannels.includes(ch.id);
            return (
              <button
                key={ch.id}
                onClick={() => {
                  let newChannels = [...selectedChannels];
                  if (isActive) {
                    if (newChannels.length > 1) {
                      newChannels = newChannels.filter(id => id !== ch.id);
                      if (!ch.requiresId) {
                        save(newChannels);
                      } else {
                        setSelectedChannels(newChannels);
                      }
                    }
                  } else {
                    newChannels.push(ch.id);
                    if (!ch.requiresId) {
                      save(newChannels);
                    } else {
                      setSelectedChannels(newChannels);
                    }
                  }
                }}
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

        {/* Campo de identificação (SMS/MMS/Email) */}
        {selectedChannelObj?.requiresId && (
          <div className="flex gap-1.5">
            <input
              type={selectedChannelObj.id === 'email' ? 'email' : 'tel'}
              value={smsPhone}
              onChange={(e) => setSmsPhone(e.target.value)}
              placeholder={selectedChannelObj.idPlaceholder}
              className="flex-1 text-xs bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 focus:outline-none focus:border-brand-primary"
            />
            <button
              onClick={() => save(selectedChannels, smsPhone)}
              disabled={!smsPhone || saving}
              className="px-3 py-2 bg-brand-primary text-white text-xs font-bold rounded-xl disabled:opacity-40 border-none cursor-pointer"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? '✓' : t('channelPreferenceSelector.confirm')}
            </button>
          </div>
        )}

        {/* Selecionar outros canais que requerem ID */}
        {CHANNELS.filter(ch => ch.requiresId && !selectedChannels.includes(ch.id) && filteredChannels.some(fc => fc.id === ch.id)).map(ch => (
          <button
            key={ch.id}
            onClick={() => {
              setSelectedChannels([...selectedChannels, ch.id]);
            }}
            className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-ice-100 text-xs font-bold text-graphite-400 hover:border-ice-200 transition-all cursor-pointer bg-white"
          >
            <ch.icon size={12} />
            {ch.id === 'sms' 
              ? t('channelPreferenceSelector.selectSms') 
              : ch.id === 'mms' 
                ? t('channelPreferenceSelector.selectMms', { defaultValue: 'Selecionar MMS' }) 
                : t('channelPreferenceSelector.selectEmail', { defaultValue: 'Selecionar E-mail' })}
          </button>
        ))}

        {saved && (
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
          {updatedBy === 'manual' ? t('channelPreferenceSelector.manuallySet') : t('channelPreferenceSelector.autoDetected')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {filteredChannels.map((ch) => {
          const isActive = selectedChannels.includes(ch.id);
          return (
            <button
              key={ch.id}
              onClick={() => {
                let newChannels = [...selectedChannels];
                if (isActive) {
                  if (newChannels.length > 1) {
                    newChannels = newChannels.filter(id => id !== ch.id);
                    if (!ch.requiresId) {
                      save(newChannels);
                    } else {
                      setSelectedChannels(newChannels);
                    }
                  }
                } else {
                  newChannels.push(ch.id);
                  if (!ch.requiresId) {
                    save(newChannels);
                  } else {
                    setSelectedChannels(newChannels);
                  }
                }
              }}
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

      {selectedChannelObj?.requiresId && (
        <div className="flex gap-2">
          <input
            type={selectedChannelObj.id === 'email' ? 'email' : 'tel'}
            value={smsPhone}
            onChange={(e) => setSmsPhone(e.target.value)}
            placeholder={selectedChannelObj.idPlaceholder}
            className="flex-1 text-sm bg-ice-50 border border-ice-200 rounded-2xl px-4 py-2.5 focus:outline-none focus:border-brand-primary"
          />
          <button
            onClick={() => save(selectedChannels, smsPhone)}
            disabled={!smsPhone || saving}
            className="px-4 py-2.5 bg-brand-primary text-white font-bold rounded-2xl disabled:opacity-40 border-none cursor-pointer"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? '✓' : t('channelPreferenceSelector.save')}
          </button>
        </div>
      )}
    </div>
  );
}
