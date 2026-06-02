import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  User, Loader2,
  DollarSign,
  Search, TrendingUp, Activity, Save, X
} from 'lucide-react';
import { formatPhone, phoneFlag } from '../lib/formatPhone';
import { useTenant } from '../contexts/TenantContext';
import { useFollowUpMetrics } from '../hooks/useFollowUpMetrics';
import { PerformanceStats } from '../components/followup/PerformanceStats';
import { KANBAN_STAGES, STAGE_ICONS } from '../lib/kanbanStages';

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
  updated_at: string;
  variables?: any;
}


export function FollowUpBoard() {
  const { tenant } = useTenant();
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [patientNames, setPatientNames] = useState<Record<string, string>>({});
  const [days, setDays] = useState(30);
  const [showMetrics, setShowMetrics] = useState(true);
  
  // Sale details state
  const [saleDetails, setSaleDetails] = useState<{ id: string; procedure: string; value: string } | null>(null);

  const { metrics, isLoading: loadingMetrics, refetch: refetchMetrics } = useFollowUpMetrics({ 
    tenantId: tenant?.id || '', 
    days 
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
      const phones = [...new Set(list.map(s => s.patient_phone))];
      const { data: pts } = await supabase
        .from('patients')
        .select('phone, full_name')
        .in('phone', phones)
        .eq('tenant_id', tenant!.id);
      
      if (pts) {
        const map: Record<string, string> = {};
        pts.forEach((p: any) => { if (p.full_name) map[p.phone] = p.full_name; });
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
      <div className="flex items-center justify-center h-[calc(100vh-120px)] bg-white rounded-2xl border border-gray-200">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] bg-gray-50/50 rounded-2xl flex flex-col border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-blue-200">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900 tracking-tight">Centro de Performance</h1>
            <p className="text-sm text-gray-500 font-medium">Gestão comercial e funil de conversão em tempo real.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
            {[7, 30, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  days === d 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {d} dias
              </button>
            ))}
          </div>
          <button 
            onClick={() => setShowMetrics(!showMetrics)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
              showMetrics 
                ? 'bg-blue-50 border-blue-200 text-blue-600' 
                : 'bg-white border-gray-200 text-gray-700'
            }`}
          >
            <Activity className="w-4 h-4" />
            Dashboard
          </button>
        </div>
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
                className="w-80 shrink-0 h-full flex flex-col bg-gray-100/50 rounded-2xl overflow-hidden border border-gray-200/60"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                {/* Column Header */}
                <div className="px-4 py-4 bg-gray-50 border-b border-gray-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-white border border-gray-200">
                      <StageIcon className="w-4 h-4 text-gray-600" />
                    </div>
                    <span className="text-sm font-black text-gray-800">{stage}</span>
                  </div>
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
                    {columnSessions.length}
                  </span>
                </div>
                         <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[500px] custom-scrollbar">
                  {columnSessions.map(session => (
                    <div 
                      key={session.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, session.id)}
                      className="group bg-white p-4 rounded-2xl shadow-sm border border-gray-100 cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-300">
                            <User className="w-5 h-5 text-white" />
                          </div>
                          <div className="overflow-hidden">
                            <p className="text-xs font-black text-gray-900 truncate tracking-tight">
                              {patientNames[session.patient_phone] || `${phoneFlag(session.patient_phone)} ${formatPhone(session.patient_phone)}`}
                            </p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                              {formatPhone(session.patient_phone)}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Content Indicators */}
                      {(session.revenue_estimated > 0 || session.variables?.procedure_name) && (
                        <div className="flex flex-wrap gap-2 mt-4">
                          {session.revenue_estimated > 0 && (
                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100/50 text-[10px] font-black shadow-sm">
                              <DollarSign className="w-3 h-3" />
                              R$ {session.revenue_estimated.toLocaleString('pt-BR')}
                            </div>
                          )}
                          {session.variables?.procedure_name && (
                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-100/50 text-[10px] font-black shadow-sm">
                              {session.variables.procedure_name}
                            </div>
                          )}
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-50">
                        <div className="flex items-center gap-1.5">
                          <Activity className="w-3 h-3 text-gray-300" />
                          <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                            Atividade
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-gray-500 bg-gray-50 px-2 py-0.5 rounded-lg border border-gray-100">
                          {new Date(session.updated_at).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    </div>
                  ))}

                  {columnSessions.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-100 rounded-3xl bg-gray-50/30 opacity-60">
                      <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                        <Search className="w-5 h-5 text-gray-200" />
                      </div>
                      <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] ml-1">Vazio</p>
                    </div>
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
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900">Confirmar Venda</h3>
                  <p className="text-xs text-gray-500 font-medium">Informe os detalhes do fechamento.</p>
                </div>
              </div>
              <button onClick={() => setSaleDetails(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 ml-1">Procedimento</label>
                <input 
                  type="text" 
                  value={saleDetails.procedure}
                  onChange={(e) => setSaleDetails({ ...saleDetails, procedure: e.target.value })}
                  placeholder="Ex: Invisalign, Implante..."
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 ml-1">Valor do Fechamento (R$)</label>
                <input 
                  type="text" 
                  value={saleDetails.value}
                  onChange={(e) => setSaleDetails({ ...saleDetails, value: e.target.value })}
                  placeholder="0,00"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                />
              </div>
            </div>

            <div className="p-6 bg-gray-50 rounded-b-3xl flex gap-3">
              <button 
                onClick={() => setSaleDetails(null)}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveSale}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                Salvar Venda
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
