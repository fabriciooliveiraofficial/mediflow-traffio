/**
 * Edge Function: stripe-change-plan
 *
 * Recebe: { plan_id, billing_cycle } + Authorization: Bearer <jwt>
 *
 * Troca de plano flexível SEMPRE respeitando o período/ciclo já pago:
 *   - Em trial (trialing): troca imediata do price, trial preservado —
 *     nada é cobrado agora; a 1ª cobrança (fim do trial) já sai no valor novo.
 *   - UPGRADE (plano superior, ou mesmo plano mensal→anual): imediato com
 *     proração — o tempo não usado do plano atual vira crédito e só a
 *     diferença proporcional é cobrada.
 *   - DOWNGRADE (plano inferior, ou anual→mensal): agendado para o fim do
 *     período vigente via Subscription Schedule — o cliente mantém tudo o
 *     que já pagou até a renovação; o novo plano entra na virada do ciclo.
 *   - Sem assinatura Stripe ativa → { needs_checkout: true } (front usa o
 *     fluxo de checkout normal).
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   STRIPE_SECRET_KEY + STRIPE_PRICE_* (mesmas do stripe-create-checkout)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

type PlanId = "essencial" | "clinica" | "rede";
type BillingCycle = "monthly" | "annual";

const PLAN_RANK: Record<PlanId, number> = { essencial: 0, clinica: 1, rede: 2 };

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const stripeKey   = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

    if (!stripeKey) return json({ error: "Stripe não configurado" }, 500);

    // ── 1. Autenticar caller via JWT ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Não autenticado" }, 401);

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: jwtErr } = await supabase.auth.getUser(jwt);
    if (jwtErr || !user) return json({ error: "Token inválido" }, 401);

    // ── 2. Tenant do usuário (owner/admin only) ───────────────────────────────
    const { data: member } = await supabase
      .from("members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) return json({ error: "Tenant não encontrado" }, 403);
    if (!["owner", "admin"].includes(member.role)) {
      return json({ error: "Sem permissão para alterar o plano" }, 403);
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, plan, billing_cycle, subscription_status, subscription_external_id")
      .eq("id", member.tenant_id)
      .single();

    if (!tenant) return json({ error: "Tenant não encontrado" }, 404);

    // ── 3. Validar body ───────────────────────────────────────────────────────
    const body = await req.json();
    const newPlanId: PlanId = body.plan_id;
    const newCycle: BillingCycle = body.billing_cycle ?? "monthly";

    if (!["essencial", "clinica", "rede"].includes(newPlanId)) {
      return json({ error: `Plano inválido: ${newPlanId}` }, 400);
    }
    if (!["monthly", "annual"].includes(newCycle)) {
      return json({ error: `Ciclo inválido: ${newCycle}` }, 400);
    }

    // Rede → fluxo de vendas (sem self-service)
    if (newPlanId === "rede") {
      return json({ redirect_to_sales: true });
    }

    const currentPlan  = (tenant.plan ?? "essencial") as PlanId;
    const currentCycle = (tenant.billing_cycle ?? "monthly") as BillingCycle;

    if (newPlanId === currentPlan && newCycle === currentCycle) {
      return json({ error: "Este já é o seu plano atual" }, 400);
    }

    // Sem assinatura no Stripe → front segue para o checkout normal
    if (!tenant.subscription_external_id) {
      return json({ needs_checkout: true });
    }

    const newPriceId = Deno.env.get(PRICE_ENV_MAP[newPlanId][newCycle]);
    if (!newPriceId) {
      return json({ error: `Price não configurado: ${PRICE_ENV_MAP[newPlanId][newCycle]}` }, 500);
    }

    // ── 4. Carregar a assinatura atual ────────────────────────────────────────
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
    const subscription = await stripe.subscriptions.retrieve(tenant.subscription_external_id);

    if (["canceled", "incomplete_expired"].includes(subscription.status)) {
      return json({ needs_checkout: true });
    }

    const item = subscription.items.data[0];
    if (!item) return json({ error: "Assinatura sem itens no Stripe" }, 500);

    const newMetadata = {
      tenant_id:     tenant.id,
      plan_id:       newPlanId,
      billing_cycle: newCycle,
    };

    // Downgrade agendado anteriormente? Libera o schedule antes de qualquer mudança
    if (subscription.schedule) {
      const scheduleId = typeof subscription.schedule === "string"
        ? subscription.schedule
        : subscription.schedule.id;
      await stripe.subscriptionSchedules.release(scheduleId);
      console.log(`[stripe-change-plan] schedule ${scheduleId} liberado (mudança anterior descartada)`);
    }

    // Upgrade = plano superior OU mesmo plano migrando mensal→anual
    const isUpgrade =
      PLAN_RANK[newPlanId] > PLAN_RANK[currentPlan] ||
      (newPlanId === currentPlan && currentCycle === "monthly" && newCycle === "annual");

    // ── 5a. Em trial: troca livre e imediata, trial preservado ────────────────
    if (subscription.status === "trialing") {
      await stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price: newPriceId }],
        proration_behavior: "none",
        metadata: newMetadata,
      });

      await supabase
        .from("tenants")
        .update({ plan: newPlanId, billing_cycle: newCycle })
        .eq("id", tenant.id);

      console.log(`[stripe-change-plan] tenant=${tenant.id} trial: ${currentPlan}/${currentCycle} → ${newPlanId}/${newCycle}`);
      return json({ changed: "immediate", trial: true, plan_id: newPlanId, billing_cycle: newCycle });
    }

    // ── 5b. Upgrade: imediato com proração (crédito do tempo não usado) ───────
    if (isUpgrade) {
      await stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price: newPriceId }],
        proration_behavior: "always_invoice",
        payment_behavior: "allow_incomplete",
        metadata: newMetadata,
      });

      await supabase
        .from("tenants")
        .update({ plan: newPlanId, billing_cycle: newCycle })
        .eq("id", tenant.id);

      console.log(`[stripe-change-plan] tenant=${tenant.id} upgrade imediato: ${currentPlan}/${currentCycle} → ${newPlanId}/${newCycle}`);
      return json({ changed: "immediate", plan_id: newPlanId, billing_cycle: newCycle });
    }

    // ── 5c. Downgrade: agendado para o fim do período já pago ─────────────────
    const periodEnd = subscription.current_period_end;

    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: subscription.id,
    });

    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      phases: [
        {
          // Fase 1: plano atual até o fim do período pago (sem mudanças)
          items:      [{ price: item.price.id, quantity: 1 }],
          start_date: schedule.phases[0].start_date,
          end_date:   periodEnd,
        },
        {
          // Fase 2: novo plano a partir da renovação
          items:      [{ price: newPriceId, quantity: 1 }],
          iterations: 1,
          metadata:   newMetadata,
        },
      ],
    });

    // tenant.plan NÃO muda agora — o webhook subscription.updated aplica
    // quando a fase 2 começar (metadata.plan_id chega junto).
    const effectiveAt = new Date(periodEnd * 1000).toISOString();
    console.log(`[stripe-change-plan] tenant=${tenant.id} downgrade agendado p/ ${effectiveAt}: ${currentPlan}/${currentCycle} → ${newPlanId}/${newCycle}`);
    return json({ changed: "scheduled", plan_id: newPlanId, billing_cycle: newCycle, effective_at: effectiveAt });

  } catch (err: any) {
    console.error("[stripe-change-plan] error:", err.message);
    return json({ error: err.message ?? "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
