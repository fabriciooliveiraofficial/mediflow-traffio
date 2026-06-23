/**
 * refresh-exchange-rates — Edge Function (Cron, daily)
 *
 * Busca a cotação BRL -> USD/MXN/NZD na Frankfurter API (api.frankfurter.dev,
 * gratuita, sem cadastro/API key, base de bancos centrais) e atualiza a
 * tabela `exchange_rates` (1 linha por moeda-alvo, sempre sobrescrita — sem
 * histórico).
 *
 * Esta cotação é usada SOMENTE para exibição em dashboards/analytics
 * (ad spend, receita) — nunca para cobrança/billing, que continua sempre em
 * BRL. Ver src/hooks/useTenantCurrency.ts no frontend.
 *
 * Trigger: cron diário (ver supabase/migrations/20260623_exchange_rates.sql).
 * Também pode ser chamado manualmente via POST.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { logPlatform } from "../_shared/logger.ts";

const TARGET_CURRENCIES = ["USD", "MXN", "NZD"];
const SOURCE = "frankfurter.dev";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("[refresh-exchange-rates] Starting daily refresh");

  try {
    const symbols = TARGET_CURRENCIES.join(",");
    const url = `https://api.frankfurter.dev/v1/latest?base=BRL&symbols=${symbols}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`frankfurter.dev HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const rates = data?.rates;
    if (!rates || typeof rates !== "object") {
      throw new Error(`Unexpected response shape: ${JSON.stringify(data)}`);
    }

    const fetchedAt = new Date().toISOString();
    let updated = 0;
    const skipped: string[] = [];

    for (const currency of TARGET_CURRENCIES) {
      const rate = rates[currency];
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        skipped.push(currency);
        continue;
      }

      const { error } = await supabase
        .from("exchange_rates")
        .upsert({
          target_currency: currency,
          rate,
          fetched_at: fetchedAt,
          source: SOURCE,
        }, { onConflict: "target_currency" });

      if (error) {
        skipped.push(currency);
        console.error(`[refresh-exchange-rates] Failed to upsert ${currency}:`, error.message);
        continue;
      }
      updated++;
    }

    if (skipped.length > 0) {
      // Não falha o cron por uma moeda faltante/transiente — a linha antiga
      // (se existir) continua valendo até o próximo run; o frontend trata
      // qualquer linha com mais de 36h como ausente (fallback BRL-only).
      await logPlatform(supabase, {
        level: "warn",
        source: "refresh-exchange-rates",
        eventName: "partial_update",
        message: `Skipped currencies: ${skipped.join(", ")}`,
        metadata: { skipped, raw: rates },
      });
    }

    const result = { updated, skipped };
    console.log("[refresh-exchange-rates] Done:", result);
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[refresh-exchange-rates] Fatal:", err.message);
    await logPlatform(supabase, {
      level: "warn",
      source: "refresh-exchange-rates",
      eventName: "fetch_failed",
      message: err.message,
      metadata: { stack: err.stack },
    });
    // Retorna 200 propositalmente: uma falha transitória do provedor de FX
    // não deve disparar alerta/retry-storm de cron — a última cotação boa
    // (se existir) continua servindo até o próximo run.
    return new Response(JSON.stringify({ updated: 0, error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
