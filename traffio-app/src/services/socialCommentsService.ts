import { instagramCommentsService, type InstagramComment } from './instagramCommentsService';
import { facebookCommentsService, type FacebookComment } from './facebookCommentsService';

export interface SocialComment {
  id: string;
  platform: 'instagram' | 'facebook';
  comment_id: string;
  from_label: string;
  text: string | null;
  status: 'pending' | 'replied' | 'ignored';
  reply_text: string | null;
  private_reply_text: string | null;
  ai_generated: boolean;
  received_at: string;
}

function fromInstagram(c: InstagramComment): SocialComment {
  return {
    id: c.id,
    platform: 'instagram',
    comment_id: c.comment_id,
    from_label: c.from_username ?? c.from_id ?? '—',
    text: c.text,
    status: c.status,
    reply_text: c.reply_text,
    private_reply_text: c.private_reply_text,
    ai_generated: c.ai_generated,
    received_at: c.received_at,
  };
}

function fromFacebook(c: FacebookComment): SocialComment {
  return {
    id: c.id,
    platform: 'facebook',
    comment_id: c.comment_id,
    from_label: c.from_name ?? c.from_id ?? '—',
    text: c.text,
    status: c.status,
    reply_text: c.reply_text,
    private_reply_text: c.private_reply_text,
    ai_generated: c.ai_generated,
    received_at: c.received_at,
  };
}

/** Une Instagram + Facebook numa mesma lista — mesmo espírito do Meta Business Suite (tudo no mesmo painel). */
export const socialCommentsService = {
  async list(tenantId: string): Promise<SocialComment[]> {
    const [ig, fb] = await Promise.all([
      instagramCommentsService.list(tenantId),
      facebookCommentsService.list(tenantId),
    ]);
    return [...ig.map(fromInstagram), ...fb.map(fromFacebook)]
      .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
  },

  async countPending(tenantId: string): Promise<number> {
    const [ig, fb] = await Promise.all([
      instagramCommentsService.countPending(tenantId),
      facebookCommentsService.countPending(tenantId),
    ]);
    return ig + fb;
  },

  async syncNow(): Promise<void> {
    await Promise.all([
      instagramCommentsService.syncNow(),
      facebookCommentsService.syncNow(),
    ]);
  },

  async reply(params: { tenantId: string; platform: 'instagram' | 'facebook'; commentId: string; text: string; userId: string }): Promise<void> {
    const svc = params.platform === 'instagram' ? instagramCommentsService : facebookCommentsService;
    await svc.reply(params);
  },
};
