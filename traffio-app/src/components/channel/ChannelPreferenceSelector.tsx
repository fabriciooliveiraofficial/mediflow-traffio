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
import { MessageCircle, Instagram, Facebook, Phone, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type Channel = 'whatsapp' | 'instagram' | 'facebook' | 'sms';

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
    idLabel:     'Número para SMS',
    idPlaceholder: '+55 11 99999-9999',
  },
];

interface Props {
  tenantId:     string;
  patientPhone: string;
  compact?:     boolean;   // modo compacto para sidebar
}

export function ChannelPreferenceSelector({ tenantId, patientPhone, compact = false }: Props) {
  const [pref,        setPref]        = useState<Channel>('whatsapp');
  const [smsPhone,    setSmsPhone]    = useState('');
  const [updatedBy,   setUpdatedBy]   = useState<'auto' | 'manual'>('auto');
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [loading,     setLoading]     = useState(true);

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
      setPref(data.preferred_channel as Channel);
      setSmsPhone(data.sms_phone ?? '');
      setUpdatedBy(data.updated_by ?? 'auto');
    }
    setLoading(false);
  }

  async function save(channel: Channel, phone?: string) {
    setSaving(true);
    setSaved(false);

    const update: any = {
      tenant_id:        tenantId,
      patient_phone:    patientPhone,
      preferred_channel: channel,
      updated_by:       'manual',
      last_manual_updated_at: new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    };

    if (channel === 'sms') update.sms_phone = phone ?? smsPhone;

    await supabase
      .from('patient_channel_preferences')
      .upsert(update, { onConflict: 'tenant_id,patient_phone' });

    setPref(channel);
    setUpdatedBy('manual');
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-graphite-300 py-2">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">Carregando...</span>
      </div>
    );
  }

  const selectedChannel = CHANNELS.find((c) => c.id === pref)!;

  if (compact) {
    // Modo compacto: badge + dropdown inline
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">
            Canal de Notificação
          </p>
          {updatedBy === 'manual' && (
            <span className="text-[9px] bg-amber-50 text-amber-600 font-bold px-1.5 py-0.5 rounded-full border border-amber-100">
              Manual
            </span>
          )}
          {updatedBy === 'auto' && (
            <span className="text-[9px] bg-ice-50 text-graphite-400 font-bold px-1.5 py-0.5 rounded-full border border-ice-100">
              Auto
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {CHANNELS.map((ch) => {
            const isActive = pref === ch.id;
            return (
              <button
                key={ch.id}
                onClick={() => ch.id !== 'sms' && save(ch.id)}
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

        {/* Campo de número SMS */}
        {pref === 'sms' && (
          <div className="flex gap-1.5">
            <input
              type="tel"
              value={smsPhone}
              onChange={(e) => setSmsPhone(e.target.value)}
              placeholder="+55 11 99999-9999"
              className="flex-1 text-xs bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 focus:outline-none focus:border-brand-primary"
            />
            <button
              onClick={() => save('sms', smsPhone)}
              disabled={!smsPhone || saving}
              className="px-3 py-2 bg-brand-primary text-white text-xs font-bold rounded-xl disabled:opacity-40 border-none cursor-pointer"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? '✓' : 'OK'}
            </button>
          </div>
        )}

        {/* Selecionar SMS */}
        {pref !== 'sms' && (
          <button
            onClick={() => { setPref('sms'); }}
            className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-ice-100 text-xs font-bold text-graphite-400 hover:border-ice-200 transition-all cursor-pointer bg-white"
          >
            <Phone size={12} />
            SMS
          </button>
        )}

        {saved && (
          <p className="text-[10px] text-green-600 font-bold flex items-center gap-1">
            <CheckCircle2 size={10} /> Canal salvo com sucesso
          </p>
        )}
      </div>
    );
  }

  // Modo expandido (para uso futuro em página de configurações)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black text-graphite-700">Canal preferido de notificação</h4>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          updatedBy === 'manual'
            ? 'bg-amber-50 text-amber-600 border border-amber-100'
            : 'bg-ice-50 text-graphite-400 border border-ice-100'
        }`}>
          {updatedBy === 'manual' ? 'Definido manualmente' : 'Auto-detectado'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {CHANNELS.map((ch) => {
          const isActive = pref === ch.id;
          return (
            <button
              key={ch.id}
              onClick={() => ch.id !== 'sms' ? save(ch.id) : setPref('sms')}
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

      {pref === 'sms' && (
        <div className="flex gap-2">
          <input
            type="tel"
            value={smsPhone}
            onChange={(e) => setSmsPhone(e.target.value)}
            placeholder="+55 11 99999-9999"
            className="flex-1 text-sm bg-ice-50 border border-ice-200 rounded-2xl px-4 py-2.5 focus:outline-none focus:border-brand-primary"
          />
          <button
            onClick={() => save('sms', smsPhone)}
            disabled={!smsPhone || saving}
            className="px-4 py-2.5 bg-brand-primary text-white font-bold rounded-2xl disabled:opacity-40 border-none cursor-pointer"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? '✓' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  );
}
