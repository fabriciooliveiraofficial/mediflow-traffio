/**
 * Edge Function: stripe-create-checkout
 *
 * Recebe: { plan_id, billing_cycle, success_url, cancel_url }
 *         + Authorization: Bearer <jwt>
 *
 * Responsabilidades:
 *   1. Valida o JWT e obtém o tenant do usuário
 *   2. Cria ou recupera o Stripe Customer vinculado ao tenant
 *   3. Resolve o Stripe Price ID a partir do plano e ciclo solicitados
 *   4. Cria uma Checkout Session (modo subscription)
 *   5. Retorna { url } para o frontend redirecionar
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   STRIPE_SECRET_KEY
 *   STRIPE_PRICE_ESSENCIAL_MONTHLY
 *   STRIPE_PRICE_ESSENCIAL_ANNUAL
 *   STRIPE_PRICE_CLINICA_MONTHLY
 *   STRIPE_PRICE_CLINICA_ANNUAL
 *   STRIPE_PRICE_REDE_MONTHLY
 *   STRIPE_PRICE_REDE_ANNUAL
 *   APP_URL
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

type PlanId = "essencial" | "clinica" | "rede";
type BillingCycle = "monthly" | "annual";

// Mapa de plano+ciclo → variável de ambiente com o Stripe Price ID
const PRICE_ENV_MAP: Record<PlanId, Record<BillingCycle, string>> = {
  essencial: {
    monthly: "STRIPE_PRICE_ESSENCIAL_MONTHLY",
    annual:  "STRIPE_PRICE_ESSENCIAL_ANNUAL",
  },
  clinica: {
    monthly: "STRIPE_PRICE_CLINICA_MONTHLY",
    annual:  "STRIPE_PRICE_CLINICA_ANNUAL",
  },
  rede: {
    monthly: "STRIPE_PRICE_REDE_MONTHLY",
    annual:  "STRIPE_PRICE_REDE_ANNUAL",
  },
};

const PLAN_NAMES: Record<PlanId, string> = {
  essencial: "Essencial",
  clinica:   "Clínica",
  rede:      "Rede",
};

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

    // Apenas owner/admin podem alterar o plano
    if (!["owner", "admin"].includes(member.role)) {
      return json({ error: "Sem permissão para alterar o plano" }, 403);
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, stripe_customer_id, plan, subscription_status, trial_ends_at")
      .eq("id", member.tenant_id)
      .single();

    if (!tenant) return json({ error: "Tenant não encontrado" }, 404);

    // ── 3. Validar body ───────────────────────────────────────────────────────
    const body = await req.json();
    const planId: PlanId         = body.plan_id;
    const billingCycle: BillingCycle = body.billing_cycle ?? "monthly";

    const validPlans: PlanId[] = ["essencial", "clinica", "rede"];
    if (!validPlans.includes(planId)) {
      return json({ error: `Plano inválido: ${planId}` }, 400);
    }

    // Rede → direcionar para contato (não processa via checkout)
    if (planId === "rede") {
      return json({ redirect_to_sales: true, url: `${appUrl}/billing?contato=rede` });
    }

    // ── 4. Resolver Stripe Price ID ───────────────────────────────────────────
    const priceEnvKey = PRICE_ENV_MAP[planId][billingCycle];
    const stripePriceId = Deno.env.get(priceEnvKey);
    if (!stripePriceId) {
      return json({ error: `Price não configurado: ${priceEnvKey}` }, 500);
    }

    // ── 5. Criar ou recuperar Stripe Customer ─────────────────────────────────
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

    // ── 6. Trial: casar o trial do Stripe com o trial do banco ────────────────
    // Tenant em trial com data futura → o checkout só coleta o cartão e a
    // 1ª cobrança acontece no fim do trial (mín. 1, máx. 14 dias).
    // Tenant já ativo (upgrade) → sem trial, cobrança imediata.
    let trialPeriodDays: number | undefined;
    if (tenant.subscription_status === "trial" && tenant.trial_ends_at) {
      const msLeft = new Date(tenant.trial_ends_at).getTime() - Date.now();
      if (msLeft > 0) {
        // Respeita o trial_ends_at real do tenant (inclui extensões dadas pelo
        // super-admin). Cap de 730 dias = limite do trial_period_days do Stripe.
        trialPeriodDays = Math.min(730, Math.max(1, Math.ceil(msLeft / 86_400_000)));
      }
    }

    const sessionMetadata: Record<string, string> = {
      tenant_id:     tenant.id,
      plan_id:       planId,
      billing_cycle: billingCycle,
      ...(trialPeriodDays ? { flow: "registration_trial" } : {}),
    };

    // ── 7. Criar Checkout Session ─────────────────────────────────────────────
    const successUrl = body.success_url ?? `${appUrl}/billing?checkout=success`;
    const cancelUrl  = body.cancel_url  ?? `${appUrl}/billing`;

    const session = await stripe.checkout.sessions.create({
      customer:             stripeCustomerId,
      mode:                 "subscription",
      payment_method_types: ["card"],
      // Cartão é SEMPRE coletado, mesmo com total R$0 durante o trial
      payment_method_collection: "always",
      line_items: [{
        price:    stripePriceId,
        quantity: 1,
      }],
      subscription_data: {
        ...(trialPeriodDays ? { trial_period_days: trialPeriodDays } : {}),
        metadata: sessionMetadata,
      },
      metadata: sessionMetadata,
      success_url: successUrl,
      cancel_url:  cancelUrl,
      allow_promotion_codes: true,
      locale: "pt-BR",
      custom_text: {
        submit: {
          message: trialPeriodDays
            ? `Plano ${PLAN_NAMES[planId]} · nada será cobrado durante os ${trialPeriodDays} dias de trial`
            : `Assinatura do plano ${PLAN_NAMES[planId]} · Traffio`,
        },
      },
    });

    return json({ url: session.url });

  } catch (err: any) {
    console.error("[stripe-create-checkout] error:", err.message);
    return json({ error: err.message ?? "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
