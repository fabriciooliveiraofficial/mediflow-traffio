/**
 * Edge Function: stripe-webhook
 *
 * Listener para eventos do Stripe. Valida a assinatura do webhook
 * e atualiza o status de assinatura do tenant no banco.
 *
 * Eventos tratados:
 *   checkout.session.completed       → ativa a assinatura (1ª compra)
 *   customer.subscription.updated    → atualiza plano/status (upgrade, renovação)
 *   customer.subscription.deleted    → cancela a assinatura
 *   invoice.payment_failed           → suspende a assinatura
 *   invoice.payment_succeeded        → reativa se estava suspensa
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

type PlanId        = "essencial" | "clinica" | "rede";
type SubStatus     = "trial" | "active" | "suspended" | "canceled";
type BillingCycle  = "monthly" | "annual";

// Mapa de status Stripe → status interno
const STRIPE_STATUS_MAP: Record<string, SubStatus> = {
  active:             "active",
  past_due:           "suspended",
  unpaid:             "suspended",
  canceled:           "canceled",
  incomplete:         "suspended",
  incomplete_expired: "canceled",
  trialing:           "trial",
  paused:             "suspended",
};

serve(async (req: Request) => {
  const stripeKey     = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const supabaseUrl   = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!stripeKey || !webhookSecret) {
    console.error("[stripe-webhook] Stripe não configurado");
    return new Response("Stripe não configurado", { status: 500 });
  }

  // ── Verificar assinatura do webhook ──────────────────────────────────────
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  const body = await req.text();
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err: any) {
    console.error("[stripe-webhook] Assinatura inválida:", err.message);
    return new Response(`Webhook signature error: ${err.message}`, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  console.log(`[stripe-webhook] event=${event.type}`);

  try {
    switch (event.type) {

      // ── checkout.session.completed ─────────────────────────────────────────
      // Disparado quando o cliente finaliza o checkout. Ativa a assinatura.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const tenantId     = session.metadata?.tenant_id;
        const planId       = session.metadata?.plan_id as PlanId;
        const billingCycle = (session.metadata?.billing_cycle ?? "monthly") as BillingCycle;

        if (!tenantId || !planId) {
          console.warn("[stripe-webhook] checkout.session.completed sem metadata");
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        );

        await activateSubscription(supabase, tenantId, planId, billingCycle, subscription);
        await createInvoiceRecord(supabase, tenantId, planId, billingCycle, subscription);
        break;
      }

      // ── customer.subscription.updated ─────────────────────────────────────
      // Renovação automática ou mudança de plano via portal Stripe.
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const tenant = await getTenantByCustomerId(supabase, subscription.customer as string);
        if (!tenant) break;

        const newStatus = STRIPE_STATUS_MAP[subscription.status] ?? "suspended";
        const renewsAt  = new Date(subscription.current_period_end * 1000).toISOString();

        // Tentar extrair plano dos metadados da subscription
        const planId = (subscription.metadata?.plan_id ?? tenant.plan) as PlanId;

        await supabase
          .from("tenants")
          .update({
            plan:                    planId,
            subscription_status:     newStatus,
            subscription_renews_at:  renewsAt,
          })
          .eq("id", tenant.id);

        console.log(`[stripe-webhook] tenant=${tenant.id} status=${newStatus} renews=${renewsAt}`);
        break;
      }

      // ── customer.subscription.deleted ─────────────────────────────────────
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const tenant = await getTenantByCustomerId(supabase, subscription.customer as string);
        if (!tenant) break;

        await supabase
          .from("tenants")
          .update({ subscription_status: "canceled" })
          .eq("id", tenant.id);

        console.log(`[stripe-webhook] tenant=${tenant.id} cancelado`);
        break;
      }

      // ── invoice.payment_failed ─────────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.customer) break;

        const tenant = await getTenantByCustomerId(supabase, invoice.customer as string);
        if (!tenant) break;

        await supabase
          .from("tenants")
          .update({ subscription_status: "suspended" })
          .eq("id", tenant.id);

        // Registrar fatura com falha
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const planId = (sub.metadata?.plan_id ?? tenant.plan) as PlanId;
          const cycle  = (sub.metadata?.billing_cycle ?? "monthly") as BillingCycle;

          await supabase.from("tenant_invoices").insert({
            tenant_id:           tenant.id,
            plan_id:             planId,
            billing_cycle:       cycle,
            amount:              (invoice.amount_due ?? 0) / 100,
            status:              "failed",
            due_date:            invoice.due_date
              ? new Date(invoice.due_date * 1000).toISOString().split("T")[0]
              : null,
            external_invoice_id: invoice.id,
          });
        }

        console.log(`[stripe-webhook] tenant=${tenant.id} pagamento falhou — suspenso`);
        break;
      }

      // ── invoice.payment_succeeded ──────────────────────────────────────────
      // Renovação bem-sucedida — reativa se estava suspensa.
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.customer || invoice.billing_reason === "subscription_create") break;

        const tenant = await getTenantByCustomerId(supabase, invoice.customer as string);
        if (!tenant) break;

        if (tenant.subscription_status === "suspended") {
          await supabase
            .from("tenants")
            .update({ subscription_status: "active" })
            .eq("id", tenant.id);
        }

        // Registrar fatura paga
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const planId = (sub.metadata?.plan_id ?? tenant.plan) as PlanId;
          const cycle  = (sub.metadata?.billing_cycle ?? "monthly") as BillingCycle;

          await supabase.from("tenant_invoices").insert({
            tenant_id:           tenant.id,
            plan_id:             planId,
            billing_cycle:       cycle,
            amount:              (invoice.amount_paid ?? 0) / 100,
            status:              "paid",
            paid_at:             new Date().toISOString(),
            external_invoice_id: invoice.id,
          });
        }

        console.log(`[stripe-webhook] tenant=${tenant.id} renovação paga`);
        break;
      }

      default:
        console.log(`[stripe-webhook] evento ignorado: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[stripe-webhook] erro interno:", err.message);
    return new Response(err.message, { status: 500 });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function getTenantByCustomerId(supabase: any, customerId: string) {
  const { data } = await supabase
    .from("tenants")
    .select("id, plan, subscription_status")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (!data) {
    console.warn(`[stripe-webhook] tenant não encontrado para customer: ${customerId}`);
  }
  return data;
}

async function activateSubscription(
  supabase: any,
  tenantId: string,
  planId: PlanId,
  billingCycle: BillingCycle,
  subscription: Stripe.Subscription
) {
  const renewsAt = new Date(subscription.current_period_end * 1000).toISOString();
  const startedAt = new Date(subscription.current_period_start * 1000).toISOString();

  await supabase
    .from("tenants")
    .update({
      plan:                       planId,
      subscription_status:        "active",
      billing_cycle:              billingCycle,
      subscription_started_at:    startedAt,
      subscription_renews_at:     renewsAt,
      trial_ends_at:              null,
      subscription_external_id:   subscription.id,
    })
    .eq("id", tenantId);

  console.log(`[stripe-webhook] tenant=${tenantId} ativado plan=${planId} renews=${renewsAt}`);
}

async function createInvoiceRecord(
  supabase: any,
  tenantId: string,
  planId: PlanId,
  billingCycle: BillingCycle,
  subscription: Stripe.Subscription
) {
  // Busca a fatura mais recente da subscription para registrar o valor
  const invoices = await fetch(
    `https://api.stripe.com/v1/invoices?subscription=${subscription.id}&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`,
      },
    }
  ).then((r) => r.json());

  const latestInvoice = invoices?.data?.[0];
  if (!latestInvoice) return;

  await supabase.from("tenant_invoices").insert({
    tenant_id:           tenantId,
    plan_id:             planId,
    billing_cycle:       billingCycle,
    amount:              (latestInvoice.amount_paid ?? 0) / 100,
    status:              "paid",
    paid_at:             new Date().toISOString(),
    external_invoice_id: latestInvoice.id,
  });
}
