/**
 * telnyx-agent-credentials — Edge Function
 *
 * Gerencia credenciais SIP (WebRTC) por agente/membro do tenant.
 * Cada agente precisa de uma credencial SIP para conectar o softphone no browser.
 *
 * POST /telnyx-agent-credentials { action: "create" }
 *   → Cria credencial SIP na Telnyx + salva em agent_telnyx_credentials
 *
 * GET  /telnyx-agent-credentials
 *   → Retorna login_token temporário (válido 1h) para o WebRTC SDK
 *
 * POST /telnyx-agent-credentials { action: "revoke", credential_id: "..." }
 *   → Remove credencial e revoga acesso
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import {
  createSipCredential,
  getLoginToken,
  revokeSipCredential,
} from "../_shared/telnyxClient.ts";
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

    const { data: member } = await supabase
      .from("members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) return json({ error: "Member not found" }, 404);

    const tenantId = member.tenant_id;

    const { data: tenant } = await supabase
      .from("tenants")
      .select("telnyx_api_key, telnyx_app_id, telnyx_enabled")
      .eq("id", tenantId)
      .single();

    // Prioridade: tenant key → Supabase Secret → master_config (UI)
    const apiKey       = await getTelnyxApiKey(supabase, tenant?.telnyx_api_key);
    const connectionId = await getTelnyxConnectionId(supabase, tenant?.telnyx_app_id);

    if (!apiKey) {
      const errMsg = "Telnyx not configured. Set TELNYX_API_KEY in /master/intelligence";
      await logPlatform(supabase, {
        tenantId,
        level: "warn",
        source: "telnyx-agent-credentials",
        eventName: "config_missing",
        message: errMsg,
        metadata: { tenantId }
      });
      return json({ error: errMsg }, 400);
    }

    // ── GET: Retornar login_token para WebRTC SDK ────────────────────────────
    if (req.method === "GET") {
      const { data: cred } = await supabase
        .from("agent_telnyx_credentials")
        .select("id, telnyx_credential_id, telnyx_sip_username")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (!cred) {
        return json({ error: "No credential found. Call POST with action=create first." }, 404);
      }

      // Gerar token temporário (expira em 1h)
      const loginToken = await getLoginToken(apiKey, cred.telnyx_credential_id);

      // Atualizar last_registered_at
      await supabase
        .from("agent_telnyx_credentials")
        .update({ last_registered_at: new Date().toISOString() })
        .eq("id", cred.id);

      await logPlatform(supabase, {
        tenantId,
        level: "info",
        source: "telnyx-agent-credentials",
        eventName: "token_retrieved",
        message: `Successfully retrieved login token for SIP username ${cred.telnyx_sip_username}`,
        metadata: { sipUsername: cred.telnyx_sip_username }
      });

      return json({
        loginToken,
        sipUsername: cred.telnyx_sip_username,
        expiresIn:   3600,
      });
    }

    // ── POST: Ações ──────────────────────────────────────────────────────────
    const body   = await req.json();
    const action = body.action;

    if (action === "create") {
      // Verificar se já existe credencial ativa
      const { data: existing } = await supabase
        .from("agent_telnyx_credentials")
        .select("id, telnyx_credential_id, telnyx_sip_username")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (existing) {
        // Já existe — retornar token direto
        const loginToken = await getLoginToken(apiKey, existing.telnyx_credential_id);
        
        await logPlatform(supabase, {
          tenantId,
          level: "info",
          source: "telnyx-agent-credentials",
          eventName: "token_retrieved_existing",
          message: `Successfully retrieved login token for existing SIP username ${existing.telnyx_sip_username}`,
          metadata: { sipUsername: existing.telnyx_sip_username }
        });

        return json({ loginToken, sipUsername: existing.telnyx_sip_username, expiresIn: 3600, created: false });
      }

      // Criar nova credencial SIP na Telnyx
      const credName = `Traffio-${tenantId.slice(0, 8)}-${user.id.slice(0, 8)}`;
      const sip      = await createSipCredential(apiKey, credName, connectionId);

      // Salvar no banco
      await supabase.from("agent_telnyx_credentials").insert({
        tenant_id:            tenantId,
        user_id:              user.id,
        telnyx_credential_id: sip.id,
        telnyx_sip_username:  sip.sipUsername,
        telnyx_sip_password:  sip.sipPassword,
        is_active:            true,
        last_registered_at:   new Date().toISOString(),
      });

      // Gerar token inicial
      const loginToken = await getLoginToken(apiKey, sip.id);

      await logPlatform(supabase, {
        tenantId,
        level: "info",
        source: "telnyx-agent-credentials",
        eventName: "credential_created",
        message: `Successfully created SIP credential for user ${user.id} (${sip.sipUsername})`,
        metadata: { credentialId: sip.id }
      });

      console.log(`[telnyx-agent-credentials] ✓ Created credential for user ${user.id}`);
      return json({ loginToken, sipUsername: sip.sipUsername, expiresIn: 3600, created: true });
    }

    if (action === "revoke") {
      const { credential_id } = body;

      const { data: cred } = await supabase
        .from("agent_telnyx_credentials")
        .select("telnyx_credential_id")
        .eq("id", credential_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!cred) return json({ error: "Credential not found" }, 404);

      await revokeSipCredential(apiKey, cred.telnyx_credential_id);
      await supabase
        .from("agent_telnyx_credentials")
        .update({ is_active: false })
        .eq("id", credential_id);

      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err: any) {
    console.error("[telnyx-agent-credentials] Error:", err.message);
    await logPlatform(supabase, {
      level: "fatal",
      source: "telnyx-agent-credentials",
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
