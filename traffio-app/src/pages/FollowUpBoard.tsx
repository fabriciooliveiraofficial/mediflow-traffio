import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  User, Loader2,
  DollarSign,
  Search, TrendingUp, Activity, Save, X, Clock, Flame, AlertTriangle,
} from 'lucide-react';
import { formatPhone, phoneFlag } from '../lib/formatPhone';
import { useTenant } from '../contexts/TenantContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useFollowUpMetrics } from '../hooks/useFollowUpMetrics';
import { useToast } from '../contexts/ToastContext';
import { PerformanceStats } from '../components/followup/PerformanceStats';
import {
  CRM_STAGES, CRM_STAGE_ICONS, CRM_STAGE_LABEL_KEYS,
  NEXT_ACTION_LABEL_KEYS, LOST_REASON_LABEL_KEYS, type CrmStageId,
} from '../lib/crmStages';
import { useTranslation } from 'react-i18next';
import { Badge, Button, IconButton, EmptyState, PageHeader } from '../components/ui';
import { FollowUpTimelineDrawer } from '../components/crm/FollowUpTimelineDrawer';

interface CrmJourney {
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
  priority_score: number;
  next_action_at: string | null;
  next_action_type: string | null;
  lost_reason: string | null;
  needs_action: boolean;
  stage_entered_at: string;
  last_event_at: string;
  created_at: string;
  patients: { full_name: string; phone: string } | null;
  conversation_sessions: { channel: string | null; context: any; patient_phone: string } | null;
}

const LOST_REASONS = ['price', 'competitor', 'no_response', 'gave_up', 'other'] as const;

export function FollowUpBoard() {
  const { t } = useTranslation('crm');
  const { tenant } = useTenant();
  const { formatDateTime } = useLocaleFormat();
  const { showToast } = useToast();
  const [journeys, setJourneys] = useState<CrmJourney[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [showMetrics, setShowMetrics] = useState(true);

  const [saleModal, setSaleModal] = useState<{ id: string; procedure: string; value: string } | null>(null);
  const [lostModal, setLostModal] = useState<{ id: string; reason: string } | null>(null);
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
    setLoading(true);
    const { data, error } = await supabase
      .from('crm_journeys')
      .select('*, patients(full_name, phone), conversation_sessions(channel, context, patient_phone)')
      .eq('tenant_id', tenant!.id)
      .order('last_event_at', { ascending: false });

    if (error) console.error('[FollowUpBoard] load error:', error);
    setJourneys((data as any) || []);
    setLoading(false);
  };

  const displayName = (j: CrmJourney) => {
    if (j.patients?.full_name) return j.patients.full_name;
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
    return `${phoneFlag(phone)} ${formatPhone(phone)}`;
  };

  const displaySubtitle = (j: CrmJourney) => {
    const channel = j.conversation_sessions?.channel;
    if (channel && ['instagram', 'facebook', 'livechat'].includes(channel)) {
      return channel === 'instagram'
        ? t('followUp.channelLabel.instagram', { username: j.conversation_sessions?.context?.username || t('followUp.directFallback') })
        : channel === 'facebook' ? t('followUp.channelLabel.facebook') : t('followUp.channelLabel.livechat');
    }
    const phone = j.lead_phone || j.patients?.phone || j.conversation_sessions?.patient_phone || '';
    return formatPhone(phone);
  };

  const actionQueue = useMemo(() => {
    const now = Date.now();
    return journeys
      .filter(j => !['won', 'lost'].includes(j.stage_id))
      .filter(j => j.needs_action || (j.next_action_at && new Date(j.next_action_at).getTime() <= now))
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, 12);
  }, [journeys]);

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

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('journey_id', id);
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = async (e: React.DragEvent, stage: CrmStageId) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('journey_id');
    if (!id || !tenant?.id) return;

    if (stage === 'won') {
      const journey = journeys.find(j => j.id === id);
      setSaleModal({ id, procedure: journey?.procedure_name || '', value: journey?.revenue_estimated?.toString() || '' });
      return;
    }
    if (stage === 'lost') {
      setLostModal({ id, reason: '' });
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

  const handleSaveLostReason = () => {
    if (!lostModal || !lostModal.reason) return;
    moveStage(lostModal.id, 'lost', {}, lostModal.reason);
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

        {/* Ações de Hoje — fila priorizada por score determinístico */}
        {actionQueue.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-4 h-4 text-accent-warning" />
              <h2 className="text-sm font-black text-graphite-900 uppercase tracking-wider">{t('followUp.actionQueue.title')}</h2>
              <Badge accent="warning" size="sm">{actionQueue.length}</Badge>
            </div>
            <div className="flex flex-wrap gap-3">
              {actionQueue.map(j => (
                <button
                  key={j.id}
                  onClick={() => setSelectedJourney(j)}
                  className="w-72 text-left bg-white p-4 rounded-2xl shadow-float border border-ice-100 hover:border-brand-primary/40 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-black text-graphite-900 truncate">{displayName(j)}</p>
                    <Badge accent={j.priority_score >= 60 ? 'error' : j.priority_score >= 30 ? 'warning' : 'neutral'} size="sm">
                      {j.priority_score}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {j.next_action_type && (
                      <Badge accent="brand" size="sm">{t(`followUp.${NEXT_ACTION_LABEL_KEYS[j.next_action_type]}`)}</Badge>
                    )}
                    {j.no_show_count > 0 && (
                      <Badge accent="error" size="sm"><AlertTriangle className="w-3 h-3" />{j.no_show_count}</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Kanban Board */}
        <div className="flex gap-5 h-full items-start overflow-x-auto pb-6">
          {CRM_STAGES.map(stage => {
            const columnJourneys = journeys.filter(j => j.stage_id === stage);
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
                        {j.revenue_estimated > 0 && (
                          <Badge accent="success" size="sm"><DollarSign className="w-3 h-3" />R$ {j.revenue_estimated.toLocaleString('pt-BR')}</Badge>
                        )}
                        {j.procedure_name && <Badge accent="indigo" size="sm">{j.procedure_name}</Badge>}
                        {j.appointments_count > 1 && (
                          <Badge accent="neutral" size="sm">{t('followUp.appointmentsBadge', { count: j.appointments_count })}</Badge>
                        )}
                        {j.no_show_count > 0 && (
                          <Badge accent="error" size="sm"><AlertTriangle className="w-3 h-3" />{j.no_show_count}</Badge>
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
      {lostModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-white/20 animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-ice-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-error/10 flex items-center justify-center">
                  <X className="w-5 h-5 text-accent-error" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-graphite-900">{t('followUp.lostModal.title')}</h3>
                  <p className="text-xs text-graphite-500 font-medium">{t('followUp.lostModal.subtitle')}</p>
                </div>
              </div>
              <IconButton onClick={() => setLostModal(null)}><X className="w-5 h-5" /></IconButton>
            </div>
            <div className="p-6 space-y-2">
              {LOST_REASONS.map(reason => (
                <button
                  key={reason}
                  onClick={() => setLostModal({ ...lostModal, reason })}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-bold transition-all ${
                    lostModal.reason === reason ? 'bg-accent-error/10 border-accent-error text-accent-error' : 'bg-ice-50 border-ice-200 text-graphite-600 hover:border-ice-300'
                  }`}
                >
                  {t(`followUp.${LOST_REASON_LABEL_KEYS[reason]}`)}
                </button>
              ))}
            </div>
            <div className="p-6 bg-ice-50 rounded-b-3xl flex gap-3">
              <Button variant="ghost" className="flex-1 justify-center" onClick={() => setLostModal(null)}>{t('followUp.saleModal.cancel')}</Button>
              <Button variant="danger" className="flex-1 justify-center" disabled={!lostModal.reason} onClick={handleSaveLostReason}>
                <Save className="w-4 h-4" />{t('followUp.lostModal.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Timeline Drawer */}
      {selectedJourney && (
        <FollowUpTimelineDrawer journey={selectedJourney} onClose={() => setSelectedJourney(null)} />
      )}
    </div>
  );
}
