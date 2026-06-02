import { supabase } from '../lib/supabase';

export interface CloudApiCredentials {
    whatsapp_provider: 'zapi' | 'cloud_api';
    cloud_api_phone_number_id?: string;
    cloud_api_access_token?: string;
    cloud_api_business_account_id?: string;
}

export const cloudApiService = {
    /**
     * Updates the tenant's WhatsApp provider and credentials.
     */
    async saveSettings(tenantId: string, settings: CloudApiCredentials): Promise<boolean> {
        try {
            const { error } = await supabase
                .from('tenants')
                .update(settings)
                .eq('id', tenantId);

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error saving Cloud API settings:', error);
            return false;
        }
    },

    /**
     * Switch back to Z-API
     */
    async switchToZapi(tenantId: string): Promise<boolean> {
        try {
            const { error } = await supabase
                .from('tenants')
                .update({ whatsapp_provider: 'zapi' })
                .eq('id', tenantId);

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error switching to Z-API:', error);
            return false;
        }
    },

    /**
     * Placeholder for testing connection.
     * In a real scenario, this would call an Edge Function to verify the token.
     */
    async testConnection(phoneNumberId: string, accessToken: string): Promise<{ success: boolean; message: string }> {
        try {
            // Basic check: try to fetch phone number details from Meta Graph API
            const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            const data = await response.json();
            if (response.ok) {
                return { success: true, message: `Conectado a: ${data.display_phone_number || phoneNumberId}` };
            } else {
                return { success: false, message: data.error?.message || 'Falha na verificação' };
            }
        } catch (error: any) {
            return { success: false, message: error.message };
        }
    }
};
