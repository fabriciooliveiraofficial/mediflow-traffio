import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Loader2, X, Plus, Thermometer, Tag, Flag, DollarSign, StickyNote } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { clsx } from 'clsx';
import { KANBAN_STAGES, STAGE_LABEL_KEYS } from '../lib/kanbanStages';

interface ConversationSession {
  id: string;
  tenant_id: string;
  kanban_stage?: string;
  tags?: any;
  revenue_estimated?: number;
}

interface SidebarLeadClassifyViewProps {
  onBack: () => void;
  session: ConversationSession;
  onUpdate: (updates: Partial<ConversationSession>) => void;
}


export function SidebarLeadClassifyView({ onBack, session, onUpdate }: SidebarLeadClassifyViewProps) {
  const { t } = useTranslation('crm');
  const { showToast } = useToast();

  const TEMPERATURES = [
    { value: 'cold', label: t('sidebarLeadClassifyView.temperatures.cold'), color: 'bg-blue-100 text-blue-700 border-blue-200', icon: '❄️' },
    { value: 'warm', label: t('sidebarLeadClassifyView.temperatures.warm'), color: 'bg-amber-100 text-amber-700 border-amber-200', icon: '🌤️' },
    { value: 'hot', label: t('sidebarLeadClassifyView.temperatures.hot'), color: 'bg-red-100 text-red-700 border-red-200', icon: '🔥' },
  ];

  const PRIORITIES = [
    { value: 'low', label: t('sidebarLeadClassifyView.priorities.low'), color: 'bg-gray-100 text-gray-600' },
    { value: 'medium', label: t('sidebarLeadClassifyView.priorities.medium'), color: 'bg-blue-100 text-blue-600' },
    { value: 'high', label: t('sidebarLeadClassifyView.priorities.high'), color: 'bg-orange-100 text-orange-600' },
    { value: 'urgent', label: t('sidebarLeadClassifyView.priorities.urgent'), color: 'bg-red-100 text-red-600' },
  ];

  const SUGGESTED_TAGS = [
    t('sidebarLeadClassifyView.suggestedTags.particular'),
    t('sidebarLeadClassifyView.suggestedTags.insurance'),
    t('sidebarLeadClassifyView.suggestedTags.returning'),
    t('sidebarLeadClassifyView.suggestedTags.urgent'),
    t('sidebarLeadClassifyView.suggestedTags.vip'),
    t('sidebarLeadClassifyView.suggestedTags.referral'),
    t('sidebarLeadClassifyView.suggestedTags.firstVisit'),
    t('sidebarLeadClassifyView.suggestedTags.postOp'),
  ];
  const [saving, setSaving] = useState(false);

  // Form state
  const [kanbanStage, setKanbanStage] = useState(session.kanban_stage || 'Novos Leads');
  const [temperature, setTemperature] = useState<string>(session.tags?.temperature || '');
  const [priority, setPriority] = useState<string>(session.tags?.priority || 'medium');
  const [labels, setLabels] = useState<string[]>(session.tags?.labels || []);
  const [notes, setNotes] = useState<string>(session.tags?.notes || '');
  const [revenue, setRevenue] = useState<string>(
    session.revenue_estimated ? String(session.revenue_estimated) : ''
  );
  const [newTag, setNewTag] = useState('');

  // Track whether the user is actively saving so we don't overwrite their in-progress edits
  const savingRef = useRef(false);

  // ── Realtime: sync form state when FollowUpBoard (or anyone) updates this session ──
  useEffect(() => {
    const channel = supabase
      .channel(`classify-session-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_sessions',
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          // Skip if the update was triggered by this panel's own save
          if (savingRef.current) return;
          const updated = payload.new as any;
          if (updated.kanban_stage !== undefined) setKanbanStage(updated.kanban_stage);
          if (updated.tags?.temperature !== undefined) setTemperature(updated.tags.temperature);
          if (updated.tags?.priority !== undefined) setPriority(updated.tags.priority);
          if (updated.tags?.labels !== undefined) setLabels(updated.tags.labels);
          if (updated.tags?.notes !== undefined) setNotes(updated.tags.notes || '');
          if (updated.revenue_estimated !== undefined)
            setRevenue(updated.revenue_estimated ? String(updated.revenue_estimated) : '');
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session.id]);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !labels.includes(trimmed)) {
      setLabels([...labels, trimmed]);
    }
    setNewTag('');
  };

  const removeTag = (tag: string) => {
    setLabels(labels.filter(l => l !== tag));
  };

  const handleSave = async () => {
    setSaving(true);
    savingRef.current = true;
    try {
      const tags = {
        ...(session.tags || {}),
        temperature,
        priority,
        labels,
        notes,
      };

      const revenueNum = revenue ? parseFloat(revenue.replace(',', '.')) : null;

      const { error } = await supabase
        .from('conversation_sessions')
        .update({
          kanban_stage: kanbanStage,
          tags,
          revenue_estimated: revenueNum,
        })
        .eq('id', session.id);

      if (error) throw error;

      onUpdate({
        kanban_stage: kanbanStage,
        tags,
        revenue_estimated: revenueNum ?? undefined,
      });

      showToast('success', t('sidebarLeadClassifyView.toasts.saved'));
      onBack();
    } catch (err: any) {
      showToast('error', err.message || t('sidebarLeadClassifyView.errors.saveFailed'));
    } finally {
      setSaving(false);
      // Small delay so the Realtime echo (if any) arrives while savingRef is still true
      setTimeout(() => { savingRef.current = false; }, 500);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-amber-600">
        <button onClick={onBack} className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-white">
          <p className="text-xs font-bold opacity-80 uppercase tracking-tighter">{t('sidebarLeadClassifyView.headerLabel')}</p>
          <p className="text-sm font-bold">{t('sidebarLeadClassifyView.headerTitle')}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Kanban Stage */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1 flex items-center gap-1.5">
            <Flag size={11} /> {t('sidebarLeadClassifyView.funnelStageLabel')}
          </label>
          <select
            value={kanbanStage}
            onChange={e => setKanbanStage(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {KANBAN_STAGES.map(s => (
              <option key={s} value={s}>{t(`kanbanStages.${STAGE_LABEL_KEYS[s]}`)}</option>
            ))}
          </select>
        </div>

        {/* Temperature */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1 flex items-center gap-1.5">
            <Thermometer size={11} /> {t('sidebarLeadClassifyView.temperatureLabel')}
          </label>
          <div className="flex gap-2">
            {TEMPERATURES.map(temp => (
              <button
                key={temp.value}
                onClick={() => setTemperature(temperature === temp.value ? '' : temp.value)}
                className={clsx(
                  'flex-1 py-2 text-xs font-bold rounded-xl border transition-all',
                  temperature === temp.value ? temp.color + ' ring-2 ring-offset-1' : 'bg-gray-50 border-gray-200 text-gray-500'
                )}
              >
                {temp.icon} {temp.label}
              </button>
            ))}
          </div>
        </div>

        {/* Priority */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">{t('sidebarLeadClassifyView.priorityLabel')}</label>
          <div className="grid grid-cols-4 gap-1.5">
            {PRIORITIES.map(p => (
              <button
                key={p.value}
                onClick={() => setPriority(p.value)}
                className={clsx(
                  'py-1.5 text-[10px] font-bold rounded-xl border transition-all',
                  priority === p.value ? p.color + ' ring-2 ring-offset-1' : 'bg-gray-50 border-gray-200 text-gray-400'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1 flex items-center gap-1.5">
            <Tag size={11} /> {t('sidebarLeadClassifyView.tagsLabel')}
          </label>
          {/* Current tags */}
          <div className="flex flex-wrap gap-1.5">
            {labels.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-bold">
                {tag}
                <button onClick={() => removeTag(tag)} className="hover:text-red-500 transition-colors">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          {/* Add tag input */}
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder={t('sidebarLeadClassifyView.newTagPlaceholder')}
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(newTag); } }}
              className="flex-1 px-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button
              onClick={() => addTag(newTag)}
              disabled={!newTag.trim()}
              className="px-2 py-1.5 bg-amber-100 text-amber-700 rounded-xl hover:bg-amber-200 transition-colors disabled:opacity-30"
            >
              <Plus size={14} />
            </button>
          </div>
          {/* Suggested tags */}
          <div className="flex flex-wrap gap-1">
            {SUGGESTED_TAGS.filter(tagOpt => !labels.includes(tagOpt)).map(tag => (
              <button
                key={tag}
                onClick={() => addTag(tag)}
                className="px-2 py-0.5 text-[9px] font-medium rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-all"
              >
                + {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Revenue */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1 flex items-center gap-1.5">
            <DollarSign size={11} /> {t('sidebarLeadClassifyView.estimatedRevenueLabel')}
          </label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={revenue}
            onChange={e => setRevenue(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1 flex items-center gap-1.5">
            <StickyNote size={11} /> {t('sidebarLeadClassifyView.salesNotesLabel')}
          </label>
          <textarea
            placeholder={t('sidebarLeadClassifyView.salesNotesPlaceholder')}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
          />
        </div>
      </div>

      {/* Save button */}
      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-amber-600 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 hover:bg-amber-700 transition-all shadow-md shadow-amber-500/20 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('sidebarLeadClassifyView.saveClassification')}
        </button>
      </div>
    </div>
  );
}
