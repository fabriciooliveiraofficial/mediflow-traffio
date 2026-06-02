import { supabase } from '../lib/supabase';

export interface KnowledgeItem {
  id: string;
  tenant_id: string;
  category: string;
  title: string;
  content: string;
  embedding?: number[];
  location_id?: string | null;
  is_active: boolean;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export const knowledgeBaseService = {
  async getAll(tenantId: string) {
    const { data, error } = await supabase
      .from('knowledge_base')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data as KnowledgeItem[];
  },

  async upsert(item: Partial<KnowledgeItem>) {
    const { data, error } = await supabase
      .from('knowledge_base')
      .upsert(item)
      .select()
      .single();

    if (error) throw error;
    return data as KnowledgeItem;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('knowledge_base')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};
