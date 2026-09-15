import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

/** Chave em master_config do Price mensal do número WhatsApp adicional. */
export const EXTRA_NUMBER_PRICE_KEY = "STRIPE_PRICE_EXTRA_WHATSAPP_NUMBER";

/**
 * Resolve um Stripe Price ID: master_config (gravado por stripe-sync-catalog a
 * partir da tabela `plans`) tem prioridade sobre o Supabase Secret de mesmo
 * nome. É assim que um reajuste de preço entra em vigor sem redeploy nem
 * edição de secrets — o secret fica só como fallback dos IDs originais.
 * Lê direto do banco (sem o cache de 5min do masterConfig): um preço recém
 * sincronizado precisa valer no próximo checkout.
 */
export async function resolveStripePriceId(supabase: SupabaseClient, key: string): Promise<string | null> {
    try {
        const { data } = await supabase.from("master_config").select("value").eq("key", key).maybeSingle();
        const fromDb = (data?.value ?? "").trim();
        if (fromDb) return fromDb;
    } catch (err: any) {
        console.warn(`[stripeCatalog] leitura de ${key} em master_config falhou: ${err?.message}`);
    }
    return Deno.env.get(key)?.trim() || null;
}
