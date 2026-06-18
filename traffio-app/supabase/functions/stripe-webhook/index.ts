/**
 * Edge Function: stripe-webhook
 *
 * Listener para eventos do Stripe. Valida a assinatura do webhook
 * e atualiza o status de assinatura do tenant no banco.
 *
 * Eventos tratados:
 *   checkout.session.completed            → trialing: cartão coletado, trial preservado
 *                                           active: ativa a assinatura (upgrade sem trial)
 *   customer.subscription.updated         → atualiza plano/status (trial→active, upgrade, renovação)
 *   customer.subscription.deleted         → cancela a assinatura
 *   customer.subscription.trial_will_end  → e-mail SMTP ao owner (3 dias antes da 1ª cobrança)
 *   invoice.payment_failed                → suspende a assinatura
 *   invoice.payment_succeeded             → reativa se estava suspensa
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (e-mail trial_will_end)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { sendEmail } from "../_shared/email.ts";

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
      // Cliente finalizou o checkout. Em trial: só registra o cartão e preserva
      // o trial (cobrança só no fim). Sem trial (upgrade): ativa de imediato.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Tratar recarga de saldo na carteira
        if (session.mode === "payment" && session.metadata?.type === "wallet_recharge") {
          const tenantId = session.metadata?.tenant_id;
          const amountBrl = parseFloat(session.metadata?.amount_brl ?? "0");

          if (!tenantId || isNaN(amountBrl) || amountBrl <= 0) {
            console.warn("[stripe-webhook] checkout.session.completed para recarga sem tenant_id ou amount_brl");
            break;
          }

          const { data: wallet, error: walletErr } = await supabase
            .from("tenant_wallets")
            .select("balance_brl")
            .eq("tenant_id", tenantId)
            .maybeSingle();

          if (walletErr) {
            console.error(`[stripe-webhook] Erro ao buscar carteira para recarga: ${walletErr.message}`);
            break;
          }

          const currentBalance = wallet?.balance_brl ? Number(wallet.balance_brl) : 0;
          const newBalance = currentBalance + amountBrl;

          const { error: updateErr } = await supabase
            .from("tenant_wallets")
            .update({
              balance_brl: newBalance,
              updated_at: new Date().toISOString()
            })
            .eq("tenant_id", tenantId);

          if (updateErr) {
            console.error(`[stripe-webhook] Erro ao atualizar saldo da carteira: ${updateErr.message}`);
            break;
          }

          const { error: txErr } = await supabase
            .from("wallet_transactions")
            .insert({
              tenant_id: tenantId,
              type: "recharge",
              amount_brl: amountBrl,
              balance_after_brl: newBalance,
              description: `Recarga de créditos via Stripe (ref: ${session.id})`,
              reference_type: "stripe"
            });

          if (txErr) {
            console.error(`[stripe-webhook] Erro ao registrar transação de recarga: ${txErr.message}`);
          } else {
            console.log(`[stripe-webhook] Recarga de R$ ${amountBrl.toFixed(2)} concluída com sucesso para o tenant ${tenantId}`);
          }
          break;
        }

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

        if (subscription.status === "trialing") {
          // Cartão coletado durante o trial — NÃO ativar nem zerar o trial.
          const trialEndsAt = subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toISOString()
            : null;
          const renewsAt = new Date(subscription.current_period_end * 1000).toISOString();

          await supabase
            .from("tenants")
            .update({
              plan:                     planId,
              subscription_status:      "trial",
              billing_cycle:            billingCycle,
              card_on_file:             true,
              trial_ends_at:            trialEndsAt,
              subscription_renews_at:   renewsAt,
              subscription_external_id: subscription.id,
            })
            .eq("id", tenantId);

          console.log(`[stripe-webhook] tenant=${tenantId} cartão registrado, trial até ${trialEndsAt}`);
        } else {
          // Upgrade/assinatura sem trial — cobrança imediata, ativa já.
          await activateSubscription(supabase, tenantId, planId, billingCycle, subscription);
          await createInvoiceRecord(supabase, tenantId, planId, billingCycle, subscription);
        }
        break;
      }

      // ── customer.subscription.updated ─────────────────────────────────────
      // Renovação automática, mudança de plano via portal ou fim do trial
      // (transição trialing → active = 1ª cobrança bem-sucedida).
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const previousStatus = (event.data.previous_attributes as any)?.status;
        const tenant = await getTenantByCustomerId(supabase, subscription.customer as string);
        if (!tenant) break;

        const newStatus = STRIPE_STATUS_MAP[subscription.status] ?? "suspended";
        const renewsAt  = new Date(subscription.current_period_end * 1000).toISOString();

        // Tentar extrair plano dos metadados da subscription
        const planId = (subscription.metadata?.plan_id ?? tenant.plan) as PlanId;

        const updates: Record<string, unknown> = {
          plan:                    planId,
          subscription_status:     newStatus,
          subscription_renews_at:  renewsAt,
        };

        if (newStatus === "active") {
          // Assinatura cobrando — trial encerrado, cartão comprovadamente válido
          updates.trial_ends_at = null;
          updates.card_on_file  = true;
          if (!tenant.subscription_started_at) {
            updates.subscription_started_at = new Date(
              subscription.current_period_start * 1000
            ).toISOString();
          }
        }

        await supabase.from("tenants").update(updates).eq("id", tenant.id);

        // Fim do trial: registrar a 1ª fatura (idempotente — a mesma fatura
        // também chega via invoice.payment_succeeded)
        if (previousStatus === "trialing" && subscription.status === "active") {
          const cycle = (subscription.metadata?.billing_cycle ?? "monthly") as BillingCycle;
          await createInvoiceRecord(supabase, tenant.id, planId, cycle, subscription);
          console.log(`[stripe-webhook] tenant=${tenant.id} trial encerrado → ativo (1ª cobrança)`);
        }

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

      // ── customer.subscription.trial_will_end ──────────────────────────────
      // Stripe dispara ~3 dias antes do fim do trial. Avisa o owner por
      // e-mail (SMTP) sobre a 1ª cobrança — best-effort, nunca falha o webhook.
      case "customer.subscription.trial_will_end": {
        const subscription = event.data.object as Stripe.Subscription;
        const tenant = await getTenantByCustomerId(supabase, subscription.customer as string);
        if (!tenant) break;

        try {
          // E-mail do owner do tenant
          const { data: owner } = await supabase
            .from("members")
            .select("user_id")
            .eq("tenant_id", tenant.id)
            .eq("role", "owner")
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();

          if (!owner) {
            console.warn(`[stripe-webhook] trial_will_end: owner não encontrado tenant=${tenant.id}`);
            break;
          }

          const { data: profile } = await supabase
            .from("profiles")
            .select("email, full_name")
            .eq("id", owner.user_id)
            .maybeSingle();

          if (!profile?.email) {
            console.warn(`[stripe-webhook] trial_will_end: owner sem e-mail tenant=${tenant.id}`);
            break;
          }

          const amount = (subscription.items.data[0]?.price?.unit_amount ?? 0) / 100;
          const amountLabel = amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
          const chargeDate = subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toLocaleDateString("pt-BR")
            : "em breve";
          const firstName = (profile.full_name ?? "").split(" ")[0] || "Olá";

          await sendEmail({
            to: profile.email,
            subject: "Seu trial Traffio termina em 3 dias",
            html: `
              <h2>${firstName}, seu período de teste está acabando!</h2>
              <p>Seu trial gratuito do Traffio termina em <strong>3 dias</strong>.</p>
              <p>A cobrança de <strong>${amountLabel}</strong> será feita em <strong>${chargeDate}</strong> no cartão cadastrado.</p>
              <p>Se quiser continuar, não precisa fazer nada — está tudo pronto. 🎉</p>
              <p>Se preferir cancelar, acesse a página <strong>Assinatura → Gerenciar Faturamento</strong> na plataforma a qualquer momento antes da cobrança, sem custo.</p>
              <p style="color:#999;font-size:12px;">Traffio · cadastro@traffio.com.br</p>
            `,
          });

          console.log(`[stripe-webhook] trial_will_end: e-mail enviado para owner tenant=${tenant.id}`);
        } catch (emailErr: any) {
          console.error(`[stripe-webhook] trial_will_end: falha no e-mail tenant=${tenant.id}:`, emailErr.message);
        }
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

          await insertInvoiceOnce(supabase, {
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

          await insertInvoiceOnce(supabase, {
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
    .select("id, plan, subscription_status, subscription_started_at")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (!data) {
    console.warn(`[stripe-webhook] tenant não encontrado para customer: ${customerId}`);
  }
  return data;
}

/**
 * Insert idempotente em tenant_invoices: o mesmo external_invoice_id
 * pode chegar por mais de um evento (ex: subscription.updated +
 * invoice.payment_succeeded) ou por replay do webhook — grava só uma vez.
 */
async function insertInvoiceOnce(supabase: any, record: Record<string, unknown>) {
  const externalId = record.external_invoice_id;
  if (externalId) {
    const { data: existing } = await supabase
      .from("tenant_invoices")
      .select("id")
      .eq("external_invoice_id", externalId)
      .maybeSingle();

    if (existing) {
      console.log(`[stripe-webhook] fatura ${externalId} já registrada — skip`);
      return;
    }
  }
  await supabase.from("tenant_invoices").insert(record);
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

  await insertInvoiceOnce(supabase, {
    tenant_id:           tenantId,
    plan_id:             planId,
    billing_cycle:       billingCycle,
    amount:              (latestInvoice.amount_paid ?? 0) / 100,
    status:              "paid",
    paid_at:             new Date().toISOString(),
    external_invoice_id: latestInvoice.id,
  });
}
