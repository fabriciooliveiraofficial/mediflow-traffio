import { supabase } from '../lib/supabase';

export interface FacebookComment {
  id: string;
  tenant_id: string;
  comment_id: string;
  post_id: string | null;
  from_id: string | null;
  from_name: string | null;
  text: string | null;
  status: 'pending' | 'replied' | 'ignored';
  reply_text: string | null;
  private_reply_text: string | null;
  replied_at: string | null;
  ai_generated: boolean;
  received_at: string;
}

export const facebookCommentsService = {
  async list(tenantId: string): Promise<FacebookComment[]> {
    const { data, error } = await supabase
      .from('facebook_comments')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('received_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  },

  async countPending(tenantId: string): Promise<number> {
    const { count, error } = await supabase
      .from('facebook_comments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending');
    if (error) throw error;
    return count ?? 0;
  },

  async syncNow(): Promise<void> {
    await supabase.functions.invoke('sync-facebook-comments', { body: {} });
  },

  async reply(params: { tenantId: string; commentId: string; text: string; userId: string }): Promise<void> {
    const { data, error } = await supabase.functions.invoke('reply-facebook-comment', {
      body: {
        tenant_id: params.tenantId,
        comment_id: params.commentId,
        text: params.text,
        user_id: params.userId,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  },
};
