/**
 * Edge Function: stripe-create-portal
 *
 * Recebe: { return_url? } + Authorization: Bearer <jwt>
 *
 * Cria uma sessão do Stripe Billing Portal para o tenant do usuário.
 * No portal o cliente pode: atualizar cartão, ver faturas e CANCELAR
 * a assinatura (botão "Gerenciar Faturamento" da página Assinatura).
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   STRIPE_SECRET_KEY, APP_URL
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

    // ── 2. Tenant do usuário (owner/admin only) ───────────────────────────────
    const { data: member } = await supabase
      .from("members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) return json({ error: "Tenant não encontrado" }, 403);
    if (!["owner", "admin"].includes(member.role)) {
      return json({ error: "Sem permissão para gerenciar o faturamento" }, 403);
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, stripe_customer_id")
      .eq("id", member.tenant_id)
      .single();

    if (!tenant?.stripe_customer_id) {
      return json({ error: "Nenhuma assinatura encontrada para esta conta" }, 404);
    }

    // ── 3. Criar sessão do Billing Portal ─────────────────────────────────────
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    const body = await req.json().catch(() => ({}));
    const returnUrl = body.return_url ?? `${appUrl}/dashboard`;

    const session = await stripe.billingPortal.sessions.create({
      customer:   tenant.stripe_customer_id,
      return_url: returnUrl,
      locale:     "pt-BR",
    });

    return json({ url: session.url });

  } catch (err: any) {
    console.error("[stripe-create-portal] error:", err.message);
    return json({ error: err.message ?? "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
