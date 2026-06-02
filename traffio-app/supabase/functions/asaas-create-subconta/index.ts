import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * asaas-create-subconta — Edge Function
 *
 * Cria uma subconta Asaas para uma clínica (tenant) durante o onboarding
 * ou quando o admin da clínica aciona a integração Asaas no painel.
 *
 * Fluxo:
 *   1. Recebe tenant_id no body
 *   2. Busca dados da clínica no banco
 *   3. Usa a ASAAS_MASTER_KEY (Traffio root account) para criar a subconta
 *   4. Persiste asaas_api_key + asaas_wallet_id + asaas_account_id em tenants
 *   5. Registra o webhook da subconta apontando para asaas-webhook
 *
 * Variáveis de ambiente necessárias:
 *   ASAAS_MASTER_KEY   — Chave da conta-raiz Traffio no Asaas ($aact_prod_...)
 *   ASAAS_ENV          — "production" | "sandbox" (default: production)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const ASAAS_BASE = {
  production: "https://api.asaas.com/v3",
  sandbox:    "https://api-sandbox.asaas.com/v3",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth guard ────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const masterKey          = Deno.env.get("ASAAS_MASTER_KEY") ?? "";
    const env                = (Deno.env.get("ASAAS_ENV") ?? "production") as "production" | "sandbox";
    const baseUrl            = ASAAS_BASE[env] ?? ASAAS_BASE.production;

    if (!masterKey) {
      console.error("[asaas-create-subconta] ASAAS_MASTER_KEY not configured.");
      return new Response("Gateway not configured", { status: 503 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Parse request ─────────────────────────────────────
    const { tenant_id } = await req.json();
    if (!tenant_id) {
      return new Response("tenant_id is required", { status: 400 });
    }

    // ── Validate caller has access to this tenant ─────────
    const userJwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await createClient(supabaseUrl, supabaseServiceKey)
      .auth.getUser(userJwt);

    if (userError || !user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { data: membership } = await supabase
      .from("members")
      .select("role")
      .eq("tenant_id", tenant_id)
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"])
      .maybeSingle();

    if (!membership) {
      return new Response("Forbidden: only tenant owners can configure the gateway", { status: 403 });
    }

    // ── Fetch tenant data ─────────────────────────────────
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, name, slug, asaas_account_id, asaas_api_key")
      .eq("id", tenant_id)
      .single();

    if (tenantError || !tenant) {
      return new Response("Tenant not found", { status: 404 });
    }

    // ── Idempotency: skip if already has a subconta ───────
    if (tenant.asaas_account_id && tenant.asaas_api_key) {
      return new Response(
        JSON.stringify({ status: "already_configured", account_id: tenant.asaas_account_id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Fetch owner profile for contact data ──────────────
    const { data: ownerMember } = await supabase
      .from("members")
      .select("user_id, profiles(full_name, email)")
      .eq("tenant_id", tenant_id)
      .eq("role", "owner")
      .maybeSingle();

    const ownerProfile = (ownerMember as any)?.profiles;

    // ── Create Asaas subconta ─────────────────────────────
    const subcontaPayload = {
      name:           tenant.name,
      email:          ownerProfile?.email ?? `contato@${tenant.slug}.com.br`,
      loginEmail:     ownerProfile?.email ?? `contato@${tenant.slug}.com.br`,
      cpfCnpj:        "",           // preenchido manualmente após onboarding se necessário
      mobilePhone:    "",
      address:        "A configurar",
      addressNumber:  "S/N",
      province:       "Centro",
      postalCode:     "01310-100",  // placeholder — atualizado depois
      webhooks: [
        {
          url:          `${supabaseUrl}/functions/v1/asaas-webhook`,
          email:        ownerProfile?.email ?? "",
          apiVersion:   "3",
          enabled:      true,
          interrupted:  false,
          authToken:    supabaseServiceKey.slice(0, 32),   // token de validação
          events: [
            "PAYMENT_RECEIVED",
            "PAYMENT_CONFIRMED",
            "PAYMENT_OVERDUE",
            "PAYMENT_REFUNDED",
          ],
        },
      ],
    };

    const asaasRes = await fetch(`${baseUrl}/accounts`, {
      method:  "POST",
      headers: {
        "access_token":  masterKey,
        "Content-Type":  "application/json",
        "User-Agent":    "Traffio-Med/1.0",
      },
      body: JSON.stringify(subcontaPayload),
    });

    const asaasData = await asaasRes.json();

    if (!asaasRes.ok) {
      const errMsg = asaasData?.errors?.[0]?.description ?? JSON.stringify(asaasData);
      console.error("[asaas-create-subconta] Asaas API error:", errMsg);
      return new Response(`Asaas error: ${errMsg}`, { status: 502 });
    }

    const { id: accountId, apiKey, walletId } = asaasData;

    if (!apiKey) {
      console.error("[asaas-create-subconta] Asaas returned no apiKey:", asaasData);
      return new Response("Asaas did not return an API key", { status: 502 });
    }

    // ── Persist credentials in tenant ────────────────────
    const { error: updateError } = await supabase
      .from("tenants")
      .update({
        asaas_account_id: accountId,
        asaas_api_key:    apiKey,
        asaas_wallet_id:  walletId ?? null,
        payment_config:   {
          enable_cc:        true,
          enable_financing: false,
          asaas_env:        env,
        },
      })
      .eq("id", tenant_id);

    if (updateError) {
      console.error("[asaas-create-subconta] Failed to persist Asaas credentials:", updateError);
      return new Response("Failed to persist credentials", { status: 500 });
    }

    console.log(`[asaas-create-subconta] Subconta created for tenant ${tenant_id}. Account: ${accountId}`);

    return new Response(
      JSON.stringify({
        status:     "created",
        account_id: accountId,
        wallet_id:  walletId,
        message:    "Subconta Asaas criada e credenciais salvas com sucesso.",
      }),
      {
        status:  201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (err: any) {
    console.error("[asaas-create-subconta] Unexpected error:", err.message);
    return new Response(err.message, { status: 500 });
  }
});
