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
import { getTelnyxApiKey, getTelnyxConnectionId } from "../_shared/masterConfig.ts";
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
    const balanceRes = await fetch("https://api.telnyx.com/v2/balance", {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!balanceRes.ok) {
      const errorText = await balanceRes.text();
      throw new Error(`Telnyx API Error: ${balanceRes.status} - ${errorText}`);
    }

    const balanceData = await balanceRes.json();
    const balance = balanceData.data;

    // Buscar Connection ID
    const connectionId = await getTelnyxConnectionId(supabase);
    let connection = null;
    let outboundProfile = null;

    if (connectionId) {
      try {
        const connRes = await fetch(`https://api.telnyx.com/v2/connections/${connectionId}`, {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          }
        });
        if (connRes.ok) {
          const connData = await connRes.json();
          connection = {
            id: connData.data.id,
            connection_name: connData.data.connection_name,
            active: connData.data.active,
            webhook_event_url: connData.data.webhook_event_url,
          };

          const profileId = connData.data.outbound_voice_profile_id;
          if (profileId) {
            const profRes = await fetch(`https://api.telnyx.com/v2/outbound_voice_profiles/${profileId}`, {
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
              }
            });
            if (profRes.ok) {
              const profData = await profRes.json();
              outboundProfile = {
                id: profData.data.id,
                name: profData.data.name,
                whitelisted_destinations: profData.data.whitelisted_destinations,
              };
            }
          }
        }
      } catch (err: any) {
        console.error("Error fetching Telnyx connection/profile details:", err.message);
      }
    }

    return json({
      balance,
      connection,
      outbound_profile: outboundProfile
    });

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
