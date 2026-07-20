/**
 * Edge Function: stripe-connect-onboard
 *
 * Gerencia a conexão Stripe Connect (contas Standard) do tenant,
 * usada para o tenant receber pagamentos de pacientes — distinta
 * do billing da plataforma (stripe_customer_id / assinatura).
 *
 * Recebe: { action: "start" | "sync" | "disconnect" }
 *         + Authorization: Bearer <jwt>
 *
 * Ações:
 *   start      → cria (ou reaproveita) a conta Connect e retorna a URL
 *                do Account Link para onboarding hospedado pela Stripe.
 *   sync       → consulta a conta na Stripe e atualiza os flags do
 *                tenant (charges_enabled / status). Chamada no retorno
 *                do onboarding e no botão "verificar status".
 *   disconnect → desvincula a conta do tenant (a conta Standard continua
 *                existindo na Stripe; apenas removemos o vínculo local).
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

type ConnectStatus = "not_connected" | "onboarding" | "active" | "disabled";

/** Deriva o status interno a partir do estado real da conta na Stripe. */
function deriveStatus(account: Stripe.Account): ConnectStatus {
  if (account.charges_enabled) return "active";
  // details_submitted sem charges_enabled = conta em revisão/restrita
  if (account.details_submitted) return "disabled";
  return "onboarding";
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

    // ── 2. Tenant do usuário (apenas owner/admin gerenciam a conexão) ────
    const { data: member } = await supabase
      .from("members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) return json({ error: "Tenant não encontrado" }, 403);
    if (!["owner", "admin"].includes(member.role)) {
      return json({ error: "Sem permissão para gerenciar pagamentos" }, 403);
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, country, stripe_account_id, stripe_connect_status")
      .eq("id", member.tenant_id)
      .single();

    if (!tenant) return json({ error: "Tenant não encontrado" }, 404);

    const body = await req.json().catch(() => ({}));
    const action = body.action as "start" | "sync" | "disconnect" | undefined;

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    // ── 3. start: criar conta (se preciso) + Account Link ────────────────
    if (action === "start") {
      let accountId = tenant.stripe_account_id as string | null;

      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "standard",
          email: user.email ?? undefined,
          metadata: { tenant_id: tenant.id },
        });
        accountId = account.id;

        await supabase
          .from("tenants")
          .update({ stripe_account_id: accountId, stripe_connect_status: "onboarding" })
          .eq("id", tenant.id);
      }

      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${appUrl}/dashboard/payments?stripe_connect=refresh`,
        return_url:  `${appUrl}/dashboard/payments?stripe_connect=return`,
        type: "account_onboarding",
      });

      return json({ url: link.url });
    }

    // ── 4. sync: atualizar flags a partir do estado real na Stripe ───────
    if (action === "sync") {
      if (!tenant.stripe_account_id) {
        return json({ status: "not_connected", charges_enabled: false });
      }

      const account = await stripe.accounts.retrieve(tenant.stripe_account_id);
      const status = deriveStatus(account);

      await supabase
        .from("tenants")
        .update({
          stripe_charges_enabled: account.charges_enabled ?? false,
          stripe_connect_status: status,
        })
        .eq("id", tenant.id);

      return json({
        status,
        charges_enabled: account.charges_enabled ?? false,
        details_submitted: account.details_submitted ?? false,
        default_currency: account.default_currency ?? null,
      });
    }

    // ── 5. disconnect: remover vínculo local ─────────────────────────────
    if (action === "disconnect") {
      await supabase
        .from("tenants")
        .update({
          stripe_account_id: null,
          stripe_charges_enabled: false,
          stripe_connect_status: "not_connected",
        })
        .eq("id", tenant.id);

      return json({ status: "not_connected" });
    }

    return json({ error: `Ação inválida: ${action}` }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-connect-onboard]", message);
    return json({ error: message }, 500);
  }
});
