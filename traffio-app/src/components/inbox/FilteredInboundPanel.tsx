import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Instagram, Facebook, Loader2, ShieldCheck, ShieldAlert, RefreshCw, Undo2, MessageCircle, Send } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

interface FilteredInboundPanelProps {
  tenantId: string;
  /** Avisa o Inbox para atualizar o contador da aba. */
  onCountChange?: (count: number) => void;
}

type FilteredKind = 'dm' | 'instagram_comment' | 'facebook_comment';

interface FilteredItem {
  id: string;
  kind: FilteredKind;
  platform: 'instagram' | 'facebook';
  sender: string;
  text: string;
  verdict: 'spam' | 'vendor';
  reason: string | null;
  receivedAt: string;
}

/**
 * Aba "Filtrados" do Inbox — tudo que o filtro anti-spam dos canais Meta
 * (supabase/functions/_shared/inboundSpamFilter.ts) segurou ANTES de chegar ao
 * agente de IA ou à fila da recepção: DMs (filtered_inbound) e comentários
 * (instagram_comments / facebook_comments com filter_verdict).
 *
 * "Não é spam" chama restore-filtered-inbound: marca o remetente como
 * confiável em toda a plataforma e devolve a mensagem ao fluxo normal.
 * Layout em grade de cards (conteúdo esparso — ver DESIGN_SYSTEM.md).
 */
export function FilteredInboundPanel({ tenantId, onCountChange }: FilteredInboundPanelProps) {
  const { t } = useTranslation('communications');
  const { showToast } = useToast();
  const [items, setItems] = useState<FilteredItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [dms, ig, fb] = await Promise.all([
        supabase.from('filtered_inbound')
          .select('id, channel, sender_id, sender_name, content, verdict, reason, received_at')
          .eq('tenant_id', tenantId).is('restored_at', null)
          .order('received_at', { ascending: false }).limit(100),
        supabase.from('instagram_comments')
          .select('id, from_username, text, filter_verdict, filter_reason, received_at')
          .eq('tenant_id', tenantId).not('filter_verdict', 'is', null)
          .order('received_at', { ascending: false }).limit(100),
        supabase.from('facebook_comments')
          .select('id, from_name, text, filter_verdict, filter_reason, received_at')
          .eq('tenant_id', tenantId).not('filter_verdict', 'is', null)
          .order('received_at', { ascending: false }).limit(100),
      ]);
      const firstError = dms.error || ig.error || fb.error;
      if (firstError) throw firstError;

      const merged: FilteredItem[] = [
        ...(dms.data || []).map((r: any) => ({
          id: r.id, kind: 'dm' as const, platform: r.channel, sender: r.sender_name || r.sender_id,
          text: r.content, verdict: r.verdict, reason: r.reason, receivedAt: r.received_at,
        })),
        ...(ig.data || []).map((r: any) => ({
          id: r.id, kind: 'instagram_comment' as const, platform: 'instagram' as const, sender: r.from_username ? `@${r.from_username}` : '—',
          text: r.text || '', verdict: r.filter_verdict, reason: r.filter_reason, receivedAt: r.received_at,
        })),
        ...(fb.data || []).map((r: any) => ({
          id: r.id, kind: 'facebook_comment' as const, platform: 'facebook' as const, sender: r.from_name || '—',
          text: r.text || '', verdict: r.filter_verdict, reason: r.filter_reason, receivedAt: r.received_at,
        })),
      ].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

      setItems(merged);
      onCountChange?.(merged.length);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, showToast, onCountChange]);

  useEffect(() => { load(); }, [load]);

  const handleRestore = async (item: FilteredItem) => {
    setRestoringId(item.id);
    try {
      const { data, error } = await supabase.functions.invoke('restore-filtered-inbound', { body: { kind: item.kind, id: item.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      showToast('success', t(item.kind === 'dm' ? 'humanInbox.filtered.toasts.restoredDm' : 'humanInbox.filtered.toasts.restoredComment'));
      await load();
    } catch (err: any) {
      showToast('error', t('humanInbox.filtered.toasts.error', { message: err.message }));
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-ice-50">
      <div className="px-6 py-4 bg-white border-b border-ice-100 flex items-start justify-between gap-4 shrink-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-ice-100 border border-ice-200/60 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-slate-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-gray-900">{t('humanInbox.filtered.title')}</h1>
            <p className="text-xs text-slate-500 max-w-2xl">{t('humanInbox.filtered.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          title={t('humanInbox.filtered.refresh')}
          className="p-2 rounded-xl hover:bg-ice-50 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer disabled:opacity-40 shrink-0"
        >
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-2">
            <div className="w-12 h-12 rounded-2xl bg-white border border-ice-100 shadow-sm flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-slate-300" />
            </div>
            <p className="text-sm font-bold text-slate-700">{t('humanInbox.filtered.emptyTitle')}</p>
            <p className="text-xs text-slate-400 max-w-sm">{t('humanInbox.filtered.emptyHint')}</p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 max-w-6xl">
            {items.map(item => {
              const isComment = item.kind !== 'dm';
              return (
                <div key={`${item.kind}-${item.id}`} className="bg-white border border-ice-100 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className={clsx(
                      'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                      item.platform === 'instagram' ? 'bg-gradient-to-r from-purple-100 to-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'
                    )}>
                      {item.platform === 'instagram' ? <Instagram className="w-3.5 h-3.5" /> : <Facebook className="w-3.5 h-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-800 truncate">{item.sender}</p>
                      <p className="text-[11px] text-slate-400 flex items-center gap-1">
                        {isComment ? <MessageCircle className="w-3 h-3" /> : <Send className="w-3 h-3" />}
                        {t(isComment ? 'humanInbox.filtered.kindComment' : 'humanInbox.filtered.kindDm')} · {new Date(item.receivedAt).toLocaleString()}
                      </p>
                    </div>
                    <span className={clsx(
                      'px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide shrink-0 flex items-center gap-1',
                      item.verdict === 'spam' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-700'
                    )}>
                      <ShieldAlert className="w-3 h-3" />
                      {t(item.verdict === 'spam' ? 'humanInbox.filtered.verdictSpam' : 'humanInbox.filtered.verdictVendor')}
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 whitespace-pre-wrap break-words line-clamp-5 bg-ice-50 border border-ice-100 rounded-xl px-3 py-2">
                    {item.text}
                  </p>

                  <div className="flex items-end justify-between gap-3 mt-auto">
                    <p className="text-[11px] text-slate-400 min-w-0">
                      <span className="font-bold text-slate-500">{t('humanInbox.filtered.reasonLabel')}</span> {item.reason || '—'}
                    </p>
                    <button
                      onClick={() => handleRestore(item)}
                      disabled={restoringId !== null}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold border border-ice-200/60 bg-white text-slate-700 hover:bg-ice-50 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5 shrink-0"
                    >
                      {restoringId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                      {t('humanInbox.filtered.notSpam')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
