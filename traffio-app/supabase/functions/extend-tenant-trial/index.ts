/**
 * Edge Function: extend-tenant-trial
 *
 * Estende o período de teste (trial) de UM tenant, de forma segura e
 * coerente entre o app e o Stripe. Apenas super_admin pode executar.
 *
 * Recebe: { tenant_id, days, reason? } + Authorization: Bearer <jwt>
 *
 * Fluxo (ordem importa p/ não cobrar cliente em trial estendido):
 *   1. Autentica o JWT e exige role super_admin.
 *   2. Carrega o tenant (fim atual do trial + assinatura Stripe).
 *   3. Calcula o novo fim = max(agora, fim_atual) + days.
 *   4. Se houver assinatura Stripe em 'trialing', empurra o trial_end no
 *      Stripe ANTES de persistir no banco. Se o Stripe falhar, aborta sem
 *      mexer no banco (mantém consistência: nada é estendido).
 *   5. Persiste a extensão via RPC SECURITY DEFINER extend_tenant_trial
 *      (recalcula com lock + grava auditoria em trial_extensions).
 *
 * Variáveis de ambiente (Supabase Secrets):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
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
      return json({ error: "Apenas super_admin pode estender o teste" }, 403);
    }

    // ── 3. Validar body ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const tenantId: string = body.tenant_id;
    const days = Number(body.days);
    const reason: string | null = body.reason ?? null;

    if (!tenantId) return json({ error: "tenant_id obrigatório" }, 400);
    if (!Number.isInteger(days) || days <= 0) {
      return json({ error: "days deve ser um inteiro positivo" }, 400);
    }

    // ── 4. Carregar tenant ────────────────────────────────────────────────────
    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .select("id, subscription_status, trial_ends_at, subscription_external_id")
      .eq("id", tenantId)
      .single();

    if (tenantErr || !tenant) return json({ error: "Tenant não encontrado" }, 404);

    // Novo fim do trial = max(agora, fim_atual) + days
    const now = Date.now();
    const currentEnd = tenant.trial_ends_at ? new Date(tenant.trial_ends_at).getTime() : now;
    const newEndMs = Math.max(now, currentEnd) + days * 86_400_000;

    // ── 5. Sincronizar Stripe ANTES de persistir ──────────────────────────────
    // Só faz sentido para assinaturas em 'trialing'. Assinatura já ativa
    // (cliente pagante) não é tocada; tenant sem assinatura também não.
    let stripeSynced = false;
    if (stripeKey && tenant.subscription_external_id) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
        const sub = await stripe.subscriptions.retrieve(tenant.subscription_external_id);
        if (sub.status === "trialing") {
          await stripe.subscriptions.update(tenant.subscription_external_id, {
            trial_end: Math.floor(newEndMs / 1000),
            proration_behavior: "none",
          });
          stripeSynced = true;
        }
      } catch (stripeErr: any) {
        console.error("[extend-tenant-trial] stripe sync failed:", stripeErr.message);
        // Aborta sem mexer no banco → nada é estendido, estado permanece coerente.
        return json({
          error: `Falha ao sincronizar a assinatura no Stripe: ${stripeErr.message}. ` +
                 `Nenhuma alteração foi aplicada.`,
        }, 502);
      }
    }

    // ── 6. Persistir extensão + auditoria via RPC (contexto do super_admin) ───
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: updatedTenant, error: rpcErr } = await userClient.rpc("extend_tenant_trial", {
      p_tenant_id: tenantId,
      p_days: days,
      p_reason: reason,
    });

    if (rpcErr) {
      console.error("[extend-tenant-trial] rpc failed:", rpcErr.message);
      const status = rpcErr.code === "42501" ? 403 : 400;
      return json({ error: rpcErr.message, stripe_synced: stripeSynced }, status);
    }

    console.log(
      `[extend-tenant-trial] tenant=${tenantId} +${days}d ` +
      `by=${user.id} stripe_synced=${stripeSynced}`,
    );

    return json({ tenant: updatedTenant, stripe_synced: stripeSynced });

  } catch (err: any) {
    console.error("[extend-tenant-trial] error:", err.message);
    return json({ error: err.message ?? "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
