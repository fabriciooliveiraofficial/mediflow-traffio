import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  User, Loader2,
  DollarSign,
  Search, TrendingUp, Activity, Save, X, Clock, AlertTriangle,
  ListTodo, Columns3, Zap,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useTenant } from '../contexts/TenantContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useFollowUpMetrics } from '../hooks/useFollowUpMetrics';
import { useToast } from '../contexts/ToastContext';
import { PerformanceStats } from '../components/followup/PerformanceStats';
import {
  CRM_STAGES, CRM_STAGE_ICONS, CRM_STAGE_LABEL_KEYS,
  LOST_REASON_LABEL_KEYS, type CrmStageId,
} from '../lib/crmStages';
import { useTranslation } from 'react-i18next';
import { Badge, Button, IconButton, EmptyState, PageHeader } from '../components/ui';
import { FollowUpTimelineDrawer } from '../components/crm/FollowUpTimelineDrawer';
import { TodayQueue, CHANNEL_DOT, type JourneyChannel } from '../components/crm/TodayQueue';
import { FollowUpAutomationsPanel } from '../components/crm/FollowUpAutomationsPanel';
import { FunnelStrip } from '../components/crm/FunnelStrip';
import { LostReasonModal } from '../components/crm/LostReasonModal';
import { classifyJourney, shortElapsed, type JourneyActivity } from '../lib/followUpToday';
import type { JourneyNextStep } from '../components/crm/FollowUpTimelineDrawer';

type FollowUpView = 'today' | 'pipeline' | 'results';
const VIEW_STORAGE_KEY = 'traffio.followup.view';

function readStoredView(): FollowUpView {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    return v === 'pipeline' || v === 'results' ? v : 'today';
  } catch {
    return 'today';
  }
}

export interface CrmJourneyIdentity {
  channel: 'whatsapp' | 'instagram' | 'facebook' | 'livechat' | 'sms' | 'phone';
  identifier: string;
  display_name: string | null;
}

export interface CrmJourney {
  id: string;
  tenant_id: string;
  patient_id: string | null;
  lead_phone: string | null;
  session_id: string | null;
  stage_id: CrmStageId;
  origin: 'conversation' | 'walk_in' | 'manual' | 'import' | 'recall';
  revenue_estimated: number;
  procedure_name: string | null;
  appointments_count: number;
  no_show_count: number;
  next_appointment_at: string | null;
  next_appointment_status: string | null;
  priority_score: number;
  next_action_at: string | null;
  next_action_type: string | null;
  lost_reason: string | null;
  needs_action: boolean;
  stage_entered_at: string;
  last_event_at: string;
  created_at: string;
  patients: { full_name: string; phone: string } | null;
  conversation_sessions: { channel: string | null; context: any; patient_phone: string; platform_display_name: string | null } | null;
  crm_journey_identities: CrmJourneyIdentity[];
}

export function FollowUpBoard() {
  const { t } = useTranslation('crm');
  const { tenant } = useTenant();
  const { formatDateTime } = useLocaleFormat();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [journeys, setJourneys] = useState<CrmJourney[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [view, setViewState] = useState<FollowUpView>(readStoredView);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<CrmStageId | null>(null);
  const [activity, setActivity] = useState<Record<string, JourneyActivity>>({});
  const [automationsOpen, setAutomationsOpen] = useState(false);

  const setView = (v: FollowUpView) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* preferência só local */ }
  };

  const [saleModal, setSaleModal] = useState<{ id: string; procedure: string; value: string } | null>(null);
  const [lostModal, setLostModal] = useState<{ id: string; name?: string } | null>(null);
  const [selectedJourney, setSelectedJourney] = useState<CrmJourney | null>(null);

  const { metrics, isLoading: loadingMetrics, refetch: refetchMetrics } = useFollowUpMetrics({
    tenantId: tenant?.id || '',
    days,
    timezone: tenant?.timezone,
  });

  useEffect(() => {
    if (!tenant?.id) return;
    loadBoard();

    const channel = supabase
      .channel(`followup-journeys-${tenant.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crm_journeys', filter: `tenant_id=eq.${tenant.id}` },
        () => { loadBoard(); refetchMetrics(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant?.id]);

  const loadBoard = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const [{ data, error }, { data: act, error: actError }] = await Promise.all([
      supabase
        .from('crm_journeys')
        .select('*, patients(full_name, phone), conversation_sessions(channel, context, patient_phone, platform_display_name), crm_journey_identities(channel, identifier, display_name)')
        .eq('tenant_id', tenant.id)
        .order('last_event_at', { ascending: false })
        .limit(1000),
      supabase.rpc('crm_journey_latest_activity', { p_tenant_id: tenant.id }),
    ]);

    if (error) console.error('[FollowUpBoard] load error:', error);
    if (actError) console.error('[FollowUpBoard] activity error:', actError);
    setJourneys((data as any) || []);

    const map: Record<string, JourneyActivity> = {};
    for (const row of (act as any[]) || []) {
      map[row.out_journey_id] = {
        lastType: row.out_last_type,
        lastPreview: row.out_last_preview,
        lastActor: row.out_last_actor,
        lastAt: row.out_last_at,
        patientMsgAt: row.out_patient_msg_at,
        teamMsgAt: row.out_team_msg_at,
      };
    }
    setActivity(map);
    setLoading(false);
  };

  // Resolução de nome em cascata (padrão identity resolution):
  // cadastro do paciente → nome real capturado em qualquer identidade de canal
  // → platform_display_name da sessão → context legado → genérico (último recurso)
  // Nome de verdade (cadastro, identidade de canal ou perfil); null quando não há
  const realName = (j: CrmJourney): string | null => {
    if (j.patients?.full_name) return j.patients.full_name;
    const identityName = (j.crm_journey_identities || []).find(i => i.display_name)?.display_name;
    if (identityName) return identityName;
    if (j.conversation_sessions?.platform_display_name) return j.conversation_sessions.platform_display_name;
    const ctx = j.conversation_sessions?.context;
    return ctx?.visitor_name || ctx?.username || ctx?.name || null;
  };

  const displayName = (j: CrmJourney) => {
    const name = realName(j);
    if (name) return name;
    // Sem nome: "Contato do WhatsApp · final 7006" em vez do número cru
    const phone = j.lead_phone || j.patients?.phone || j.conversation_sessions?.patient_phone || '';
    const digits = phone.replace(/\D/g, '');
    const channelLabel = t(`today.channel.${primaryChannel(j)}`);
    return digits.length >= 4
      ? t('today.unnamed', { channel: channelLabel, last4: digits.slice(-4) })
      : t('today.unnamedNoPhone', { channel: channelLabel });
  };

  // Canal principal do card — define a bolinha colorida no avatar
  const primaryChannel = (j: CrmJourney): JourneyChannel => {
    const session = j.conversation_sessions?.channel;
    if (session && ['whatsapp', 'instagram', 'facebook', 'livechat', 'sms', 'phone'].includes(session)) {
      return session as JourneyChannel;
    }
    const identity = (j.crm_journey_identities || [])[0]?.channel;
    if (identity) return identity as JourneyChannel;
    return j.origin === 'walk_in' ? 'walk_in' : 'whatsapp';
  };

  // Busca unificada: nome resolvido, telefone e identidades de qualquer canal
  const filteredJourneys = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return journeys;
    const qDigits = q.replace(/\D/g, '');
    return journeys.filter(j => {
      if (displayName(j).toLowerCase().includes(q)) return true;
      if (qDigits && (j.lead_phone || '').replace(/\D/g, '').includes(qDigits)) return true;
      if (qDigits && (j.patients?.phone || '').replace(/\D/g, '').includes(qDigits)) return true;
      return (j.crm_journey_identities || []).some(i =>
        (i.display_name || '').toLowerCase().includes(q) || i.identifier.includes(qDigits || q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeys, search]);

  // Integração real com as outras páginas: conversa via deep-link que o
  // HumanInboxPage já suporta (?handoff_session=), agenda via navegação
  const openConversation = (j: CrmJourney) => {
    if (!j.session_id) return;
    navigate('/dashboard/inbox?handoff_session=' + j.session_id);
  };

  const openBooking = (_j: CrmJourney) => {
    navigate('/dashboard/agenda');
  };

  const openProposals = (_j: CrmJourney) => {
    navigate('/dashboard/proposals');
  };

  // Números da faixa do funil (Fechado conta só os últimos 30 dias)
  const funnelCounts = useMemo(() => {
    const counts: Partial<Record<CrmStageId, number>> = {};
    const since = Date.now() - 30 * 86_400_000;
    for (const j of filteredJourneys) {
      if (j.stage_id === 'lost') continue;
      if (j.stage_id === 'won' && new Date(j.stage_entered_at).getTime() < since) continue;
      counts[j.stage_id] = (counts[j.stage_id] ?? 0) + 1;
    }
    return counts;
  }, [filteredJourneys]);

  // No Funil, clicar numa etapa da faixa rola até a coluna
  const handleFunnelSelect = (stage: CrmStageId | null) => {
    if (view === 'pipeline') {
      if (stage) document.getElementById(`pipeline-col-${stage}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      return;
    }
    setStageFilter(stage);
  };

  // Patch otimista: a linha reage no mesmo instante do clique, sem esperar
  // o round-trip do banco nem o realtime
  const patchJourney = (id: string, patch: Partial<CrmJourney>) => {
    setJourneys(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
  };

  const moveStage = async (journeyId: string, toStage: CrmStageId, extra: Record<string, any> = {}, reason?: string) => {
    // Optimistic update
    setJourneys(prev => prev.map(j => j.id === journeyId ? { ...j, stage_id: toStage } : j));

    const { error } = await supabase.rpc('crm_move_stage', {
      p_journey_id: journeyId,
      p_to_stage: toStage,
      p_actor: 'user',
      p_reason: reason ?? null,
      p_extra: extra,
    });

    if (error) {
      console.error(error);
      showToast('error', error.message || t('followUp.toasts.moveError', { defaultValue: 'Não foi possível mover o card.' }));
      loadBoard();
    } else {
      refetchMetrics();
    }
  };

  // --- Lógica de Auto-Scroll Horizontal no Drag and Drop ---
  const pipelineContainerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollAnimRef = useRef<number | null>(null);
  const scrollSpeedRef = useRef<number>(0);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollAnimRef.current !== null) {
      cancelAnimationFrame(autoScrollAnimRef.current);
      autoScrollAnimRef.current = null;
    }
    scrollSpeedRef.current = 0;
  }, []);

  const startAutoScroll = useCallback(() => {
    if (autoScrollAnimRef.current !== null) return;

    const loop = () => {
      if (pipelineContainerRef.current && scrollSpeedRef.current !== 0) {
        pipelineContainerRef.current.scrollLeft += scrollSpeedRef.current;
        autoScrollAnimRef.current = requestAnimationFrame(loop);
      } else {
        stopAutoScroll();
      }
    };

    autoScrollAnimRef.current = requestAnimationFrame(loop);
  }, [stopAutoScroll]);

  const handleBoardDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Necessário para permitir o drop em contêineres e nos filhos
    if (!pipelineContainerRef.current) return;

    const container = pipelineContainerRef.current;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX;
    const threshold = 120; // Zona de disparo em pixels das bordas esquerda e direita
    const maxSpeed = 24;   // Velocidade máxima em px/frame

    const distRight = rect.right - mouseX;
    const distLeft = mouseX - rect.left;

    if (distRight < threshold && distRight > 0) {
      // Mouse perto da borda direita -> rolar para a direita
      const intensity = 1 - Math.max(0, distRight) / threshold;
      scrollSpeedRef.current = Math.max(4, Math.round(intensity * maxSpeed));
      startAutoScroll();
    } else if (distLeft < threshold && distLeft > 0) {
      // Mouse perto da borda esquerda -> rolar para a esquerda
      const intensity = 1 - Math.max(0, distLeft) / threshold;
      scrollSpeedRef.current = -Math.max(4, Math.round(intensity * maxSpeed));
      startAutoScroll();
    } else {
      // No centro -> parar rolagem
      stopAutoScroll();
    }
  };

  const handleDragEnd = () => {
    stopAutoScroll();
  };

  useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, [stopAutoScroll]);
  // ---------------------------------------------------------

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('journey_id', id);
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = async (e: React.DragEvent, stage: CrmStageId) => {
    e.preventDefault();
    stopAutoScroll();
    const id = e.dataTransfer.getData('journey_id');
    if (!id || !tenant?.id) return;

    if (stage === 'won') {
      const journey = journeys.find(j => j.id === id);
      setSaleModal({ id, procedure: journey?.procedure_name || '', value: journey?.revenue_estimated?.toString() || '' });
      return;
    }
    if (stage === 'lost') {
      const journey = journeys.find(j => j.id === id);
      setLostModal({ id, name: journey ? displayName(journey) : undefined });
      return;
    }
    moveStage(id, stage);
  };

  const handleSaveSale = () => {
    if (!saleModal) return;
    const valueNum = parseFloat(saleModal.value.replace(/[^0-9.]/g, '')) || 0;
    moveStage(saleModal.id, 'won', { revenue_estimated: valueNum, procedure_name: saleModal.procedure });
    setSaleModal(null);
  };

  const handleSaveLostReason = (reason: string, notes?: string) => {
    if (!lostModal) return;
    moveStage(lostModal.id, 'lost', notes ? { lost_notes: notes } : {}, reason);
    setLostModal(null);
  };

  // Próximo passo sugerido na ficha — mesma regra da lista Hoje
  const nextStepFor = (j: CrmJourney): JourneyNextStep => {
    const c = classifyJourney(j, activity[j.id], Date.now());
    const description = t(`today.reason.${c.reason.key}`, {
      time: shortElapsed(c.reason.since, Date.now()),
      date: c.reason.at ? formatDateTime(c.reason.at) : '',
    });
    const run = c.action === 'reply' || c.action === 'confirm'
      ? (j.session_id ? () => openConversation(j) : undefined)
      : c.action === 'reschedule' ? () => openBooking(j)
      : c.action === 'proposal' ? () => openProposals(j)
      : undefined;
    return { label: t(`today.actions.${c.action}`), description, run };
  };

  if (loading && journeys.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)] bg-white rounded-2xl border border-ice-200">
        <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] bg-ice-50/50 rounded-2xl flex flex-col shadow-float overflow-hidden">
      {/* Cabeçalho: título, busca e UMA fileira de abas */}
      <div className="px-6 pt-5 bg-white border-b border-ice-100 shrink-0 flex flex-col gap-4">
        <PageHeader
          icon={TrendingUp}
          title={t('followUp.title')}
          subtitle={t('followUp.subtitle')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setAutomationsOpen(true)}>
              <Zap className="w-4 h-4" />
              {t('automations.open')}
            </Button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite-400" />
              <label htmlFor="followup-search" className="sr-only">{t('followUp.searchPlaceholder')}</label>
              <input
                id="followup-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('followUp.searchPlaceholder')}
                className="w-64 max-w-full bg-ice-50 border border-ice-100 rounded-2xl pl-9 pr-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-brand-primary focus:border-transparent outline-none transition-all"
              />
            </div>
            </div>
          }
        />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <nav className="flex gap-6" role="tablist" aria-label={t('followUp.title')}>
            {([
              { key: 'today', icon: ListTodo, label: t('followUp.views.today') },
              { key: 'pipeline', icon: Columns3, label: t('followUp.views.pipeline') },
              { key: 'results', icon: Activity, label: t('followUp.views.results') },
            ] as { key: FollowUpView; icon: typeof ListTodo; label: string }[]).map(tab => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={view === tab.key}
                onClick={() => setView(tab.key)}
                className={clsx(
                  'flex items-center gap-2 pb-3 -mb-px text-sm font-black border-0 border-b-2 bg-transparent cursor-pointer transition-colors',
                  view === tab.key ? 'border-brand-primary text-graphite-900' : 'border-transparent text-graphite-400 hover:text-graphite-700',
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>

          {view === 'results' && (
            <div className="flex gap-1.5 pb-2.5" role="group" aria-label={t('followUp.periodLabel')}>
              {[7, 30, 90].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  aria-pressed={days === d}
                  className={clsx(
                    'px-3 py-1 text-xs font-bold rounded-xl border cursor-pointer transition-colors',
                    days === d ? 'bg-brand-primary border-brand-primary text-white' : 'bg-white border-ice-200 text-graphite-500 hover:bg-ice-50',
                  )}
                >
                  {t('followUp.daysFilter', { count: d })}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar flex flex-col gap-6">
        {view !== 'results' && (
          <FunnelStrip counts={funnelCounts} selected={view === 'today' ? stageFilter : null} onSelect={handleFunnelSelect} />
        )}

        {view === 'results' && <PerformanceStats metrics={metrics} isLoading={loadingMetrics} />}

        {view === 'today' && (
          <TodayQueue
            journeys={filteredJourneys}
            activity={activity}
            stageFilter={stageFilter}
            onClearFilter={() => setStageFilter(null)}
            displayName={displayName}
            hasRealName={(j) => !!realName(j)}
            primaryChannel={primaryChannel}
            onOpenJourney={setSelectedJourney}
            onOpenConversation={openConversation}
            onBook={openBooking}
            onProposal={openProposals}
            onPatch={patchJourney}
            onRefresh={() => { loadBoard(); refetchMetrics(); }}
          />
        )}

        {/* Pipeline (kanban) — visão de mapa */}
        {view === 'pipeline' && (
        <div
          className="flex gap-5 h-full items-start overflow-x-auto pb-6"
          ref={pipelineContainerRef}
          onDragOver={handleBoardDragOver}
        >
          {CRM_STAGES.map(stage => {
            const columnJourneys = filteredJourneys.filter(j => j.stage_id === stage);
            const StageIcon = CRM_STAGE_ICONS[stage];

            return (
              <div
                key={stage}
                id={`pipeline-col-${stage}`}
                className="w-80 shrink-0 h-full flex flex-col bg-ice-100/50 rounded-2xl overflow-hidden border border-ice-200/60"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                <div className="px-4 py-4 bg-ice-50 border-b border-ice-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-white border border-ice-200">
                      <StageIcon className="w-4 h-4 text-graphite-600" />
                    </div>
                    <span className="text-sm font-black text-graphite-800">{t(`stages.${CRM_STAGE_LABEL_KEYS[stage]}`)}</span>
                  </div>
                  <Badge accent="brand" size="md">{columnJourneys.length}</Badge>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[500px] custom-scrollbar">
                  {columnJourneys.map(j => (
                    <div
                      key={j.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, j.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => setSelectedJourney(j)}
                      className="bg-white p-4 rounded-2xl shadow-sm border border-ice-100 cursor-grab active:cursor-grabbing hover:border-brand-primary/40 transition-colors"
                    >
                      {(() => {
                        const act = activity[j.id];
                        const snippet = act?.lastPreview && ['message_received', 'message_sent'].includes(act.lastType || '')
                          ? `“${act.lastPreview.trim().replace(/^["“”']+|["“”']+$/g, '')}”`
                          : j.procedure_name;
                        const name = displayName(j);
                        return (
                          <div className="flex flex-col gap-2.5">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="relative shrink-0 w-9 h-9 rounded-full bg-ice-100 flex items-center justify-center">
                                <User className="w-4 h-4 text-graphite-400" />
                                <span className={clsx('absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-white', CHANNEL_DOT[primaryChannel(j)])} />
                              </span>
                              <p className="text-sm font-black text-graphite-900 truncate m-0">{name}</p>
                            </div>
                            {snippet && <p className="text-xs text-graphite-500 line-clamp-2 m-0">{snippet}</p>}
                            <div className="flex flex-wrap items-center gap-1.5">
                              {j.revenue_estimated > 0 && (
                                <Badge accent="success" size="sm"><DollarSign className="w-3 h-3" />{j.revenue_estimated.toLocaleString('pt-BR')}</Badge>
                              )}
                              {j.next_appointment_status === 'confirmed' && <Badge accent="success" size="sm">{t('today.badges.confirmed')}</Badge>}
                              {j.no_show_count > 0 && (
                                <Badge accent="error" size="sm"><AlertTriangle className="w-3 h-3" />{t('today.badges.noShows', { count: j.no_show_count })}</Badge>
                              )}
                              <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-graphite-400">
                                <Clock className="w-3 h-3" />
                                {t('followUp.timeInStage', { time: shortElapsed(j.stage_entered_at, Date.now()) })}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}

                  {columnJourneys.length === 0 && (
                    <EmptyState icon={Search} label={t('followUp.emptyColumn')} className="opacity-60" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* Sale Modal */}
      {saleModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-white/20 animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-ice-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-success/10 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-accent-success" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-graphite-900">{t('followUp.saleModal.title')}</h3>
                  <p className="text-xs text-graphite-500 font-medium">{t('followUp.saleModal.subtitle')}</p>
                </div>
              </div>
              <IconButton onClick={() => setSaleModal(null)}><X className="w-5 h-5" /></IconButton>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-graphite-700 uppercase tracking-wider mb-1.5 ml-1">{t('followUp.saleModal.procedureLabel')}</label>
                <input
                  type="text"
                  value={saleModal.procedure}
                  onChange={(e) => setSaleModal({ ...saleModal, procedure: e.target.value })}
                  placeholder={t('followUp.saleModal.procedurePlaceholder')}
                  className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-accent-success focus:border-transparent outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-graphite-700 uppercase tracking-wider mb-1.5 ml-1">{t('followUp.saleModal.valueLabel')}</label>
                <input
                  type="text"
                  value={saleModal.value}
                  onChange={(e) => setSaleModal({ ...saleModal, value: e.target.value })}
                  placeholder={t('followUp.saleModal.valuePlaceholder')}
                  className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-accent-success focus:border-transparent outline-none transition-all"
                />
              </div>
            </div>
            <div className="p-6 bg-ice-50 rounded-b-3xl flex gap-3">
              <Button variant="ghost" className="flex-1 justify-center" onClick={() => setSaleModal(null)}>{t('followUp.saleModal.cancel')}</Button>
              <Button variant="success" className="flex-1 justify-center" onClick={handleSaveSale}><Save className="w-4 h-4" />{t('followUp.saleModal.save')}</Button>
            </div>
          </div>
        </div>
      )}

      {automationsOpen && tenant?.id && (
        <FollowUpAutomationsPanel
          tenantId={tenant.id}
          onClose={() => setAutomationsOpen(false)}
          onSaved={() => { loadBoard(); refetchMetrics(); }}
        />
      )}

      {/* Lost Reason Modal */}
      <LostReasonModal
        isOpen={!!lostModal}
        onClose={() => setLostModal(null)}
        onConfirm={handleSaveLostReason}
        leadName={lostModal?.name}
      />

      {/* Timeline Drawer */}
      {selectedJourney && (
        <FollowUpTimelineDrawer
          journey={selectedJourney}
          name={displayName(selectedJourney)}
          nextStep={nextStepFor(selectedJourney)}
          onClose={() => setSelectedJourney(null)}
        />
      )}
    </div>
  );
}
