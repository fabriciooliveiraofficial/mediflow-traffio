/**
 * Edge Function: stripe-connect-webhook
 *
 * Listener para eventos Stripe Connect (contas dos TENANTS — pagamentos
 * de pacientes). Endpoint separado do stripe-webhook (assinatura da
 * plataforma): eventos Connect são assinados com secret próprio e
 * chegam com event.account = acct_... do tenant.
 *
 * Eventos tratados:
 *   account.updated              → sincroniza charges_enabled/status do tenant
 *   checkout.session.completed   → concilia billing_record (link de pagamento pago)
 *   payment_intent.succeeded     → fallback de conciliação por metadata
 *   charge.refunded              → marca billing_record como refunded
 *
 * Configuração no Stripe Dashboard (Developers → Webhooks):
 *   Endpoint: https://<project>.supabase.co/functions/v1/stripe-connect-webhook
 *   Tipo: "Events on Connected accounts" (não "Account")
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   STRIPE_SECRET_KEY
 *   STRIPE_CONNECT_WEBHOOK_SECRET
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

serve(async (req: Request) => {
  const stripeKey     = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET") ?? "";
  const supabaseUrl   = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!stripeKey || !webhookSecret) {
    console.error("[stripe-connect-webhook] Stripe Connect não configurado");
    return new Response("Stripe Connect não configurado", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  const body = await req.text();
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-connect-webhook] Assinatura inválida:", message);
    return new Response(`Webhook signature error: ${message}`, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const connectedAccount = (event as { account?: string }).account ?? null;
  console.log(`[stripe-connect-webhook] event=${event.type} account=${connectedAccount}`);

  try {
    switch (event.type) {

      // ── account.updated: sincronizar estado da conexão do tenant ─────────
      case "account.updated": {
        const account = event.data.object as Stripe.Account;

        const status = account.charges_enabled
          ? "active"
          : account.details_submitted
            ? "disabled"
            : "onboarding";

        const { error } = await supabase
          .from("tenants")
          .update({
            stripe_charges_enabled: account.charges_enabled ?? false,
            stripe_connect_status: status,
          })
          .eq("stripe_account_id", account.id);

        if (error) {
          console.error(`[stripe-connect-webhook] account.updated: ${error.message}`);
        }
        break;
      }

      // ── checkout.session.completed: link de pagamento quitado ────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const billingRecordId = session.metadata?.billing_record_id;
        if (session.payment_status !== "paid") break;

        // Localiza pela metadata (preferido) ou pela session já registrada
        const match = billingRecordId
          ? { column: "id", value: billingRecordId }
          : { column: "stripe_checkout_session_id", value: session.id };

        const { error } = await supabase
          .from("billing_records")
          .update({
            status: "paid",
            payment_method: "stripe",
            paid_at: new Date().toISOString(),
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? null,
          })
          .eq(match.column, match.value)
          .neq("status", "paid"); // idempotência

        if (error) {
          console.error(`[stripe-connect-webhook] checkout.session.completed: ${error.message}`);
        }
        break;
      }

      // ── payment_intent.succeeded: fallback de conciliação ────────────────
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const billingRecordId = intent.metadata?.billing_record_id;
        if (!billingRecordId) break;

        const { error } = await supabase
          .from("billing_records")
          .update({
            status: "paid",
            payment_method: "stripe",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: intent.id,
          })
          .eq("id", billingRecordId)
          .neq("status", "paid");

        if (error) {
          console.error(`[stripe-connect-webhook] payment_intent.succeeded: ${error.message}`);
        }
        break;
      }

      // ── charge.refunded: estorno na conta do tenant ──────────────────────
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const intentId = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
        if (!intentId) break;

        const { error } = await supabase
          .from("billing_records")
          .update({ status: "refunded" })
          .eq("stripe_payment_intent_id", intentId);

        if (error) {
          console.error(`[stripe-connect-webhook] charge.refunded: ${error.message}`);
        }
        break;
      }

      default:
        // Evento não tratado — responder 200 para a Stripe não reenviar
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-connect-webhook] Erro:", message);
    return new Response(`Erro interno: ${message}`, { status: 500 });
  }
});
