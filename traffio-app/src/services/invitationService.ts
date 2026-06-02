import { supabase } from '../lib/supabase';

export interface Invitation {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
  token: string;
  invited_by: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  profiles?: { full_name: string | null };
}

export const invitationService = {
  async list(tenantId: string): Promise<Invitation[]> {
    const { data, error } = await supabase
      .from('invitations')
      .select('*, profiles!invited_by(full_name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as Invitation[];
  },

  async invite(tenantId: string, email: string, role: string): Promise<{ invite_url?: string }> {
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: { tenant_id: tenantId, email, role },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  },

  async revoke(invitationId: string): Promise<void> {
    const { error } = await supabase
      .from('invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId);
    if (error) throw error;
  },

  async resend(tenantId: string, email: string, role: string): Promise<{ invite_url?: string }> {
    // Reenvia criando um novo convite (upsert vai gerar novo token)
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: { tenant_id: tenantId, email, role },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  },

  async getByToken(token: string): Promise<Invitation | null> {
    const { data } = await supabase
      .from('invitations')
      .select('*, tenants(name, logo_url)')
      .eq('token', token)
      .maybeSingle();
    return data as Invitation | null;
  },
};
