import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  User, Loader2,
  DollarSign,
  Search, TrendingUp, Activity, Save, X, Clock, AlertTriangle,
  ListTodo, Columns3,
} from 'lucide-react';
import { formatPhone, phoneFlag } from '../lib/formatPhone';
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
import { WorkQueue } from '../components/crm/WorkQueue';
import { LostReasonModal } from '../components/crm/LostReasonModal';

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
  const [showMetrics, setShowMetrics] = useState(false);
  const [view, setView] = useState<'queue' | 'pipeline'>('queue');
  const [search, setSearch] = useState('');

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
    const { data, error } = await supabase
      .from('crm_journeys')
      .select('*, patients(full_name, phone), conversation_sessions(channel, context, patient_phone, platform_display_name), crm_journey_identities(channel, identifier, display_name)')
      .eq('tenant_id', tenant.id)
      .order('last_event_at', { ascending: false })
      .limit(1000);

    if (error) console.error('[FollowUpBoard] load error:', error);
    setJourneys((data as any) || []);
    setLoading(false);
  };

  // Resolução de nome em cascata (padrão identity resolution):
  // cadastro do paciente → nome real capturado em qualquer identidade de canal
  // → platform_display_name da sessão → context legado → genérico (último recurso)
  const displayName = (j: CrmJourney) => {
    if (j.patients?.full_name) return j.patients.full_name;

    const identityName = (j.crm_journey_identities || []).find(i => i.display_name)?.display_name;
    if (identityName) return identityName;
    if (j.conversation_sessions?.platform_display_name) return j.conversation_sessions.platform_display_name;

    const channel = j.conversation_sessions?.channel;
    if (channel && ['instagram', 'facebook', 'livechat'].includes(channel)) {
      const ctx = j.conversation_sessions?.context;
      return ctx?.visitor_name || ctx?.username || ctx?.name || (
        channel === 'instagram' ? t('followUp.channelFallback.instagram')
          : channel === 'facebook' ? t('followUp.channelFallback.facebook')
          : t('followUp.channelFallback.web')
      );
    }
    const phone = j.lead_phone || j.patients?.phone || j.conversation_sessions?.patient_phone || '';
    return `${phoneFlag(phone, tenant?.country as CountryCode)} ${formatPhone(phone, tenant?.country as CountryCode)}`;
  };

  // Subtítulo: telefone quando houver; senão o rótulo do canal principal
  const displaySubtitle = (j: CrmJourney) => {
    const phoneIdentity = (j.crm_journey_identities || []).find(i => i.channel === 'whatsapp' || i.channel === 'sms' || i.channel === 'phone');
    const phone = j.patients?.phone || phoneIdentity?.identifier
      || (j.conversation_sessions?.channel === 'whatsapp' || !j.conversation_sessions?.channel ? j.lead_phone : null);
    if (phone) return formatPhone(phone, tenant?.country as CountryCode);

    const channel = j.conversation_sessions?.channel;
    if (channel === 'instagram') return t('followUp.channelLabel.instagram', { username: j.conversation_sessions?.context?.username || t('followUp.directFallback') });
    if (channel === 'facebook') return t('followUp.channelLabel.facebook');
    if (channel === 'livechat') return t('followUp.channelLabel.livechat');
    return formatPhone(j.lead_phone || '', tenant?.country as CountryCode);
  };

  // Canais conectados ao card (deduplica por canal para os chips)
  const journeyChannels = (j: CrmJourney): string[] => {
    const set = new Set<string>((j.crm_journey_identities || []).map(i => i.channel));
    if (j.conversation_sessions?.channel) set.add(j.conversation_sessions.channel);
    return [...set];
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

  if (loading && journeys.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)] bg-white rounded-2xl border border-ice-200">
        <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] bg-ice-50/50 rounded-2xl flex flex-col shadow-float overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-ice-200 shrink-0">
        <PageHeader
          icon={TrendingUp}
          title={t('followUp.title')}
          subtitle={t('followUp.subtitle')}
          actions={
            <>
              {/* Busca unificada */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('followUp.searchPlaceholder')}
                  className="w-56 bg-ice-50 border border-ice-200 rounded-xl pl-9 pr-3 py-2 text-xs font-medium focus:ring-2 focus:ring-brand-primary focus:border-transparent outline-none transition-all"
                />
              </div>

              {/* Alternância Fila / Pipeline */}
              <div className="flex bg-ice-100 p-1 rounded-xl border border-ice-200">
                <button
                  onClick={() => setView('queue')}
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    view === 'queue' ? 'bg-white text-brand-primary shadow-sm' : 'text-graphite-500 hover:text-graphite-800'
                  }`}
                >
                  <ListTodo className="w-3.5 h-3.5" />
                  {t('followUp.views.queue')}
                </button>
                <button
                  onClick={() => setView('pipeline')}
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    view === 'pipeline' ? 'bg-white text-brand-primary shadow-sm' : 'text-graphite-500 hover:text-graphite-800'
                  }`}
                >
                  <Columns3 className="w-3.5 h-3.5" />
                  {t('followUp.views.pipeline')}
                </button>
              </div>

              {showMetrics && (
                <div className="flex bg-ice-100 p-1 rounded-xl border border-ice-200">
                  {[7, 30, 90].map(d => (
                    <button
                      key={d}
                      onClick={() => setDays(d)}
                      className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                        days === d ? 'bg-white text-brand-primary shadow-sm' : 'text-graphite-500 hover:text-graphite-800'
                      }`}
                    >
                      {t('followUp.daysFilter', { count: d })}
                    </button>
                  ))}
                </div>
              )}
              <Button variant={showMetrics ? 'secondary' : 'ghost'} onClick={() => setShowMetrics(!showMetrics)}>
                <Activity className="w-4 h-4" />
                {t('followUp.dashboardToggle')}
              </Button>
            </>
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        {showMetrics && <PerformanceStats metrics={metrics} isLoading={loadingMetrics} />}

        {/* Fila de Trabalho — a superfície operável (padrão) */}
        {view === 'queue' && (
          <WorkQueue
            journeys={filteredJourneys}
            displayName={displayName}
            displaySubtitle={displaySubtitle}
            journeyChannels={journeyChannels}
            onOpenJourney={setSelectedJourney}
            onOpenConversation={openConversation}
            onBook={openBooking}
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
                      className="group bg-white p-4 rounded-2xl shadow-float border border-ice-100 cursor-grab active:cursor-grabbing hover:border-brand-primary/40 hover:-translate-y-0.5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-300">
                            <User className="w-5 h-5 text-white" />
                          </div>
                          <div className="overflow-hidden">
                            <p className="text-xs font-black text-graphite-900 truncate tracking-tight">{displayName(j)}</p>
                            <p className="text-[10px] text-graphite-400 font-bold uppercase tracking-widest mt-0.5">{displaySubtitle(j)}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-2">
                        {(() => {
                          const channels = journeyChannels(j);
                          // Chips de canal: sempre para canais sociais; WhatsApp só
                          // quando o card tem mais de um canal conectado (evita ruído)
                          return channels
                            .filter(c => channels.length > 1 || !['whatsapp', 'phone', 'sms'].includes(c))
                            .map(c => (
                              <Badge key={c} accent="info" size="sm">{t(`followUp.channelChip.${c}`, { defaultValue: c })}</Badge>
                            ));
                        })()}
                        {j.revenue_estimated > 0 && (
                          <Badge accent="success" size="sm"><DollarSign className="w-3 h-3" />R$ {j.revenue_estimated.toLocaleString('pt-BR')}</Badge>
                        )}
                        {j.procedure_name && <Badge accent="indigo" size="sm">{j.procedure_name}</Badge>}
                        {j.appointments_count > 1 && (
                          <Badge accent="neutral" size="sm">{t('followUp.appointmentsBadge', { count: j.appointments_count })}</Badge>
                        )}
                        {j.next_appointment_status === 'confirmed' && (
                          <Badge accent="success" size="sm">Consulta Confirmada</Badge>
                        )}
                        {j.no_show_count > 0 && (
                          <Badge accent="error" size="sm"><AlertTriangle className="w-3 h-3" />No-show ({j.no_show_count})</Badge>
                        )}
                        {j.origin === 'walk_in' && <Badge accent="purple" size="sm">{t('followUp.originBadge.walkIn')}</Badge>}
                        {j.origin === 'recall' && <Badge accent="purple" size="sm">{t('followUp.originBadge.recall')}</Badge>}
                      </div>

                      <div className="flex items-center justify-between mt-5 pt-4 border-t border-ice-50">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-ice-200" />
                          <span className="text-[9px] font-black text-graphite-400 uppercase tracking-widest">{t('followUp.firstContact')}</span>
                        </div>
                        <Badge accent="neutral" variant="tag" size="sm">{formatDateTime(j.created_at)}</Badge>
                      </div>
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

      {/* Lost Reason Modal */}
      <LostReasonModal
        isOpen={!!lostModal}
        onClose={() => setLostModal(null)}
        onConfirm={handleSaveLostReason}
        leadName={lostModal?.name}
      />

      {/* Timeline Drawer */}
      {selectedJourney && (
        <FollowUpTimelineDrawer journey={selectedJourney} onClose={() => setSelectedJourney(null)} />
      )}
    </div>
  );
}
