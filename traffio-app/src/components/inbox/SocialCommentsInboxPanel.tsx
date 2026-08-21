import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Instagram, Facebook, Loader2, Send, MessageCircle, RefreshCw, Sparkles, User } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { socialCommentsService, type SocialComment } from '../../services/socialCommentsService';

interface SocialCommentsInboxPanelProps {
  tenantId: string;
}

/**
 * Painel unificado de comentários (Instagram + Facebook) integrado ao Inbox
 * — mesmo espírito do Meta Business Suite (todos os comentários de todas as
 * plataformas conectadas num só lugar). Lê de instagram_comments +
 * facebook_comments via socialCommentsService (não de conversation_sessions
 * — ver instagram_comments_capability_gap.md na memória do projeto para o
 * porquê dessa escolha de arquitetura).
 */
export function SocialCommentsInboxPanel({ tenantId }: SocialCommentsInboxPanelProps) {
  const { t } = useTranslation('communications');
  const { showToast } = useToast();

  const [comments, setComments] = useState<SocialComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await socialCommentsService.list(tenantId);
      setComments(data);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, showToast]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await socialCommentsService.syncNow();
      await load();
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setSyncing(false);
    }
  }, [load, showToast]);

  // Ao abrir a aba: exibe o que já está no banco IMEDIATAMENTE (o cron de 1min
  // já mantém isso atualizado em segundo plano) — não espera a Meta responder
  // pra pintar a tela. A sincronização roda em paralelo, sem bloquear, e só
  // atualiza a lista silenciosamente quando terminar (sem re-exibir spinner
  // de carregamento cheio, pra não piscar a tela already-populated).
  useEffect(() => {
    if (!tenantId) return;
    load();
    socialCommentsService.syncNow()
      .then(() => socialCommentsService.list(tenantId))
      .then(setComments)
      .catch(err => console.error('[SocialCommentsInboxPanel] background sync failed:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Realtime — novo comentário aparece sozinho, sem precisar de ação do usuário.
  // Polling de 60s como rede de segurança: se o realtime cair (ex: tabela cair
  // fora da publication de novo, rede instável), a tela ainda se atualiza sozinha
  // em vez de ficar presa até a próxima ação manual do usuário.
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`social-comments:${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'instagram_comments', filter: `tenant_id=eq.${tenantId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'facebook_comments', filter: `tenant_id=eq.${tenantId}` }, () => load())
      .subscribe();
    const pollId = setInterval(load, 60000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollId);
    };
  }, [tenantId, load]);

  const selected = comments.find(c => c.id === selectedId) ?? null;

  const handleReply = async () => {
    if (!selected || !replyDraft.trim() || !userId) return;
    setSending(true);
    try {
      await socialCommentsService.reply({ tenantId, platform: selected.platform, commentId: selected.comment_id, text: replyDraft.trim(), userId });
      showToast('success', t('humanInbox.instagramComments.toasts.sent'));
      setReplyDraft('');
      await load();
    } catch (err: any) {
      showToast('error', t('humanInbox.instagramComments.toasts.error', { message: err.message }));
    } finally {
      setSending(false);
    }
  };

  const pendingCount = comments.filter(c => c.status === 'pending').length;

  const PlatformIcon = ({ platform, className }: { platform: SocialComment['platform']; className?: string }) =>
    platform === 'instagram' ? <Instagram className={className} /> : <Facebook className={className} />;

  const platformStyles = (platform: SocialComment['platform']) =>
    platform === 'instagram'
      ? 'bg-gradient-to-r from-purple-100 to-pink-100 text-pink-600'
      : 'bg-blue-100 text-blue-600';

  return (
    <>
      {/* LEFT — lista unificada de comentários (mesma largura/estilo da lista de conversas) */}
      <div className={clsx(
        "w-full lg:w-[280px] shrink-0 flex flex-col bg-white border-r border-ice-100 h-full",
        selected ? "hidden lg:flex" : "flex"
      )}>
        <div className="px-4 py-4 border-b border-ice-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-r from-purple-600 via-pink-500 to-blue-600 flex items-center justify-center shrink-0">
              <MessageCircle className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-sm font-bold text-gray-900">{t('humanInbox.instagramComments.drawerTitle')}</h1>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            title={t('humanInbox.instagramComments.syncNow')}
            className="p-1.5 rounded-lg hover:bg-ice-50 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer disabled:opacity-40"
          >
            <RefreshCw className={syncing ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading || syncing ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
            </div>
          ) : comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 gap-2">
              <MessageCircle className="w-7 h-7 opacity-40" />
              <p className="text-xs">{t('humanInbox.instagramComments.empty')}</p>
            </div>
          ) : (
            comments.map(c => (
              <button
                key={`${c.platform}-${c.id}`}
                onClick={() => setSelectedId(c.id)}
                className={clsx(
                  "w-full flex items-start gap-2.5 px-4 py-3 text-left border-b border-ice-50 transition-colors cursor-pointer",
                  selectedId === c.id ? "bg-ice-50" : "hover:bg-slate-50"
                )}
              >
                <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center shrink-0", platformStyles(c.platform))}>
                  <PlatformIcon platform={c.platform} className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-bold text-slate-800 truncate">{c.from_label}</p>
                    {c.status === 'pending' ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-pink-500 shrink-0" />
                    ) : c.ai_generated ? (
                      <Sparkles className="w-3 h-3 text-purple-500 shrink-0" />
                    ) : null}
                  </div>
                  <p className="text-[11px] text-slate-500 truncate">{c.text}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* CENTER — detalhe do comentário selecionado */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-ice-100 shrink-0">
            <div className={clsx("w-9 h-9 rounded-full flex items-center justify-center shrink-0", platformStyles(selected.platform))}>
              <PlatformIcon platform={selected.platform} className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{selected.from_label}</p>
              <p className="text-[11px] text-slate-400">
                {selected.platform === 'instagram' ? t('humanInbox.channels.instagram') : t('humanInbox.channels.messenger')} · {new Date(selected.received_at).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="rounded-2xl border border-ice-200 bg-ice-50/50 p-4 max-w-lg">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">{t('humanInbox.instagramComments.pendingSection')}</p>
              <p className="text-sm text-slate-700 break-words">{selected.text}</p>
            </div>

            {selected.status === 'replied' && (
              <>
                <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-4 max-w-lg ml-auto">
                  <div className="flex items-center gap-1.5 mb-1">
                    {selected.ai_generated && <Sparkles className="w-3 h-3 text-purple-500" />}
                    <p className="text-[10px] font-black uppercase tracking-wider text-purple-500">
                      {t('humanInbox.instagramComments.repliedBadge')} · público
                    </p>
                  </div>
                  <p className="text-sm text-slate-700 break-words">{selected.reply_text}</p>
                </div>
                {selected.private_reply_text && (
                  <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 max-w-lg ml-auto">
                    <div className="flex items-center gap-1.5 mb-1">
                      <User className="w-3 h-3 text-indigo-500" />
                      <p className="text-[10px] font-black uppercase tracking-wider text-indigo-500">
                        {selected.platform === 'instagram' ? 'Direct' : 'Messenger'} (privado)
                      </p>
                    </div>
                    <p className="text-sm text-slate-700 break-words">{selected.private_reply_text}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {selected.status === 'pending' && (
            <div className="p-4 border-t border-ice-100 flex items-center gap-2 shrink-0">
              <input
                type="text"
                value={replyDraft}
                onChange={e => setReplyDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleReply(); }}
                placeholder={t('humanInbox.instagramComments.replyPlaceholder')}
                className="flex-1 text-sm px-4 py-2.5 rounded-xl border border-ice-200 focus:outline-none focus:ring-2 focus:ring-purple-500/30 bg-white"
              />
              <button
                onClick={handleReply}
                disabled={sending || !replyDraft.trim()}
                className="p-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity cursor-pointer shrink-0"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center text-gray-400 bg-gray-50/30">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto">
              <MessageCircle className="w-8 h-8 opacity-30" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500">{t('humanInbox.main.selectConversation')}</p>
              {pendingCount > 0 && (
                <p className="text-xs text-gray-400 mt-1">{pendingCount} {t('humanInbox.instagramComments.pendingSection').toLowerCase()}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
