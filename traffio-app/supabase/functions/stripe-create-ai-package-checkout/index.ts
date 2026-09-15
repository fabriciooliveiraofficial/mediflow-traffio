/**
 * Edge Function: stripe-create-ai-package-checkout
 *
 * Recebe: { package_id, success_url?, cancel_url?, embedded? }
 *         + Authorization: Bearer <jwt>
 *
 * Compra avulsa de um pacote de conversas de IA (tabela ai_packages). Cria uma
 * Checkout Session em modo pagamento; o crédito na carteira acontece no
 * stripe-webhook (checkout.session.completed, metadata.type = 'ai_package').
 * Espelho do stripe-create-wallet-checkout — ver docs/PLANO_MONETIZACAO_IA_2026-09.md.
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const stripeKey   = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    const appUrl      = Deno.env.get("APP_URL") ?? "https://app.traffio.com.br";

    if (!stripeKey) return json({ error: "Stripe não configurado" }, 500);

    // ── 1. Autenticar caller via JWT ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Não autenticado" }, 401);

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: jwtErr } = await supabase.auth.getUser(jwt);
    if (jwtErr || !user) return json({ error: "Token inválido" }, 401);

    // ── 2. Tenant do usuário (owner/admin) ────────────────────────────────────
    const { data: member } = await supabase
      .from("members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!member) return json({ error: "Tenant não encontrado" }, 403);
    if (!["owner", "admin"].includes(member.role)) {
      return json({ error: "Sem permissão para comprar pacotes" }, 403);
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, stripe_customer_id")
      .eq("id", member.tenant_id)
      .single();
    if (!tenant) return json({ error: "Tenant não encontrado" }, 404);

    // ── 3. Pacote (preço vem do banco, nunca do cliente) ─────────────────────
    const body = await req.json();
    const packageId = String(body.package_id ?? "");
    const { data: pkg } = await supabase
      .from("ai_packages")
      .select("id, units, price_brl, is_active")
      .eq("id", packageId)
      .maybeSingle();
    if (!pkg || !pkg.is_active) return json({ error: `Pacote inválido: ${packageId}` }, 400);

    // ── 4. Stripe Customer ────────────────────────────────────────────────────
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
    let stripeCustomerId = tenant.stripe_customer_id as string | null;
    if (!stripeCustomerId) {
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
      await supabase.from("tenants").update({ stripe_customer_id: stripeCustomerId }).eq("id", tenant.id);
    }

    const sessionMetadata: Record<string, string> = {
      type:       "ai_package",
      tenant_id:  tenant.id,
      package_id: pkg.id,
      units:      String(pkg.units),
    };

    // ── 5. Checkout Session (pagamento único) ─────────────────────────────────
    const isEmbedded = body.embedded === true;
    const sessionData: any = {
      customer: stripeCustomerId,
      mode:     "payment",
      line_items: [{
        price_data: {
          currency: "brl",
          product_data: {
            name: `Pacote de ${pkg.units} conversas de IA`,
            description: "Conversas atendidas pela IA da Traffio além da franquia do plano. Os créditos não expiram.",
          },
          unit_amount: Math.round(Number(pkg.price_brl) * 100),
        },
        quantity: 1,
      }],
      metadata: sessionMetadata,
      locale: "pt-BR",
    };

    if (isEmbedded) {
      sessionData.ui_mode = "embedded";
      sessionData.return_url = `${appUrl}/billing?ai_package=success&session_id={CHECKOUT_SESSION_ID}`;
    } else {
      sessionData.success_url = body.success_url ?? `${appUrl}/billing?ai_package=success`;
      sessionData.cancel_url  = body.cancel_url  ?? `${appUrl}/billing`;
    }

    const session = await stripe.checkout.sessions.create(sessionData);
    return isEmbedded ? json({ clientSecret: session.client_secret }) : json({ url: session.url });

  } catch (err: any) {
    console.error("[stripe-create-ai-package-checkout] error:", err.message);
    return json({ error: err.message ?? "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
