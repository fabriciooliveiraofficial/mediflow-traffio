import { supabase } from '../lib/supabase';

export interface Member {
  id: string;
  tenant_id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  created_at: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export const memberService = {
  async list(tenantId: string): Promise<Member[]> {
    // Usar a view criada na migration para obter dados do perfil junto
    const { data, error } = await supabase
      .from('tenant_members_view')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) {
      // Fallback sem view (join manual)
      const { data: fallback, error: fallbackError } = await supabase
        .from('members')
        .select('*, profiles(full_name, email, avatar_url)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true });

      if (fallbackError) throw fallbackError;
      return (fallback || []).map((m: any) => ({
        id:         m.id,
        tenant_id:  m.tenant_id,
        user_id:    m.user_id,
        role:       m.role,
        is_active:  m.is_active,
        created_at: m.created_at,
        full_name:  m.profiles?.full_name ?? null,
        email:      m.profiles?.email ?? null,
        avatar_url: m.profiles?.avatar_url ?? null,
      }));
    }

    return (data || []) as Member[];
  },

  async updateRole(memberId: string, role: string): Promise<void> {
    const { error } = await supabase
      .from('members')
      .update({ role })
      .eq('id', memberId);
    if (error) throw error;

    // Sincronizar role no profile também
    const { data: member } = await supabase
      .from('members')
      .select('user_id')
      .eq('id', memberId)
      .single();

    if (member) {
      await supabase
        .from('profiles')
        .update({ role })
        .eq('id', member.user_id);
    }
  },

  async deactivate(memberId: string): Promise<void> {
    const { error } = await supabase
      .from('members')
      .update({ is_active: false })
      .eq('id', memberId);
    if (error) throw error;
  },

  async reactivate(memberId: string): Promise<void> {
    const { error } = await supabase
      .from('members')
      .update({ is_active: true })
      .eq('id', memberId);
    if (error) throw error;
  },
};
