/**
 * telnyx-numbers — Edge Function
 *
 * API para comprar e gerenciar números de telefone Telnyx por tenant.
 *
 * GET  /telnyx-numbers?action=search&country=BR&limit=10
 * POST /telnyx-numbers  { action: "purchase", phone_number: "+5511..." }
 * POST /telnyx-numbers  { action: "release",  number_id: "..." }
 * POST /telnyx-numbers  { action: "update",   number_id: "...", friendly_name: "..." }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import {
  searchAvailableNumbers,
  purchaseNumber,
  releaseNumber,
} from "../_shared/telnyxClient.ts";
import { getTelnyxApiKey, getTelnyxConnectionId } from "../_shared/masterConfig.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Buscar tenant do usuário
    const { data: member } = await supabase
      .from("members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) return json({ error: "Tenant not found" }, 404);

    // Somente admin/owner pode gerenciar números
    if (!["owner", "admin"].includes(member.role)) {
      return json({ error: "Insufficient permissions" }, 403);
    }

    const tenantId = member.tenant_id;

    // Buscar API key do tenant ou usar a master
    const { data: tenant } = await supabase
      .from("tenants")
      .select("telnyx_api_key, telnyx_app_id")
      .eq("id", tenantId)
      .single();

    // Prioridade: tenant key → Supabase Secret → master_config (UI)
    const apiKey       = await getTelnyxApiKey(supabase, tenant?.telnyx_api_key);
    const connectionId = await getTelnyxConnectionId(supabase, tenant?.telnyx_app_id);

    if (!apiKey) return json({ error: "Telnyx not configured. Set TELNYX_API_KEY in /master/intelligence" }, 400);

    // ── GET: buscar números disponíveis ──────────────────────────────────────
    if (req.method === "GET") {
      const url     = new URL(req.url);
      const country = url.searchParams.get("country") ?? "BR";
      const limit   = parseInt(url.searchParams.get("limit") ?? "10");

      const numbers = await searchAvailableNumbers(apiKey, country, ["voice", "sms"], limit);
      return json({ data: numbers });
    }

    // ── POST: ações ──────────────────────────────────────────────────────────
    const body = await req.json();
    const { action } = body;

    if (action === "purchase") {
      const { phone_number, friendly_name } = body;
      if (!phone_number) return json({ error: "phone_number required" }, 400);

      // Comprar na Telnyx
      const result = await purchaseNumber(apiKey, phone_number, connectionId || undefined);

      // Salvar no banco
      const { data: saved, error: saveErr } = await supabase
        .from("tenant_phone_numbers")
        .insert({
          tenant_id:        tenantId,
          phone_number:     phone_number,
          telnyx_number_id: result.id,
          friendly_name:    friendly_name ?? null,
          country_code:     phone_number.startsWith("+1") ? "US" :
                            phone_number.startsWith("+55") ? "BR" :
                            phone_number.startsWith("+44") ? "GB" :
                            phone_number.startsWith("+52") ? "MX" : "OTHER",
          is_active:        true,
          capabilities:     { voice: true, sms: true },
        })
        .select()
        .single();

      if (saveErr) throw new Error(`DB save failed: ${saveErr.message}`);

      console.log(`[telnyx-numbers] ✓ Purchased ${phone_number} for tenant ${tenantId}`);
      return json({ data: saved });
    }

    if (action === "release") {
      const { number_id } = body;
      if (!number_id) return json({ error: "number_id required" }, 400);

      // FIX C2: tenant_id obrigatório para evitar que admin de outro tenant delete números alheios
      const { data: numRow } = await supabase
        .from("tenant_phone_numbers")
        .select("telnyx_number_id, phone_number")
        .eq("id", number_id)
        .eq("tenant_id", tenantId)   // ← isolamento multi-tenant
        .single();

      if (!numRow) return json({ error: "Number not found" }, 404);

      await releaseNumber(apiKey, numRow.telnyx_number_id);

      await supabase
        .from("tenant_phone_numbers")
        .update({ is_active: false, released_at: new Date().toISOString() })
        .eq("id", number_id);

      return json({ success: true });
    }

    if (action === "update") {
      const { number_id, friendly_name } = body;
      if (!number_id) return json({ error: "number_id required" }, 400);

      await supabase
        .from("tenant_phone_numbers")
        .update({ friendly_name, updated_at: new Date().toISOString() })
        .eq("id", number_id)
        .eq("tenant_id", tenantId);

      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err: any) {
    console.error("[telnyx-numbers] Error:", err.message);
    return json({ error: err.message }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
