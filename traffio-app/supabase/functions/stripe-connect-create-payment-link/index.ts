/**
 * Edge Function: stripe-connect-create-payment-link
 *
 * Gera um link de pagamento (Stripe Checkout) para o restante de um orçamento
 * aprovado, cobrado diretamente na conta Stripe Connect (Standard) do tenant —
 * Traffio nunca intermedia o dinheiro (Tech Provider direto, mesma arquitetura
 * já usada para o Meta Cloud API).
 *
 * Pré-requisito: tenants.stripe_account_id + stripe_charges_enabled = true
 * (mesmo gate de useStripeConnection().canSendPaymentLinks no client).
 *
 * Recebe: { proposal_id } + Authorization: Bearer <jwt>
 *
 * O consumidor do resultado já existe: stripe-connect-webhook trata
 * checkout.session.completed lendo session.metadata.billing_record_id —
 * esta function só precisa criar a sessão com essa metadata.
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   STRIPE_SECRET_KEY
 *   APP_URL
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

    // ── 1. Autenticar caller via JWT ─────────────────────────────────────
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "Não autenticado" }, 401);

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: jwtErr } = await supabase.auth.getUser(jwt);
    if (jwtErr || !user) return json({ error: "Token inválido" }, 401);

    const { proposal_id } = await req.json().catch(() => ({}));
    if (!proposal_id) return json({ error: "proposal_id é obrigatório" }, 400);

    // ── 2. Orçamento + tenant do caller (isolamento: só do próprio tenant) ──
    const { data: proposal } = await supabase
      .from("commercial_proposals")
      .select("id, tenant_id, patient_id, title, status, total_cents, currency")
      .eq("id", proposal_id)
      .maybeSingle();

    if (!proposal) return json({ error: "Orçamento não encontrado" }, 404);
    if (proposal.status !== "approved") {
      return json({ error: "Só orçamentos aprovados podem gerar link de pagamento" }, 400);
    }

    const { data: member } = await supabase
      .from("members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .eq("tenant_id", proposal.tenant_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) return json({ error: "Sem permissão para este orçamento" }, 403);

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, stripe_account_id, stripe_charges_enabled")
      .eq("id", proposal.tenant_id)
      .single();

    if (!tenant?.stripe_account_id || !tenant.stripe_charges_enabled) {
      return json({ error: "Stripe Connect não está ativo para este tenant" }, 400);
    }

    // ── 3. Restante a cobrar (mesma regra de ProposalService.getPaidTotal) ──
    const { data: paidRows } = await supabase
      .from("billing_records")
      .select("amount_cents")
      .eq("proposal_id", proposal.id)
      .eq("status", "paid");

    const paidCents = (paidRows || []).reduce((s: number, r: { amount_cents: number }) => s + r.amount_cents, 0);
    const remainingCents = proposal.total_cents - paidCents;

    if (remainingCents <= 0) {
      return json({ error: "Este orçamento já está quitado" }, 400);
    }

    // ── 4. billing_record pendente (o webhook já sabe marcar como paid) ─────
    const { data: record, error: recordErr } = await supabase
      .from("billing_records")
      .insert({
        tenant_id: proposal.tenant_id,
        patient_id: proposal.patient_id,
        proposal_id: proposal.id,
        amount_cents: remainingCents,
        currency: proposal.currency,
        due_date: new Date().toISOString().slice(0, 10),
        status: "pending",
      })
      .select()
      .single();

    if (recordErr || !record) {
      return json({ error: recordErr?.message || "Erro ao criar recebimento" }, 500);
    }

    // ── 5. Checkout Session direto na conta Connect do tenant (Standard) ────
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: (proposal.currency || "BRL").toLowerCase(),
            product_data: { name: proposal.title },
            unit_amount: remainingCents,
          },
          quantity: 1,
        }],
        metadata: { billing_record_id: record.id },
        success_url: `${appUrl}/?screen=orcamentos&payment=success`,
        cancel_url: `${appUrl}/?screen=orcamentos&payment=cancel`,
      },
      { stripeAccount: tenant.stripe_account_id },
    );

    await supabase
      .from("billing_records")
      .update({ stripe_checkout_session_id: session.id, payment_link_url: session.url })
      .eq("id", record.id);

    return json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-connect-create-payment-link]", message);
    return json({ error: message }, 500);
  }
});
