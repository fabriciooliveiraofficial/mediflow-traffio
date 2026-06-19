/**
 * telnyx-balance — Edge Function
 *
 * API para consultar o saldo da conta master da Telnyx.
 * Apenas acessível por usuários com perfil 'super_admin'.
 *
 * GET /telnyx-balance
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getTelnyxApiKey } from "../_shared/masterConfig.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { logPlatform } from "../_shared/logger.ts";

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

    // Buscar profile do usuário para validar role de super_admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || profile.role !== "super_admin") {
      return json({ error: "Insufficient permissions. Requires super_admin." }, 403);
    }

    // Buscar API key master da Telnyx
    const apiKey = await getTelnyxApiKey(supabase);

    if (!apiKey) {
      const errMsg = "Telnyx master API key not configured.";
      await logPlatform(supabase, {
        level: "warn",
        source: "telnyx-balance",
        eventName: "config_missing",
        message: errMsg
      });
      return json({ error: errMsg }, 400);
    }

    // Consultar saldo na Telnyx
    const telnyxRes = await fetch("https://api.telnyx.com/v2/balance", {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!telnyxRes.ok) {
      const errorText = await telnyxRes.text();
      throw new Error(`Telnyx API Error: ${telnyxRes.status} - ${errorText}`);
    }

    const telnyxData = await telnyxRes.json();

    return json(telnyxData.data);

  } catch (err: any) {
    console.error("[telnyx-balance] Error:", err.message);
    await logPlatform(supabase, {
      level: "fatal",
      source: "telnyx-balance",
      eventName: "fatal_error",
      message: err.message,
      metadata: { stack: err.stack }
    });
    return json({ error: err.message }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
