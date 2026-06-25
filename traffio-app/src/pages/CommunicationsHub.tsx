/**
 * CommunicationsHub — Central de Comunicações
 * Layout 3 painéis: mini-nav | lista | detalhe
 * Inspirado em apps profissionais de comunicação (estilo Talkpad / Chatwoot)
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, MessageSquare, Phone, Voicemail, Hash,
  PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneCall,
  Search, Download, Mic, MicOff, Play, RefreshCw,
  User, Clock, CheckCheck, Send, TrendingUp, Activity,
  BarChart2,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { formatPhone } from '../lib/formatPhone';
import { format, subDays, startOfDay, endOfDay, startOfMonth } from 'date-fns';
import { getIntlLocale } from '../lib/i18n';
import { getDateFnsLocale } from '../lib/i18n/dateFnsLocale';
import { KpiCard, Card } from '../components/ui';

type Section = 'dashboard' | 'sms' | 'calls' | 'voicemail' | 'numbers';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDur(s: number | null) {
  if (!s) return '—';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}
function fmtTime(iso: string, language: string) {
  const d = new Date(iso), now = new Date();
  const intlLocale = getIntlLocale(language);
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(intlLocale, { day: '2-digit', month: 'short' });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardView({ calls, smsIn, smsOut }: { calls: any[]; smsIn: number; smsOut: number }) {
  const { t, i18n } = useTranslation('communications');
  const thisMonth = calls.filter(c => new Date(c.started_at) >= startOfMonth(new Date()));
  const inbound   = thisMonth.filter(c => c.direction === 'inbound' && c.status === 'completed');
  const outbound  = thisMonth.filter(c => c.direction === 'outbound' && c.status === 'completed');
  const missed    = thisMonth.filter(c => c.status === 'missed');
  const totalMin  = Math.round(thisMonth.reduce((s, c) => s + (c.duration_seconds ?? 0), 0) / 60);

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const day = subDays(new Date(), 6 - i);
    const dc  = calls.filter(c => {
      const d = new Date(c.started_at);
      return d >= startOfDay(day) && d <= endOfDay(day);
    });
    return {
      dia:       format(day, 'EEE', { locale: getDateFnsLocale(i18n.language) }),
      recebidas: dc.filter(c => c.direction === 'inbound').length,
      realizadas: dc.filter(c => c.direction === 'outbound').length,
      perdidas:  dc.filter(c => c.status === 'missed').length,
    };
  });

  const pie = [
    { name: t('communicationsHub.kpis.received'), value: inbound.length,  color: '#10b981' },
    { name: t('communicationsHub.kpis.made'),      value: outbound.length, color: '#3b82f6' },
    { name: t('communicationsHub.kpis.missed'),    value: missed.length,   color: '#ef4444' },
  ].filter(d => d.value > 0);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label={t('communicationsHub.kpis.received')} value={inbound.length} subValue={t('communicationsHub.kpis.currentMonth')} icon={PhoneIncoming} accent="success" />
        <KpiCard label={t('communicationsHub.kpis.made')} value={outbound.length} subValue={t('communicationsHub.kpis.currentMonth')} icon={PhoneOutgoing} accent="info" />
        <KpiCard label={t('communicationsHub.kpis.missed')} value={missed.length} subValue={t('communicationsHub.kpis.currentMonth')} icon={PhoneMissed} accent="error" />
        <KpiCard label={t('communicationsHub.kpis.minutes')} value={`${totalMin}m`} subValue={t('communicationsHub.kpis.currentMonth')} icon={Mic} accent="brand" />
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label={t('communicationsHub.kpis.smsSent')} value={smsOut} subValue={t('communicationsHub.kpis.currentMonth')} icon={MessageSquare} accent="info" />
        <KpiCard label={t('communicationsHub.kpis.smsReceived')} value={smsIn} subValue={t('communicationsHub.kpis.currentMonth')} icon={MessageSquare} accent="success" />
        <KpiCard label={t('communicationsHub.kpis.answerRate')} value={thisMonth.length > 0 ? `${Math.round(((thisMonth.length - missed.length) / thisMonth.length) * 100)}%` : '—'} icon={Activity} accent="indigo" />
        <KpiCard label={t('communicationsHub.kpis.today')} value={calls.filter(c => new Date(c.started_at) >= startOfDay(new Date())).length} subValue={t('communicationsHub.kpis.calls')} icon={TrendingUp} accent="warning" />
      </div>

      <Card variant="default" padding="md">
        <p className="text-sm font-black text-graphite-700 mb-5 flex items-center gap-2">
          <BarChart2 size={16} className="text-brand-primary" /> {t('communicationsHub.chart.last7DaysTitle')}
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={last7} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <defs>
              {[['rec','#10b981'],['rea','#3b82f6'],['per','#ef4444']].map(([id, color]) => (
                <linearGradient key={id} id={`g_${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="dia" tick={{ fontSize: 11, fontWeight: 700, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ background: 'white', border: '1px solid #F1F5F9', borderRadius: 16, fontSize: 12, fontWeight: 700 }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
            <Area type="monotone" dataKey="recebidas"  stroke="#10b981" strokeWidth={2} fill="url(#g_rec)" dot={{ fill: '#10b981', r: 3 }} name={t('communicationsHub.kpis.received')} />
            <Area type="monotone" dataKey="realizadas" stroke="#3b82f6" strokeWidth={2} fill="url(#g_rea)" dot={{ fill: '#3b82f6', r: 3 }} name={t('communicationsHub.kpis.made')} />
            <Area type="monotone" dataKey="perdidas"   stroke="#ef4444" strokeWidth={2} fill="url(#g_per)" dot={{ fill: '#ef4444', r: 3 }} name={t('communicationsHub.kpis.missed')} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {pie.length > 0 && (
        <Card variant="default" padding="md">
          <p className="text-sm font-black text-graphite-700 mb-4">{t('communicationsHub.chart.monthDistributionTitle')}</p>
          <div className="flex items-center gap-8">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={pie} cx="50%" cy="50%" innerRadius={42} outerRadius={60} dataKey="value" paddingAngle={3}>
                  {pie.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'white', border: '1px solid #F1F5F9', borderRadius: 12, fontSize: 12, fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {pie.map(d => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-sm font-bold text-graphite-600">{d.name}</span>
                  <span className="text-sm font-black text-graphite-900 ml-auto">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function CommunicationsHub() {
  const { t, i18n } = useTranslation('communications');
  const { tenant } = useTenant();
  const tenantId   = (tenant as any)?.id;

  const NAV: { id: Section; icon: any; label: string }[] = [
    { id: 'dashboard', icon: LayoutDashboard, label: t('communicationsHub.nav.dashboard') },
    { id: 'sms',       icon: MessageSquare,  label: t('communicationsHub.nav.sms')       },
    { id: 'calls',     icon: Phone,          label: t('communicationsHub.nav.calls')     },
    { id: 'voicemail', icon: Voicemail,      label: t('communicationsHub.nav.voicemail') },
    { id: 'numbers',   icon: Hash,           label: t('communicationsHub.nav.numbers')   },
  ];

  const [section,     setSection]     = useState<Section>('calls');
  const [calls,       setCalls]       = useState<any[]>([]);
  const [smsSessions, setSmsSessions] = useState<any[]>([]);
  const [smsMessages, setSmsMessages] = useState<any[]>([]);
  const [voicemails,  setVoicemails]  = useState<any[]>([]);
  const [numbers,     setNumbers]     = useState<any[]>([]);
  const [monthUsage,  setMonthUsage]  = useState<any>(null);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState<any>(null);
  const [search,      setSearch]      = useState('');
  const [smsText,     setSmsText]     = useState('');
  const smsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!tenantId) return; fetchAll(); }, [tenantId]);

  useEffect(() => {
    if (selected && section === 'sms') fetchSmsMessages(selected.patient_phone);
  }, [selected, section]);

  useEffect(() => {
    smsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [smsMessages]);

  useEffect(() => {
    if (!tenantId) return;

    // Realtime subscription for call_records
    const callsChannel = supabase
      .channel('public:call_records')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'call_records', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setCalls(prev => [payload.new, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setCalls(prev => prev.map(c => c.id === payload.new.id ? payload.new : c));
            setSelected(prev => prev?.id === payload.new.id ? payload.new : prev);
          } else if (payload.eventType === 'DELETE') {
            setCalls(prev => prev.filter(c => c.id !== payload.old.id));
            setSelected(prev => prev?.id === payload.old.id ? null : prev);
          }
        }
      )
      .subscribe();

    // Realtime subscription for voicemails
    const vmChannel = supabase
      .channel('public:voicemails')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'voicemails', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setVoicemails(prev => [payload.new, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setVoicemails(prev => prev.map(v => v.id === payload.new.id ? payload.new : v));
          } else if (payload.eventType === 'DELETE') {
            setVoicemails(prev => prev.filter(v => v.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(callsChannel);
      supabase.removeChannel(vmChannel);
    };
  }, [tenantId]);

  async function fetchAll() {
    setLoading(true);
    const [callsRes, smsRes, vmRes, numRes, usageRes] = await Promise.all([
      supabase.from('call_records').select('*').eq('tenant_id', tenantId).order('started_at', { ascending: false }).limit(100),
      supabase.from('conversation_sessions').select('id, patient_phone, channel, updated_at, context').eq('tenant_id', tenantId).eq('channel', 'sms').order('updated_at', { ascending: false }).limit(50),
      supabase.from('voicemails').select('*').eq('tenant_id', tenantId).eq('is_deleted', false).order('created_at', { ascending: false }),
      supabase.from('tenant_phone_numbers').select('*').eq('tenant_id', tenantId).order('created_at'),
      supabase.from('tenant_current_month_usage').select('*').eq('tenant_id', tenantId).maybeSingle(),
    ]);
    setCalls(callsRes.data ?? []);
    setSmsSessions(smsRes.data ?? []);
    setVoicemails(vmRes.data ?? []);
    setNumbers(numRes.data ?? []);
    setMonthUsage(usageRes.data);
    setLoading(false);
  }

  async function fetchSmsMessages(phone: string) {
    const { data: session } = await supabase.from('conversation_sessions').select('id').eq('tenant_id', tenantId).eq('patient_phone', phone).maybeSingle();
    if (!session) return;
    const { data: msgs } = await supabase.from('conversation_messages').select('id, role, content, created_at').eq('session_id', session.id).order('created_at').limit(100);
    setSmsMessages(msgs ?? []);
  }

  async function sendSms() {
    if (!smsText.trim() || !selected) return;
    const text = smsText.trim();
    setSmsText('');
    // Inserir mensagem localmente para resposta imediata
    setSmsMessages(prev => [...prev, { id: 'tmp', role: 'human', content: text, created_at: new Date().toISOString() }]);
    // TODO: chamar telnyx-numbers send_sms quando implementado no backend
  }

  // ── Listas filtradas ─────────────────────────────────────────────────────────

  const filteredCalls = useMemo(() =>
    calls.filter(c => !search || c.from_number?.includes(search) || c.to_number?.includes(search)),
    [calls, search]
  );

  const filteredSms = useMemo(() =>
    smsSessions.filter(s => !search || s.patient_phone?.includes(search)),
    [smsSessions, search]
  );

  if (!(tenant as any)?.telnyx_enabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-12 text-center">
        <div className="w-20 h-20 rounded-3xl bg-ice-50 border border-ice-100 flex items-center justify-center">
          <Phone size={36} className="text-graphite-300" />
        </div>
        <h2 className="text-2xl font-black text-graphite-700">{t('communicationsHub.notEnabled.title')}</h2>
        <p className="text-sm text-graphite-400 max-w-sm">{t('communicationsHub.notEnabled.messagePrefix')} <strong>{t('communicationsHub.notEnabled.settingsPath')}</strong>.</p>
      </div>
    );
  }

  // ── Conteúdo do painel de detalhe ────────────────────────────────────────────

  const renderDetail = () => {
    if (section === 'dashboard') return null;

    if (!selected) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 opacity-40">
          {section === 'calls'     && <><Phone size={48} className="text-graphite-300" /><p className="font-bold text-graphite-400 text-sm">{t('communicationsHub.detail.selectCall')}</p></>}
          {section === 'sms'       && <><MessageSquare size={48} className="text-graphite-300" /><p className="font-bold text-graphite-400 text-sm">{t('communicationsHub.detail.selectConversation')}</p></>}
          {section === 'voicemail' && <><Voicemail size={48} className="text-graphite-300" /><p className="font-bold text-graphite-400 text-sm">{t('communicationsHub.detail.selectVoicemail')}</p></>}
          {section === 'numbers'   && <><Hash size={48} className="text-graphite-300" /><p className="font-bold text-graphite-400 text-sm">{t('communicationsHub.detail.selectNumber')}</p></>}
        </div>
      );
    }

    // Detalhe: CHAMADA
    if (section === 'calls') {
      const num = selected.direction === 'inbound' ? selected.from_number : selected.to_number;
      return (
        <div className="flex-1 flex flex-col">
          {/* Header do detalhe */}
          <div className="px-6 py-4 border-b border-ice-100 flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${selected.status === 'missed' ? 'bg-red-50' : selected.direction === 'inbound' ? 'bg-green-50' : 'bg-blue-50'}`}>
              {selected.status === 'missed' ? <PhoneMissed size={20} className="text-red-400" /> : selected.direction === 'inbound' ? <PhoneIncoming size={20} className="text-green-500" /> : <PhoneOutgoing size={20} className="text-blue-500" />}
            </div>
            <div className="flex-1">
              <p className="font-black text-graphite-900 text-lg">{formatPhone(num)}</p>
              <p className="text-xs text-graphite-400">{selected.direction === 'inbound' ? t('communicationsHub.detail.inbound') : t('communicationsHub.detail.outbound')} · {fmtTime(selected.started_at, i18n.language)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('softphone:dial', { detail: { number: num } }))}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-bold rounded-xl border-none cursor-pointer"
              >
                <PhoneCall size={15} /> {t('communicationsHub.detail.callBack')}
              </button>
              <button
                onClick={() => {
                  setSection('sms');
                  setSmsMessages([]);
                  const existingSession = smsSessions.find(s => s.patient_phone === num);
                  if (existingSession) {
                    setSelected(existingSession);
                  } else {
                    setSelected({
                      patient_phone: num,
                      updated_at: new Date().toISOString()
                    });
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white text-sm font-bold rounded-xl border-none cursor-pointer"
              >
                <MessageSquare size={15} /> {t('communicationsHub.detail.sendSms')}
              </button>
            </div>
          </div>

          {/* Info cards */}
          <div className="px-6 py-4 grid grid-cols-3 gap-3">
            {[{ label: t('communicationsHub.detail.duration'), value: fmtDur(selected.duration_seconds) }, { label: t('communicationsHub.detail.status'), value: selected.status }, { label: t('communicationsHub.detail.answered'), value: selected.answered_at ? fmtTime(selected.answered_at, i18n.language) : '—' }].map(i => (
              <div key={i.label} className="bg-ice-50 border border-ice-100 rounded-xl p-3">
                <p className="text-[10px] font-bold text-graphite-400 uppercase mb-1">{i.label}</p>
                <p className="text-sm font-black text-graphite-800 capitalize">{i.value}</p>
              </div>
            ))}
          </div>

          {/* Gravação */}
          <div className="mx-6 bg-white border border-ice-100 rounded-2xl p-4 mb-4">
            <p className="text-xs font-black text-graphite-400 uppercase mb-3 flex items-center gap-1.5"><Mic size={12} /> {t('communicationsHub.detail.recording')}</p>
            {selected.recording_url ? (
              <>
                <audio controls src={selected.recording_url} className="w-full" style={{ borderRadius: 10 }} />
                <a href={selected.recording_url} download target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 mt-2 text-xs font-bold text-brand-primary hover:underline">
                  <Download size={11} /> {t('communicationsHub.detail.download')}
                </a>
              </>
            ) : (
              <p className="text-sm text-graphite-400 italic">Nenhuma gravação disponível para esta chamada.</p>
            )}
          </div>

          {/* Notas */}
          <div className="mx-6 bg-white border border-ice-100 rounded-2xl p-4">
            <p className="text-xs font-black text-graphite-400 uppercase mb-2">{t('communicationsHub.detail.notes')}</p>
            <textarea
              defaultValue={selected.call_notes ?? ''}
              onBlur={async e => {
                await supabase.from('call_records').update({ call_notes: e.target.value }).eq('id', selected.id).eq('tenant_id', tenantId);
              }}
              placeholder={t('communicationsHub.detail.notesPlaceholder')} rows={4}
              className="w-full text-sm bg-ice-50 border border-ice-100 rounded-xl p-3 resize-none focus:outline-none focus:border-brand-primary"
            />
          </div>
        </div>
      );
    }

    // Detalhe: SMS (estilo chat)
    if (section === 'sms') {
      return (
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="px-5 py-4 border-b border-ice-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
              <User size={18} className="text-emerald-600" />
            </div>
            <div>
              <p className="font-black text-graphite-900">{formatPhone(selected.patient_phone)}</p>
              <p className="text-xs text-graphite-400">{t('communicationsHub.nav.sms')} · {fmtTime(selected.updated_at, i18n.language)}</p>
            </div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('softphone:dial', { detail: { number: selected.patient_phone } }))}
              className="ml-auto w-9 h-9 bg-green-50 hover:bg-green-100 rounded-xl flex items-center justify-center text-green-600 border-none cursor-pointer"
              title={t('communicationsHub.detail.callTitle')}
            >
              <Phone size={16} />
            </button>
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-[#F7F9FC]">
            {smsMessages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'human' || msg.role === 'assistant' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[72%] px-4 py-2.5 rounded-2xl text-sm ${
                  msg.role === 'user'
                    ? 'bg-white border border-ice-100 text-graphite-800 rounded-bl-sm'
                    : 'bg-brand-primary text-white rounded-br-sm'
                }`}>
                  <p className="leading-relaxed">{msg.content}</p>
                  <p className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-graphite-400' : 'text-white/60'}`}>
                    {fmtTime(msg.created_at, i18n.language)}
                    {(msg.role === 'human' || msg.role === 'assistant') && <CheckCheck size={10} className="inline ml-1" />}
                  </p>
                </div>
              </div>
            ))}
            {smsMessages.length === 0 && (
              <div className="text-center py-8 text-graphite-300">
                <MessageSquare size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm font-bold">{t('communicationsHub.detail.noMessagesYet')}</p>
              </div>
            )}
            <div ref={smsEndRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-ice-100 bg-white flex items-end gap-3">
            <textarea
              value={smsText}
              onChange={e => setSmsText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSms(); } }}
              placeholder={t('communicationsHub.detail.smsPlaceholder')}
              rows={1}
              maxLength={160}
              className="flex-1 text-sm bg-ice-50 border border-ice-200 rounded-2xl px-4 py-2.5 resize-none focus:outline-none focus:border-brand-primary"
            />
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] text-graphite-300">{smsText.length}/160</span>
              <button
                onClick={sendSms}
                disabled={!smsText.trim()}
                className="w-9 h-9 bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-40 rounded-xl flex items-center justify-center border-none cursor-pointer"
              >
                <Send size={15} className="text-white" />
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Detalhe: Voicemail
    if (section === 'voicemail') {
      return (
        <div className="flex-1 flex flex-col">
          <div className="px-6 py-4 border-b border-ice-100 flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
              <Voicemail size={22} className="text-indigo-500" />
            </div>
            <div className="flex-1">
              <p className="font-black text-graphite-900 text-lg">{formatPhone(selected.from_number)}</p>
              <p className="text-xs text-graphite-400">{fmtTime(selected.created_at, i18n.language)}{selected.duration_seconds && ` · ${fmtDur(selected.duration_seconds)}`}</p>
            </div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('softphone:dial', { detail: { number: selected.from_number } }))}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-bold rounded-xl border-none cursor-pointer"
            >
              <PhoneCall size={15} /> {t('communicationsHub.detail.callBack')}
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div className="bg-white border border-ice-100 rounded-2xl p-5">
              <p className="text-xs font-black text-graphite-400 uppercase mb-3 flex items-center gap-1.5"><Mic size={12} /> {t('communicationsHub.detail.audio')}</p>
              <audio controls src={selected.recording_url} className="w-full" style={{ borderRadius: 10 }} />
            </div>
            {selected.transcript && (
              <div className="bg-white border border-ice-100 rounded-2xl p-5">
                <p className="text-xs font-black text-graphite-400 uppercase mb-2">{t('communicationsHub.detail.transcript')}</p>
                <p className="text-sm text-graphite-700 italic">"{selected.transcript}"</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  // ── Lista do painel central ──────────────────────────────────────────────────

  const renderList = () => {
    if (section === 'dashboard') return null;

    return (
      <div className="w-80 border-r border-ice-100 flex flex-col bg-white shrink-0">
        {/* Busca */}
        <div className="px-4 py-3 border-b border-ice-50">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('communicationsHub.list.searchPlaceholder')}
              className="w-full pl-8 pr-3 py-2 text-sm bg-ice-50 border border-ice-200 rounded-xl focus:outline-none focus:border-brand-primary" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-ice-50">
          {loading && <div className="flex justify-center py-10"><RefreshCw size={20} className="animate-spin text-graphite-300" /></div>}

          {/* Lista Chamadas */}
          {section === 'calls' && filteredCalls.map(call => {
            const num = call.direction === 'inbound' ? call.from_number : call.to_number;
            return (
              <button key={call.id} onClick={() => setSelected(call)}
                className={`w-full text-left px-4 py-3.5 hover:bg-ice-50 flex items-center gap-3 transition-colors ${selected?.id === call.id ? 'bg-ice-50 border-l-2 border-brand-primary' : ''}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${call.status === 'missed' ? 'bg-red-50' : call.direction === 'inbound' ? 'bg-green-50' : 'bg-blue-50'}`}>
                  {call.status === 'missed' ? <PhoneMissed size={15} className="text-red-400" /> : call.direction === 'inbound' ? <PhoneIncoming size={15} className="text-green-500" /> : <PhoneOutgoing size={15} className="text-blue-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-graphite-800 truncate">{formatPhone(num)}</p>
                  <p className="text-xs text-graphite-400 flex items-center gap-1 mt-0.5">
                    <Clock size={10} />{fmtTime(call.started_at, i18n.language)}
                    {call.duration_seconds && <span className="ml-1">{fmtDur(call.duration_seconds)}</span>}
                  </p>
                </div>
                {call.recording_url && <Play size={11} className="text-brand-primary shrink-0" />}
                {call.status === 'missed' && <div className="w-2 h-2 rounded-full bg-red-400 shrink-0" />}
              </button>
            );
          })}

          {/* Lista SMS */}
          {section === 'sms' && filteredSms.map(s => (
            <button key={s.id} onClick={() => { setSelected(s); setSmsMessages([]); }}
              className={`w-full text-left px-4 py-3.5 hover:bg-ice-50 flex items-center gap-3 transition-colors ${selected?.id === s.id ? 'bg-ice-50 border-l-2 border-brand-primary' : ''}`}>
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <MessageSquare size={15} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-graphite-800 truncate">{formatPhone(s.patient_phone)}</p>
                <p className="text-xs text-graphite-400 mt-0.5">{fmtTime(s.updated_at, i18n.language)}</p>
              </div>
            </button>
          ))}

          {/* Lista Voicemail */}
          {section === 'voicemail' && voicemails.map(vm => (
            <button key={vm.id} onClick={async () => { setSelected(vm); if (!vm.is_read) { await supabase.from('voicemails').update({ is_read: true }).eq('id', vm.id).eq('tenant_id', tenantId); setVoicemails(prev => prev.map(v => v.id === vm.id ? { ...v, is_read: true } : v)); } }}
              className={`w-full text-left px-4 py-3.5 hover:bg-ice-50 flex items-center gap-3 transition-colors ${selected?.id === vm.id ? 'bg-ice-50 border-l-2 border-brand-primary' : ''}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${vm.is_read ? 'bg-ice-100' : 'bg-indigo-100'}`}>
                <Voicemail size={15} className={vm.is_read ? 'text-graphite-400' : 'text-indigo-500'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold truncate ${vm.is_read ? 'text-graphite-500' : 'text-graphite-800'}`}>{formatPhone(vm.from_number)}</p>
                <p className="text-xs text-graphite-400 mt-0.5">{fmtTime(vm.created_at, i18n.language)}{vm.duration_seconds && ` · ${fmtDur(vm.duration_seconds)}`}</p>
              </div>
              {!vm.is_read && <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />}
            </button>
          ))}

          {/* Lista Números */}
          {section === 'numbers' && numbers.map(num => (
            <div key={num.id} className="px-4 py-3.5 flex items-center gap-3 border-b border-ice-50">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                <Hash size={15} className="text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-graphite-800 font-mono truncate">{num.phone_number}</p>
                <p className="text-xs text-graphite-400">{num.friendly_name ?? num.country_code}{num.capabilities?.voice && ` · ${t('communicationsHub.list.voiceSuffix')}`}{num.capabilities?.sms && ` · ${t('communicationsHub.list.smsSuffix')}`}</p>
              </div>
              <div className={`w-2 h-2 rounded-full ${num.is_active ? 'bg-green-500' : 'bg-graphite-300'}`} />
            </div>
          ))}

          {/* Empty states */}
          {!loading && section === 'calls'     && filteredCalls.length === 0    && <p className="text-center py-10 text-sm text-graphite-300 font-bold">{t('communicationsHub.list.noCalls')}</p>}
          {!loading && section === 'sms'       && filteredSms.length === 0      && <p className="text-center py-10 text-sm text-graphite-300 font-bold">{t('communicationsHub.list.noSmsConversations')}</p>}
          {!loading && section === 'voicemail' && voicemails.length === 0       && <p className="text-center py-10 text-sm text-graphite-300 font-bold">{t('communicationsHub.list.noVoicemails')}</p>}
          {!loading && section === 'numbers'   && numbers.length === 0          && <p className="text-center py-10 text-sm text-graphite-300 font-bold">{t('communicationsHub.list.noNumbers')}</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full bg-white rounded-3xl border-none shadow-float overflow-hidden">

      {/* ── Mini-nav lateral esquerda ───────────────────────────────────────── */}
      <div className="w-16 bg-transparent border-r border-ice-100 flex flex-col items-center py-4 gap-1 shrink-0">
        {NAV.map(n => {
          const isActive = section === n.id;
          return (
            <button key={n.id} onClick={() => { setSection(n.id); setSelected(null); setSearch(''); }}
              title={n.label}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all border-none cursor-pointer group relative ${isActive ? 'bg-accent-info text-white' : 'text-graphite-400 hover:bg-ice-50 hover:text-graphite-900'}`}>
              <n.icon size={19} />
              {/* Tooltip */}
              <span className="absolute left-12 bg-graphite-900 text-white text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                {n.label}
              </span>
            </button>
          );
        })}

        <div className="flex-1" />

        <button onClick={fetchAll} title={t('communicationsHub.list.refresh')}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-graphite-400 hover:bg-ice-50 hover:text-graphite-900 transition-all border-none cursor-pointer"
        >
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Dashboard (ocupa toda a área) ──────────────────────────────────── */}
      {section === 'dashboard' && (
        <DashboardView
          calls={calls}
          smsIn={Number(monthUsage?.sms_inbound_count ?? 0)}
          smsOut={Number(monthUsage?.sms_outbound_count ?? 0)}
        />
      )}

      {/* ── Lista central + detalhe ────────────────────────────────────────── */}
      {section !== 'dashboard' && (
        <>
          {renderList()}
          <div className="flex-1 flex flex-col bg-[#F7F9FC] overflow-hidden">
            {renderDetail()}
          </div>
        </>
      )}
    </div>
  );
}
