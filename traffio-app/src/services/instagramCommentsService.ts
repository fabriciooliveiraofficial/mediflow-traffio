import { supabase } from '../lib/supabase';

export interface InstagramComment {
  id: string;
  tenant_id: string;
  comment_id: string;
  media_id: string | null;
  from_id: string | null;
  from_username: string | null;
  text: string | null;
  status: 'pending' | 'replied' | 'ignored';
  reply_text: string | null;
  replied_at: string | null;
  received_at: string;
}

export const instagramCommentsService = {
  async list(tenantId: string): Promise<InstagramComment[]> {
    const { data, error } = await supabase
      .from('instagram_comments')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('received_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  },

  async countPending(tenantId: string): Promise<number> {
    const { count, error } = await supabase
      .from('instagram_comments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending');
    if (error) throw error;
    return count ?? 0;
  },

  async reply(params: { tenantId: string; commentId: string; text: string; userId: string }): Promise<void> {
    const { data, error } = await supabase.functions.invoke('reply-instagram-comment', {
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
