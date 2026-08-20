import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Instagram, Loader2, Send, MessageCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { instagramCommentsService, type InstagramComment } from '../../services/instagramCommentsService';

interface InstagramCommentsDrawerProps {
  tenantId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function InstagramCommentsDrawer({ tenantId, isOpen, onClose }: InstagramCommentsDrawerProps) {
  const { t } = useTranslation('communications');
  const { showToast } = useToast();

  const [comments, setComments] = useState<InstagramComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await instagramCommentsService.list(tenantId);
      setComments(data);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, showToast]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const handleReply = async (comment: InstagramComment) => {
    const text = (replyDrafts[comment.id] ?? '').trim();
    if (!text || !userId) return;
    setSendingId(comment.id);
    try {
      await instagramCommentsService.reply({ tenantId, commentId: comment.comment_id, text, userId });
      showToast('success', t('humanInbox.instagramComments.toasts.sent'));
      setReplyDrafts(prev => {
        const next = { ...prev };
        delete next[comment.id];
        return next;
      });
      await load();
    } catch (err: any) {
      showToast('error', t('humanInbox.instagramComments.toasts.error', { message: err.message }));
    } finally {
      setSendingId(null);
    }
  };

  if (!isOpen) return null;

  const pending = comments.filter(c => c.status === 'pending');
  const replied = comments.filter(c => c.status !== 'pending');

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/20 z-[99]" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-[100] w-full max-w-md bg-white border-l border-ice-200 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-250">
        <div className="px-5 py-4 border-b border-ice-100 flex items-center justify-between bg-gradient-to-r from-purple-50 to-pink-50/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 flex items-center justify-center shrink-0">
              <Instagram className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900">{t('humanInbox.instagramComments.drawerTitle')}</h2>
              <p className="text-[11px] text-slate-500">{t('humanInbox.instagramComments.drawerSubtitle')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/60 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <MessageCircle className="w-8 h-8 text-slate-300" />
              <p className="text-sm text-slate-400 font-medium">{t('humanInbox.instagramComments.empty')}</p>
            </div>
          ) : (
            <>
              {pending.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-1 pt-1">
                    {t('humanInbox.instagramComments.pendingSection')} ({pending.length})
                  </div>
                  {pending.map(comment => (
                    <div key={comment.id} className="rounded-2xl border border-ice-200 bg-ice-50/50 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-700">@{comment.from_username ?? comment.from_id ?? '—'}</span>
                        <span className="text-[10px] text-slate-400">{new Date(comment.received_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-slate-700 break-words">{comment.text}</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={replyDrafts[comment.id] ?? ''}
                          onChange={e => setReplyDrafts(prev => ({ ...prev, [comment.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') handleReply(comment); }}
                          placeholder={t('humanInbox.instagramComments.replyPlaceholder')}
                          className="flex-1 text-xs px-3 py-2 rounded-xl border border-ice-200 focus:outline-none focus:ring-2 focus:ring-purple-500/30 bg-white"
                        />
                        <button
                          onClick={() => handleReply(comment)}
                          disabled={sendingId === comment.id || !(replyDrafts[comment.id] ?? '').trim()}
                          className="p-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity cursor-pointer shrink-0"
                        >
                          {sendingId === comment.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {replied.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-1 pt-1">
                    {t('humanInbox.instagramComments.repliedSection')} ({replied.length})
                  </div>
                  {replied.map(comment => (
                    <div key={comment.id} className="rounded-2xl border border-ice-100 bg-white p-3 space-y-1.5 opacity-80">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-600">@{comment.from_username ?? comment.from_id ?? '—'}</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-50 text-emerald-600">
                          {t('humanInbox.instagramComments.repliedBadge')}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 break-words">{comment.text}</p>
                      {comment.reply_text && (
                        <p className="text-xs text-slate-500 border-l-2 border-ice-200 pl-2">↳ {comment.reply_text}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
