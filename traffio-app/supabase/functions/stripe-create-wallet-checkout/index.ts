/**
 * Edge Function: stripe-create-wallet-checkout
 *
 * Recebe: { amount, success_url, cancel_url }
 *         + Authorization: Bearer <jwt>
 *
 * Responsabilidades:
 *   1. Valida o JWT e obtém o tenant do usuário
 *   2. Cria ou recupera o Stripe Customer vinculado ao tenant
 *   3. Cria uma Checkout Session (modo payment) com o valor solicitado
 *   4. Retorna { url } para o frontend redirecionar
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   STRIPE_SECRET_KEY
 *   APP_URL
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl  = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const stripeKey    = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    const appUrl       = Deno.env.get("APP_URL") ?? "https://app.traffio.com.br";

    if (!stripeKey) {
      return json({ error: "Stripe não configurado" }, 500);
    }

    // ── 1. Autenticar caller via JWT ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Não autenticado" }, 401);

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: jwtErr } = await supabase.auth.getUser(jwt);
    if (jwtErr || !user) return json({ error: "Token inválido" }, 401);

    // ── 2. Obter tenant do usuário ────────────────────────────────────────────
    const { data: member } = await supabase
      .from("members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) return json({ error: "Tenant não encontrado" }, 403);

    // Apenas owner/admin podem adicionar créditos
    if (!["owner", "admin"].includes(member.role)) {
      return json({ error: "Sem permissão para adicionar créditos" }, 403);
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, stripe_customer_id")
      .eq("id", member.tenant_id)
      .single();

    if (!tenant) return json({ error: "Tenant não encontrado" }, 404);

    // ── 3. Validar body ───────────────────────────────────────────────────────
    const body = await req.json();
    const amount = parseFloat(body.amount);

    if (isNaN(amount) || amount < 10) {
      return json({ error: "O valor mínimo de recarga é de R$ 10,00" }, 400);
    }

    // ── 4. Criar ou recuperar Stripe Customer ─────────────────────────────────
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    let stripeCustomerId = tenant.stripe_customer_id as string | null;

    if (!stripeCustomerId) {
      // Buscar email do owner para o customer
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", user.id)
        .maybeSingle();

      const customer = await stripe.customers.create({
        email:    profile?.email ?? user.email ?? undefined,
        name:     tenant.name,
        metadata: { tenant_id: tenant.id },
      });

      stripeCustomerId = customer.id;

      await supabase
        .from("tenants")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", tenant.id);
    }

    const sessionMetadata: Record<string, string> = {
      type:          "wallet_recharge",
      tenant_id:     tenant.id,
      amount_brl:    amount.toFixed(2),
    };

    // ── 5. Criar Checkout Session (One-time payment) ──────────────────────────
    const isEmbedded = body.embedded === true;
    
    const sessionData: any = {
      customer:             stripeCustomerId,
      mode:                 "payment",
      line_items: [{
        price_data: {
          currency: "brl",
          product_data: {
            name: "Recarga de Créditos Traffio",
            description: "Créditos para chamadas, SMS, MMS e aquisição de números de telefone.",
          },
          unit_amount: Math.round(amount * 100), // Em centavos
        },
        quantity: 1,
      }],
      metadata: sessionMetadata,
      locale: "pt-BR",
    };

    if (isEmbedded) {
      sessionData.ui_mode = "embedded";
      sessionData.return_url = `${appUrl}/settings?tab=communications&recharge=success&session_id={CHECKOUT_SESSION_ID}`;
    } else {
      sessionData.success_url = body.success_url ?? `${appUrl}/settings?tab=communications&recharge=success`;
      sessionData.cancel_url  = body.cancel_url  ?? `${appUrl}/settings?tab=communications`;
    }

    const session = await stripe.checkout.sessions.create(sessionData);

    if (isEmbedded) {
      return json({ clientSecret: session.client_secret });
    } else {
      return json({ url: session.url });
    }

  } catch (err: any) {
    console.error("[stripe-create-wallet-checkout] error:", err.message);
    return json({ error: err.message ?? "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
