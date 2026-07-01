import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  User, Loader2,
  DollarSign,
  Search, TrendingUp, Activity, Save, X, Clock
} from 'lucide-react';
import { formatPhone, phoneFlag } from '../lib/formatPhone';
import { useTenant } from '../contexts/TenantContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useFollowUpMetrics } from '../hooks/useFollowUpMetrics';
import { PerformanceStats } from '../components/followup/PerformanceStats';
import { KANBAN_STAGES, STAGE_ICONS, STAGE_LABEL_KEYS } from '../lib/kanbanStages';
import { useTranslation } from 'react-i18next';
import { Badge, Button, IconButton, EmptyState, PageHeader } from '../components/ui';
import { FollowUpTimelineDrawer } from '../components/crm/FollowUpTimelineDrawer';
type OmnichannelStatus = 'bot_active' | 'queued' | 'human_active' | 'closed';

interface ConversationSession {
  id: string;
  tenant_id: string;
  patient_phone: string;
  current_state: string;
  omnichannel_status: OmnichannelStatus;
  assigned_to_user_id: string | null;
  kanban_stage: string;
  revenue_estimated: number;
  created_at: string;
  updated_at: string;
  variables?: any;
  channel?: string;
  context?: any;
}


export function FollowUpBoard() {
  const { t } = useTranslation('crm');
  const { tenant } = useTenant();
  const { formatDateTime } = useLocaleFormat();
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [patientNames, setPatientNames] = useState<Record<string, string>>({});
  const [days, setDays] = useState(30);
  const [showMetrics, setShowMetrics] = useState(true);
  
  // Sale details state
  const [saleDetails, setSaleDetails] = useState<{ id: string; procedure: string; value: string } | null>(null);

  // Timeline Drawer state
  const [selectedSessionTimeline, setSelectedSessionTimeline] = useState<ConversationSession | null>(null);
  const { metrics, isLoading: loadingMetrics, refetch: refetchMetrics } = useFollowUpMetrics({ 
    tenantId: tenant?.id || '', 
    days,
    timezone: tenant?.timezone
  });

  useEffect(() => {
    if (!tenant?.id) return;
    loadKanban();

    // ── Realtime: patch local state when any session in this tenant is updated ──
    const channel = supabase
      .channel(`followup-board-${tenant.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_sessions',
          filter: `tenant_id=eq.${tenant.id}`,
        },
        (payload) => {
          const updated = payload.new as ConversationSession;
          setSessions(prev => {
            const exists = prev.some(s => s.id === updated.id);
            if (!exists) return prev; // INSERT handled by loadKanban on next open
            refetchMetrics();
            return prev.map(s => s.id === updated.id ? { ...s, ...updated } : s);
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant?.id]);

  const loadKanban = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('conversation_sessions')
      .select('*')
      .eq('tenant_id', tenant!.id)
      .neq('omnichannel_status', 'closed')
      .order('updated_at', { ascending: false });

    const list = (data as ConversationSession[]) || [];
    setSessions(list);

    if (list.length > 0) {
      const phones = [...new Set(list.flatMap(s => {
        const raw = s.patient_phone || '';
        const clean = raw.replace(/\D/g, '');
        return [clean, `+${clean}`, raw];
      }))];
      
      const { data: pts } = await supabase
        .from('patients')
        .select('phone, full_name')
        .in('phone', phones)
        .eq('tenant_id', tenant!.id);
      
      if (pts) {
        const map: Record<string, string> = {};
        pts.forEach((p: any) => {
          if (p.full_name && p.phone) {
            const clean = p.phone.replace(/\D/g, '');
            map[clean] = p.full_name;
            map[`+${clean}`] = p.full_name;
            map[p.phone] = p.full_name;
          }
        });
        setPatientNames(map);
      }
    }
    setLoading(false);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('session_id', id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('session_id');
    if (!id || !tenant?.id) return;

    // If moving to "Vendido/Procedimento", open the sale details modal
    if (stage === 'Vendido/Procedimento') {
      const session = sessions.find(s => s.id === id);
      setSaleDetails({ 
        id, 
        procedure: session?.variables?.procedure_name || '', 
        value: session?.revenue_estimated?.toString() || '' 
      });
      return;
    }

    updateStage(id, stage);
  };

  const updateStage = async (id: string, stage: string, extraData: any = {}) => {
    // Optimistic update
    setSessions(prev => prev.map(s => s.id === id ? { ...s, kanban_stage: stage, ...extraData } : s));

    const payload: any = { kanban_stage: stage };
    if (extraData.revenue_estimated !== undefined) payload.revenue_estimated = extraData.revenue_estimated;
    if (extraData.variables !== undefined) payload.variables = extraData.variables;

    const { error } = await supabase
      .from('conversation_sessions')
      .update(payload)
      .eq('id', id);

    if (error) {
      console.error(error);
      loadKanban();
    } else {
      refetchMetrics();
    }
  };

  const handleSaveSale = () => {
    if (!saleDetails) return;
    const valueNum = parseFloat(saleDetails.value.replace(/[^0-9.]/g, '')) || 0;
    
    updateStage(saleDetails.id, 'Vendido/Procedimento', {
      revenue_estimated: valueNum,
      variables: { procedure_name: saleDetails.procedure }
    });
    setSaleDetails(null);
  };

  if (loading && sessions.length === 0) {
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
                      days === d
                        ? 'bg-white text-brand-primary shadow-sm'
                        : 'text-graphite-500 hover:text-graphite-800'
                    }`}
                  >
                    {t('followUp.daysFilter', { count: d })}
                  </button>
                ))}
              </div>
              <Button
                variant={showMetrics ? 'secondary' : 'ghost'}
                onClick={() => setShowMetrics(!showMetrics)}
              >
                <Activity className="w-4 h-4" />
                {t('followUp.dashboardToggle')}
              </Button>
            </>
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        {/* Analytics Section */}
        {showMetrics && (
          <PerformanceStats metrics={metrics} isLoading={loadingMetrics} />
        )}

        {/* Kanban Board Area */}
        <div className="flex gap-5 h-full items-start overflow-x-auto pb-6">
          {KANBAN_STAGES.map(stage => {
            const columnSessions = sessions.filter(s => (s.kanban_stage || 'Novos Leads') === stage);
            const StageIcon = STAGE_ICONS[stage as keyof typeof STAGE_ICONS];
            
            return (
              <div 
                key={stage}
                className="w-80 shrink-0 h-full flex flex-col bg-ice-100/50 rounded-2xl overflow-hidden border border-ice-200/60"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                {/* Column Header */}
                <div className="px-4 py-4 bg-ice-50 border-b border-ice-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-white border border-ice-200">
                      <StageIcon className="w-4 h-4 text-graphite-600" />
                    </div>
                    <span className="text-sm font-black text-graphite-800">{t(`kanbanStages.${STAGE_LABEL_KEYS[stage]}`)}</span>
                  </div>
                  <Badge accent="brand" size="md">{columnSessions.length}</Badge>
                </div>
                         <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[500px] custom-scrollbar">
                  {columnSessions.map(session => (
                    <div
                      key={session.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, session.id)}
                      onClick={() => setSelectedSessionTimeline(session)}
                      className="group bg-white p-4 rounded-2xl shadow-float border border-ice-100 cursor-grab active:cursor-grabbing hover:border-brand-primary/40 hover:-translate-y-0.5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-300">
                            <User className="w-5 h-5 text-white" />
                          </div>
                          <div className="overflow-hidden">
                            <p className="text-xs font-black text-graphite-900 truncate tracking-tight">
                              {patientNames[session.patient_phone] ||
                               patientNames[session.patient_phone.replace(/\D/g, '')] ||
                               patientNames[`+${session.patient_phone.replace(/\D/g, '')}`] || (
                                ['instagram', 'facebook', 'livechat'].includes(session.channel || '')
                                  ? (session.context?.visitor_name || session.context?.username || session.context?.name || (session.channel === 'instagram' ? t('followUp.channelFallback.instagram') : session.channel === 'facebook' ? t('followUp.channelFallback.facebook') : t('followUp.channelFallback.web')))
                                  : `${phoneFlag(session.patient_phone)} ${formatPhone(session.patient_phone)}`
                              )}
                            </p>
                            <p className="text-[10px] text-graphite-400 font-bold uppercase tracking-widest mt-0.5">
                              {['instagram', 'facebook', 'livechat'].includes(session.channel || '')
                                ? (session.channel === 'instagram' ? t('followUp.channelLabel.instagram', { username: session.context?.username || t('followUp.directFallback') }) : session.channel === 'facebook' ? t('followUp.channelLabel.facebook') : t('followUp.channelLabel.livechat'))
                                : formatPhone(session.patient_phone)}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Content Indicators */}
                      {(session.revenue_estimated > 0 || session.variables?.procedure_name) && (
                        <div className="flex flex-wrap gap-2 mt-4">
                          {session.revenue_estimated > 0 && (
                            <Badge accent="success" size="sm">
                              <DollarSign className="w-3 h-3" />
                              R$ {session.revenue_estimated.toLocaleString('pt-BR')}
                            </Badge>
                          )}
                          {session.variables?.procedure_name && (
                            <Badge accent="indigo" size="sm">{session.variables.procedure_name}</Badge>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between mt-5 pt-4 border-t border-ice-50">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-ice-200" />
                          <span className="text-[9px] font-black text-graphite-400 uppercase tracking-widest">
                            {t('followUp.firstContact')}
                          </span>
                        </div>
                        <Badge accent="neutral" variant="tag" size="sm">{formatDateTime(session.created_at)}</Badge>
                      </div>
                    </div>
                  ))}

                  {columnSessions.length === 0 && (
                    <EmptyState icon={Search} label={t('followUp.emptyColumn')} className="opacity-60" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sale Details Modal */}
      {saleDetails && (
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
              <IconButton onClick={() => setSaleDetails(null)}>
                <X className="w-5 h-5" />
              </IconButton>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-graphite-700 uppercase tracking-wider mb-1.5 ml-1">{t('followUp.saleModal.procedureLabel')}</label>
                <input
                  type="text"
                  value={saleDetails.procedure}
                  onChange={(e) => setSaleDetails({ ...saleDetails, procedure: e.target.value })}
                  placeholder={t('followUp.saleModal.procedurePlaceholder')}
                  className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-accent-success focus:border-transparent outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-graphite-700 uppercase tracking-wider mb-1.5 ml-1">{t('followUp.saleModal.valueLabel')}</label>
                <input
                  type="text"
                  value={saleDetails.value}
                  onChange={(e) => setSaleDetails({ ...saleDetails, value: e.target.value })}
                  placeholder={t('followUp.saleModal.valuePlaceholder')}
                  className="w-full bg-ice-50 border border-ice-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-accent-success focus:border-transparent outline-none transition-all"
                />
              </div>
            </div>

            <div className="p-6 bg-ice-50 rounded-b-3xl flex gap-3">
              <Button variant="ghost" className="flex-1 justify-center" onClick={() => setSaleDetails(null)}>
                {t('followUp.saleModal.cancel')}
              </Button>
              <Button variant="success" className="flex-1 justify-center" onClick={handleSaveSale}>
                <Save className="w-4 h-4" />
                {t('followUp.saleModal.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Timeline Drawer */}
      {selectedSessionTimeline && (
        <FollowUpTimelineDrawer 
          session={selectedSessionTimeline} 
          onClose={() => setSelectedSessionTimeline(null)} 
        />
      )}
    </div>
  );
}
