/**
 * Edge Function: stripe-set-extra-numbers (master admin)
 *
 * Define quantos números WhatsApp ADICIONAIS (além do 1º incluso em todo plano)
 * um tenant tem, e reflete isso na assinatura do Stripe como item recorrente
 * (STRIPE_PRICE_EXTRA_WHATSAPP_NUMBER × quantidade, com proração). Cada número
 * é uma instância Z-API paga pela Traffio — por isso é cobrado à parte
 * (docs/PLANO_MONETIZACAO_IA_2026-09.md).
 *
 * Recebe: { tenant_id, quantity } + Authorization: Bearer <jwt de master admin>
 * Sem assinatura no Stripe (trial/manual): só atualiza tenants.extra_whatsapp_numbers.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";
import { EXTRA_NUMBER_PRICE_KEY, resolveStripePriceId } from "../_shared/stripeCatalog.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const stripeKey   = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: isMaster, error: masterErr } = await userClient.rpc("is_master_admin");
    if (masterErr || !isMaster) return json({ error: "Apenas master admin" }, 403);

    const body = await req.json();
    const tenantId = String(body.tenant_id ?? "");
    const quantity = Number(body.quantity);
    if (!tenantId || !Number.isInteger(quantity) || quantity < 0 || quantity > 50) {
      return json({ error: "tenant_id e quantity (0–50) são obrigatórios" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, subscription_external_id, extra_whatsapp_numbers")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return json({ error: "Tenant não encontrado" }, 404);

    let stripeAction: "none" | "created" | "updated" | "removed" = "none";

    if (tenant.subscription_external_id) {
      if (!stripeKey) return json({ error: "Stripe não configurado" }, 500);
      const priceId = await resolveStripePriceId(supabase, EXTRA_NUMBER_PRICE_KEY);
      if (!priceId) return json({ error: "Price do número adicional não sincronizado — rode 'Sincronizar catálogo Stripe' no master" }, 400);

      const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
      const subscription = await stripe.subscriptions.retrieve(tenant.subscription_external_id);
      if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
        const item = subscription.items.data.find((i: Stripe.SubscriptionItem) => i.price.id === priceId);
        if (quantity === 0 && item) {
          await stripe.subscriptionItems.del(item.id, { proration_behavior: "create_prorations" });
          stripeAction = "removed";
        } else if (item && item.quantity !== quantity) {
          await stripe.subscriptionItems.update(item.id, { quantity, proration_behavior: "create_prorations" });
          stripeAction = "updated";
        } else if (!item && quantity > 0) {
          await stripe.subscriptionItems.create({
            subscription: subscription.id, price: priceId, quantity, proration_behavior: "create_prorations",
          });
          stripeAction = "created";
        }
      }
    }

    const { error: updErr } = await supabase
      .from("tenants")
      .update({ extra_whatsapp_numbers: quantity })
      .eq("id", tenantId);
    if (updErr) throw updErr;

    console.log(`[stripe-set-extra-numbers] tenant=${tenantId} extra_numbers=${quantity} stripe=${stripeAction}`);
    return json({ ok: true, tenant_id: tenantId, extra_whatsapp_numbers: quantity, stripe: stripeAction });

  } catch (err: any) {
    console.error("[stripe-set-extra-numbers] error:", err.message);
    return json({ error: err.message ?? "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
