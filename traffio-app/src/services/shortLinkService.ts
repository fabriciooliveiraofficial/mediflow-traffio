import { supabase } from '../lib/supabase';

export interface ShortLink {
  id: string;
  tenant_id: string;
  code: string;
  original_url: string;
  clicks: number;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

// Helper to generate a random 6-character slug
function generateRandomSlug(length = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const shortLinkService = {
  async getByCode(code: string): Promise<ShortLink | null> {
    const { data, error } = await supabase
      .from('short_links')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async create(tenantId: string, originalUrl: string, customCode?: string): Promise<ShortLink> {
    let code = customCode?.trim().toLowerCase() || '';
    
    // Clean code to only allow alphanumeric and hyphens/underscores
    if (code) {
      code = code.replace(/[^a-z0-9-_]/g, '');
      if (!code) {
        throw new Error('O identificador personalizado contém apenas caracteres inválidos.');
      }
      
      // Check if custom code already exists
      const existing = await this.getByCode(code);
      if (existing) {
        throw new Error(`O identificador "/l/${code}" já está em uso.`);
      }
    } else {
      // Generate unique random code
      let attempts = 0;
      while (attempts < 5) {
        const tempCode = generateRandomSlug(6);
        const existing = await this.getByCode(tempCode);
        if (!existing) {
          code = tempCode;
          break;
        }
        attempts++;
      }
      if (!code) {
        throw new Error('Falha ao gerar um link curto único. Tente novamente.');
      }
    }

    // Get current authenticated user id
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('short_links')
      .insert({
        tenant_id: tenantId,
        code,
        original_url: originalUrl,
        created_by: user?.id || null,
        clicks: 0
      })
      .select()
      .single();

    if (error) throw error;
    return data as ShortLink;
  },

  async incrementClicks(code: string): Promise<void> {
    try {
      const existing = await this.getByCode(code);
      if (!existing) return;

      await supabase
        .from('short_links')
        .update({ clicks: existing.clicks + 1 })
        .eq('code', code);
    } catch (err) {
      console.error('Error incrementing short link clicks:', err);
    }
  }
};
