import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

export interface Tenant {
    id: string;
    name: string;
    slug: string;
    specialty: string[];
    zapi_instance_id?: string;
    zapi_token?: string;
    zapi_client_token?: string;
    cloud_api_phone_number_id?: string;
    cloud_api_access_token?: string;
    cloud_api_app_secret?: string;
    bot_config?: any;
}

export class TenantResolver {
    constructor(private supabase: SupabaseClient) { }

    /**
     * Resolves the tenant based on the Z-API Instance ID.
     * This is crucial for multi-tenancy security.
     */
    async resolveByInstanceId(instanceId: string): Promise<Tenant | null> {
        const { data, error } = await this.supabase
            .from('tenants')
            .select('*')
            .eq('zapi_instance_id', instanceId)
            .single();

        if (error || !data) {
            console.error("❌ Tenant resolution failed:", error);
            return null;
        }
        return data as Tenant;
    }

    async resolveByTenantId(tenantId: string): Promise<Tenant | null> {
        const { data, error } = await this.supabase
            .from('tenants')
            .select('*')
            .eq('id', tenantId)
            .single();

        if (error || !data) {
            console.error("❌ Tenant resolution by ID failed:", error);
            return null;
        }
        return data as Tenant;
    }

    /**
     * Resolves the tenant based on the Meta Cloud API Phone Number ID.
     */
    async resolveByCloudApiPhoneNumberId(phoneNumberId: string): Promise<Tenant | null> {
        const { data, error } = await this.supabase
            .from('tenants')
            .select('*')
            .eq('cloud_api_phone_number_id', phoneNumberId)
            .single();

        if (error || !data) {
            console.error("❌ Tenant resolution for Cloud API failed:", error);
            return null;
        }
        return data as Tenant;
    }
}
