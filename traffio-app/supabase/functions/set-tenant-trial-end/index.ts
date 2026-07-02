/**
 * Edge Function: set-tenant-trial-end
 *
 * Define a data final do trial de UM tenant diretamente (pode estender OU
 * encurtar), de forma segura e coerente entre o app e o Stripe. Apenas
 * super_admin pode executar. Complementa extend-tenant-trial (que só soma
 * dias) para o caso de precisar de uma data exata — inclusive no passado,
 * pra forçar o fim do trial e exigir pagamento imediatamente.
 *
 * Recebe: { tenant_id, end_date (ISO date/datetime), reason? } + Authorization: Bearer <jwt>
 *
 * Fluxo (ordem importa p/ manter app e Stripe coerentes):
 *   1. Autentica o JWT e exige role super_admin.
 *   2. Carrega o tenant (fim atual do trial + assinatura Stripe).
 *   3. Se houver assinatura Stripe não-terminal (não 'active'/'canceled'/
 *      'incomplete_expired'), sincroniza o trial_end no Stripe ANTES de
 *      persistir. Stripe só aceita trial_end no futuro ou o literal "now"
 *      (não aceita timestamp no passado) — se end_date já passou, usamos
 *      "now" pra encerrar o trial imediatamente no Stripe.
 *   4. Persiste via RPC SECURITY DEFINER set_tenant_trial_end (recalcula
 *      com lock + grava auditoria em trial_extensions).
 *
 * Variáveis de ambiente (Supabase Secrets):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

const NON_REVIVABLE_STATUSES = new Set(["active", "canceled", "incomplete_expired"]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const stripeKey   = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

    // ── 1. Autenticar caller via JWT ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Não autenticado" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: jwtErr } = await admin.auth.getUser(jwt);
    if (jwtErr || !user) return json({ error: "Token inválido" }, 401);

    // ── 2. Exigir super_admin ─────────────────────────────────────────────────
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || profile.role !== "super_admin") {
      return json({ error: "Apenas super_admin pode definir a data final do teste" }, 403);
    }

    // ── 3. Validar body ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const tenantId: string = body.tenant_id;
    const endDateRaw: string = body.end_date;
    const reason: string | null = body.reason ?? null;

    if (!tenantId) return json({ error: "tenant_id obrigatório" }, 400);
    if (!endDateRaw) return json({ error: "end_date obrigatório" }, 400);

    const newEndMs = new Date(endDateRaw).getTime();
    if (Number.isNaN(newEndMs)) return json({ error: "end_date inválido" }, 400);

    // ── 4. Carregar tenant ────────────────────────────────────────────────────
    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .select("id, subscription_status, trial_ends_at, subscription_external_id")
      .eq("id", tenantId)
      .single();

    if (tenantErr || !tenant) return json({ error: "Tenant não encontrado" }, 404);

    // ── 5. Sincronizar Stripe ANTES de persistir ──────────────────────────────
    let stripeSynced = false;
    if (stripeKey && tenant.subscription_external_id) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
        const sub = await stripe.subscriptions.retrieve(tenant.subscription_external_id);
        if (!NON_REVIVABLE_STATUSES.has(sub.status)) {
          const now = Date.now();
          await stripe.subscriptions.update(tenant.subscription_external_id, {
            trial_end: newEndMs > now ? Math.floor(newEndMs / 1000) : "now",
            proration_behavior: "none",
          });
          stripeSynced = true;
        }
      } catch (stripeErr: any) {
        console.error("[set-tenant-trial-end] stripe sync failed:", stripeErr.message);
        return json({
          error: `Falha ao sincronizar a assinatura no Stripe: ${stripeErr.message}. ` +
                 `Nenhuma alteração foi aplicada.`,
        }, 502);
      }
    }

    // ── 6. Persistir + auditoria via RPC (contexto do super_admin) ────────────
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: updatedTenant, error: rpcErr } = await userClient.rpc("set_tenant_trial_end", {
      p_tenant_id: tenantId,
      p_new_end: new Date(newEndMs).toISOString(),
      p_reason: reason,
    });

    if (rpcErr) {
      console.error("[set-tenant-trial-end] rpc failed:", rpcErr.message);
      const status = rpcErr.code === "42501" ? 403 : 400;
      return json({ error: rpcErr.message, stripe_synced: stripeSynced }, status);
    }

    console.log(
      `[set-tenant-trial-end] tenant=${tenantId} new_end=${new Date(newEndMs).toISOString()} ` +
      `by=${user.id} stripe_synced=${stripeSynced}`,
    );

    return json({ tenant: updatedTenant, stripe_synced: stripeSynced });

  } catch (err: any) {
    console.error("[set-tenant-trial-end] error:", err.message);
    return json({ error: err.message ?? "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
