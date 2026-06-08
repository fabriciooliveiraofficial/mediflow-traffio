import { supabase } from '../lib/supabase';

export interface ScriptAttachment {
  type: 'image' | 'audio' | 'video' | 'document' | 'link';
  url: string;
  name: string;
  mimeType?: string;
  fileSize?: number;
  durationS?: number;
}

export interface SalesScript {
  id: string;
  tenant_id: string | null;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
  icon: string | null;
  attachments: ScriptAttachment[];
  variables: string[];
  is_active: boolean;
  sort_order: number;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const salesScriptService = {
  async getAll(tenantId: string) {
    const { data, error } = await supabase
      .from('sales_scripts')
      .select('*')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true });

    if (error) throw error;
    
    // Ensure attachments and variables are parsed safely as arrays
    const items = (data || []).map(item => ({
      ...item,
      attachments: Array.isArray(item.attachments) ? item.attachments : [],
      variables: Array.isArray(item.variables) ? item.variables : []
    })) as SalesScript[];

    // Filter out global scripts (tenant_id IS NULL) if a tenant-specific script with the same shortcut exists
    const tenantShortcuts = new Set(
      items.filter(item => item.tenant_id !== null).map(item => item.shortcut)
    );

    return items.filter(item => item.tenant_id !== null || !tenantShortcuts.has(item.shortcut));
  },

  async create(script: Partial<SalesScript>) {
    const { data, error } = await supabase
      .from('sales_scripts')
      .insert({
        ...script,
        attachments: script.attachments || [],
        variables: script.variables || []
      })
      .select()
      .single();

    if (error) throw error;
    return data as SalesScript;
  },

  async update(id: string, script: Partial<SalesScript>) {
    const { data, error } = await supabase
      .from('sales_scripts')
      .update({
        ...script,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as SalesScript;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('sales_scripts')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  async uploadAttachment(tenantId: string, file: File): Promise<string> {
    const ext = file.name.split('.').pop();
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    const folder = isImage ? 'images' : isVideo ? 'videos' : isAudio ? 'audios' : 'documents';
    
    const fileName = `${tenantId}/scripts/${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
    
    const { data, error } = await supabase.storage
      .from('chat-media')
      .upload(fileName, file, { 
        cacheControl: '3600', 
        upsert: false 
      });
      
    if (error) throw error;
    
    const { data: { publicUrl } } = supabase.storage
      .from('chat-media')
      .getPublicUrl(data.path);
      
    return publicUrl;
  }
};
