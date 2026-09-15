/**
 * Edge Function: stripe-sync-catalog (master admin)
 *
 * Cria/atualiza no Stripe os Products e Prices dos planos (mensal e anual) e
 * do número WhatsApp adicional, A PARTIR da tabela `plans` (fonte única de
 * verdade), e grava os Price IDs em master_config:
 *   STRIPE_PRICE_<PLANO>_MONTHLY / _ANNUAL   (ex.: STRIPE_PRICE_CLINICA_ANNUAL)
 *   STRIPE_PRICE_EXTRA_WHATSAPP_NUMBER
 * Os checkouts leem master_config antes do secret (ver _shared/stripeCatalog.ts),
 * então um reajuste de preço = editar `plans` + clicar "Sincronizar" no master.
 *
 * Idempotente: se o Price já gravado tem o mesmo valor/moeda/intervalo, é
 * mantido. Prices antigos NÃO são desativados — assinaturas existentes seguem
 * no valor contratado até o cliente trocar de plano/ciclo.
 *
 * Recebe: {} + Authorization: Bearer <jwt de master admin>
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";
import { EXTRA_NUMBER_PRICE_KEY } from "../_shared/stripeCatalog.ts";

type Cycle = "MONTHLY" | "ANNUAL";

interface SyncResult { key: string; price_id: string; amount_brl: number; action: "kept" | "created"; }

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const stripeKey   = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!stripeKey) return json({ error: "Stripe não configurado" }, 500);

    // ── 1. Só master admin (is_master_admin() usa o auth.uid() do JWT) ────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: isMaster, error: masterErr } = await userClient.rpc("is_master_admin");
    if (masterErr || !isMaster) return json({ error: "Apenas master admin" }, 403);

    const supabase = createClient(supabaseUrl, serviceKey);
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    const { data: config } = await supabase.from("master_config").select("key, value");
    const cfg: Record<string, string> = {};
    for (const row of config ?? []) cfg[row.key] = (row.value ?? "").trim();

    async function saveKey(key: string, value: string, description: string) {
      cfg[key] = value;
      const { error } = await supabase.from("master_config").upsert(
        { key, value, description, is_secret: false, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
      if (error) throw new Error(`master_config ${key}: ${error.message}`);
    }

    async function ensureProduct(key: string, name: string, metadata: Record<string, string>): Promise<string> {
      const existing = cfg[key];
      if (existing) {
        try {
          const p = await stripe.products.retrieve(existing);
          if (p && !p.deleted) return p.id;
        } catch { /* recria abaixo */ }
      }
      const product = await stripe.products.create({ name, metadata });
      await saveKey(key, product.id, `Stripe Product — ${name} (gerado por stripe-sync-catalog)`);
      return product.id;
    }

    async function ensurePrice(
      key: string, productId: string, amountBrl: number, interval: "month" | "year", nickname: string,
    ): Promise<SyncResult> {
      const unitAmount = Math.round(amountBrl * 100);
      const existing = cfg[key];
      if (existing) {
        try {
          const p = await stripe.prices.retrieve(existing);
          if (p.active && p.currency === "brl" && p.unit_amount === unitAmount && p.recurring?.interval === interval) {
            return { key, price_id: p.id, amount_brl: amountBrl, action: "kept" };
          }
        } catch { /* cria abaixo */ }
      }
      const price = await stripe.prices.create({
        product: productId,
        currency: "brl",
        unit_amount: unitAmount,
        recurring: { interval },
        nickname,
        metadata: { config_key: key },
      });
      await saveKey(key, price.id, `Stripe Price — ${nickname} (gerado por stripe-sync-catalog)`);
      return { key, price_id: price.id, amount_brl: amountBrl, action: "created" };
    }

    // ── 2. Planos ─────────────────────────────────────────────────────────────
    const { data: plans, error: plansErr } = await supabase
      .from("plans")
      .select("id, name, monthly_price, annual_monthly_price, extra_whatsapp_number_price, is_active")
      .eq("is_active", true)
      .order("sort_order");
    if (plansErr) throw plansErr;

    const results: SyncResult[] = [];
    let extraNumberPrice = 0;
    for (const plan of plans ?? []) {
      const planKey = String(plan.id).toUpperCase();
      const productId = await ensureProduct(`STRIPE_PRODUCT_${planKey}`, `Traffio — Plano ${plan.name}`, { plan_id: plan.id });
      const cycles: Array<[Cycle, number, "month" | "year"]> = [
        ["MONTHLY", Number(plan.monthly_price), "month"],
        // Anual é cobrado de uma vez: 12 × preço mensal do ciclo anual
        ["ANNUAL", Number(plan.annual_monthly_price) * 12, "year"],
      ];
      for (const [cycle, amount, interval] of cycles) {
        results.push(await ensurePrice(
          `STRIPE_PRICE_${planKey}_${cycle}`, productId, amount, interval,
          `Plano ${plan.name} — ${cycle === "MONTHLY" ? "mensal" : "anual"}`,
        ));
      }
      extraNumberPrice = Math.max(extraNumberPrice, Number(plan.extra_whatsapp_number_price ?? 0));
    }

    // ── 3. Número WhatsApp adicional (item de assinatura, quantidade N) ──────
    if (extraNumberPrice > 0) {
      const productId = await ensureProduct("STRIPE_PRODUCT_EXTRA_WHATSAPP_NUMBER", "Traffio — Número WhatsApp adicional", { addon: "extra_whatsapp_number" });
      results.push(await ensurePrice(EXTRA_NUMBER_PRICE_KEY, productId, extraNumberPrice, "month", "Número WhatsApp adicional — mensal"));
    }

    console.log(`[stripe-sync-catalog] ${results.filter(r => r.action === "created").length} price(s) criado(s), ${results.filter(r => r.action === "kept").length} mantido(s)`);
    return json({ ok: true, results });

  } catch (err: any) {
    console.error("[stripe-sync-catalog] error:", err.message);
    return json({ error: err.message ?? "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
