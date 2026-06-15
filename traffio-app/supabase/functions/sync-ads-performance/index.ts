import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

// Lê credencial: Supabase Secret → master_config (UI /master/intelligence)
async function getGoogleCred(supabase: any, key: string): Promise<string> {
  const fromEnv = Deno.env.get(key);
  if (fromEnv) return fromEnv;
  try {
    const { data } = await supabase.from("master_config").select("value").eq("key", key).maybeSingle();
    return data?.value ?? "";
  } catch { return ""; }
}

// Action types reportados pela Meta Graph API que tratamos como "leads/conversões"
const META_LEAD_ACTION_TYPES = [
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const metaClientId = Deno.env.get("META_CLIENT_ID") ?? Deno.env.get("FACEBOOK_APP_ID") ?? "INSERIR_APP_ID_AQUI";
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "INSERIR_CLIENT_ID_AQUI";

  const isMetaPlaceholder = metaClientId === "INSERIR_APP_ID_AQUI";
  const isGooglePlaceholder = googleClientId === "INSERIR_CLIENT_ID_AQUI";

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Fetch active integrations
    const { data: integrations, error: fetchError } = await supabaseAdmin
      .from("ad_integrations")
      .select("*")
      .eq("status", "active");

    if (fetchError) {
      console.error("Error fetching integrations:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    console.log(`Found ${integrations?.length ?? 0} active integrations.`);

    // 2. Loop and sync each platform
    for (const integration of integrations || []) {
      const { tenant_id, platform, access_token, refresh_token, settings } = integration;

      // Case A: Meta Ads
      if (platform === "meta") {
        if (isMetaPlaceholder) {
          console.warn(`Meta App ID is placeholder. Generating demo data for tenant: ${tenant_id}`);
          await generateDemoData(supabaseAdmin, tenant_id, "meta");
          continue;
        }

        const adAccountId = settings?.ad_account_id;
        if (!adAccountId) {
          console.warn(`Tenant ${tenant_id} has no Meta ad_account_id configured. Skipping sync.`);
          await updateIntegrationSettings(supabaseAdmin, tenant_id, "meta", settings, {
            last_sync_error: "Conta de anúncios do Meta não configurada.",
            last_sync_at: new Date().toISOString(),
          });
          continue;
        }

        try {
          const insightsUrl = `https://graph.facebook.com/v19.0/${adAccountId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,actions&time_increment=1&date_preset=last_30d&access_token=${access_token}`;

          const response = await fetch(insightsUrl);
          const resJson = await response.json();

          if (resJson.error) {
            console.error(`Meta API Error for tenant ${tenant_id}:`, resJson.error);
            await updateIntegrationSettings(supabaseAdmin, tenant_id, "meta", settings, {
              last_sync_error: `Erro na API do Meta: ${resJson.error.message}`,
              last_sync_at: new Date().toISOString(),
            });
            continue;
          }

          // Process and upsert insights data — uma linha por campanha/dia
          const insights = resJson.data || [];
          for (const row of insights) {
            const date = row.date_start;
            const spend = Math.round(parseFloat(row.spend || "0") * 100); // dollars to cents
            const impressions = parseInt(row.impressions || "0");
            const clicks = parseInt(row.clicks || "0");
            const conversions = Math.round(sumMetaActions(row.actions, META_LEAD_ACTION_TYPES));

            // Estimate R$ 150,00 (15000 cents) por lead/conversão para atribuição de receita
            const revCents = conversions * 15000;

            await supabaseAdmin
              .from("ad_performance_daily")
              .upsert({
                tenant_id,
                platform: "meta",
                date,
                ad_account_id: adAccountId,
                campaign_id: row.campaign_id,
                campaign_name: row.campaign_name,
                spend_cents: spend,
                revenue_cents: revCents,
                leads_count: conversions,
                conversion_count: conversions,
                impressions,
                clicks,
              }, { onConflict: "tenant_id,platform,date,campaign_id" });
          }

          await updateIntegrationSettings(supabaseAdmin, tenant_id, "meta", settings, {
            last_sync_error: null,
            last_sync_at: new Date().toISOString(),
          });
        } catch (apiErr: any) {
          console.error(`Meta Sync failed for tenant ${tenant_id}:`, apiErr);
          await updateIntegrationSettings(supabaseAdmin, tenant_id, "meta", settings, {
            last_sync_error: `Falha no sync: ${apiErr.message}`,
            last_sync_at: new Date().toISOString(),
          });
        }
      }

      // Case B: Google Ads
      if (platform === "google") {
        if (isGooglePlaceholder) {
          console.warn(`Google Client ID is placeholder. Generating demo data for tenant: ${tenant_id}`);
          await generateDemoData(supabaseAdmin, tenant_id, "google");
          continue;
        }

        const customerId = settings?.customer_id;
        let developerToken = settings?.developer_token;
        if (!developerToken) {
          developerToken = await getGoogleCred(supabaseAdmin, "GOOGLE_DEVELOPER_TOKEN");
        }

        if (!customerId || !developerToken) {
          console.error(`[sync-ads] Tenant ${tenant_id} missing Google configuration. customerId: ${!!customerId}, developerToken: ${!!developerToken}`);
          await updateIntegrationSettings(supabaseAdmin, tenant_id, "google", settings, {
            last_sync_error: `Customer ID (${!!customerId ? 'OK' : 'Faltando'}) ou Developer Token (${!!developerToken ? 'OK' : 'Faltando'}) não configurados.`,
            last_sync_at: new Date().toISOString(),
          });
          continue;
        }

        try {
          // Exchange refresh_token for access_token
          const googleClientId = await getGoogleCred(supabaseAdmin, "GOOGLE_CLIENT_ID");
          const googleClientSecret = await getGoogleCred(supabaseAdmin, "GOOGLE_CLIENT_SECRET");

          if (!googleClientId || !googleClientSecret) {
            console.error(`[sync-ads] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not found for tenant ${tenant_id}`);
            await updateIntegrationSettings(supabaseAdmin, tenant_id, "google", settings, {
              last_sync_error: "Credenciais Google (Client ID/Secret) não configuradas no sistema.",
              last_sync_at: new Date().toISOString(),
            });
            continue;
          }

          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: googleClientId,
              client_secret: googleClientSecret,
              refresh_token: refresh_token || "",
              grant_type: "refresh_token",
            }),
          });
          const tokenData = await tokenRes.json();

          if (tokenData.error) {
            console.error(`Google Token Refresh Error for tenant ${tenant_id}:`, tokenData.error);
            await updateIntegrationSettings(supabaseAdmin, tenant_id, "google", settings, {
              last_sync_error: `Erro ao renovar token do Google: ${tokenData.error_description || tokenData.error}`,
              last_sync_at: new Date().toISOString(),
            });
            continue;
          }

          const freshAccessToken = tokenData.access_token;

          if (!freshAccessToken) {
            console.error(`[sync-ads] Token refresh returned no access_token for tenant ${tenant_id}. Keys:`, Object.keys(tokenData));
            await updateIntegrationSettings(supabaseAdmin, tenant_id, "google", settings, {
              last_sync_error: "Token de acesso não recebido ao renovar credenciais do Google.",
              last_sync_at: new Date().toISOString(),
            });
            continue;
          }

          console.log(`[sync-ads] Token refreshed for tenant ${tenant_id}. access_token length: ${freshAccessToken.length}`);

          // Query Google Ads API — uma linha por campanha/dia
          const googleQuery = `
            SELECT campaign.id, campaign.name, segments.date,
                   metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
            FROM campaign
            WHERE segments.date DURING LAST_30_DAYS
          `;

          const adsRes = await fetch(`https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${freshAccessToken}`,
              "Content-Type": "application/json",
              "developer-token": developerToken,
            },
            body: JSON.stringify({ query: googleQuery }),
          });

          let adsData: any = {};
          const contentType = adsRes.headers.get("content-type") || "";
          if (adsRes.ok && contentType.includes("application/json")) {
            adsData = await adsRes.json();
          } else {
            const textError = await adsRes.text();
            console.error(`Non-OK or non-JSON response from Google Ads search API for tenant ${tenant_id}:`, adsRes.status, textError);
            try {
              const parsedErr = JSON.parse(textError);
              adsData = { error: parsedErr.error || parsedErr };
            } catch {
              adsData = { error: { message: `HTTP ${adsRes.status}: ${textError.substring(0, 200)}` } };
            }
          }

          if (adsData.error) {
            console.error(`Google Ads API error for tenant ${tenant_id}:`, adsData.error);
            await updateIntegrationSettings(supabaseAdmin, tenant_id, "google", settings, {
              last_sync_error: `Erro na API do Google Ads: ${adsData.error.message || JSON.stringify(adsData.error)}`,
              last_sync_at: new Date().toISOString(),
            });
            continue;
          }

          const rows = adsData.results || [];
          for (const row of rows) {
            const date = row.segments?.date;
            if (!date) continue;

            const costMicros = parseInt(row.metrics?.costMicros || "0");
            const spendCents = Math.round(costMicros / 10000); // micros to cents
            const impressions = parseInt(row.metrics?.impressions || "0");
            const clicks = parseInt(row.metrics?.clicks || "0");
            const conversions = Math.round(parseFloat(row.metrics?.conversions || "0"));

            // Estimate R$ 180,00 por conversão para atribuição de receita
            const revCents = conversions * 18000;

            await supabaseAdmin
              .from("ad_performance_daily")
              .upsert({
                tenant_id,
                platform: "google",
                date,
                ad_account_id: customerId,
                campaign_id: row.campaign?.id != null ? String(row.campaign.id) : null,
                campaign_name: row.campaign?.name ?? null,
                spend_cents: spendCents,
                revenue_cents: revCents,
                leads_count: conversions,
                conversion_count: conversions,
                impressions,
                clicks,
              }, { onConflict: "tenant_id,platform,date,campaign_id" });
          }

          await updateIntegrationSettings(supabaseAdmin, tenant_id, "google", settings, {
            last_sync_error: null,
            last_sync_at: new Date().toISOString(),
          });
        } catch (apiErr: any) {
          console.error(`Google Sync failed for tenant ${tenant_id}:`, apiErr);
          await updateIntegrationSettings(supabaseAdmin, tenant_id, "google", settings, {
            last_sync_error: `Falha no sync: ${apiErr.message}`,
            last_sync_at: new Date().toISOString(),
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, message: "Sync process completed." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    console.error("General Sync Handler Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

// Soma o campo `value` das entradas de `actions[]` do Meta Insights que casam com os action_types informados
function sumMetaActions(actions: any[] | undefined, types: string[]): number {
  if (!actions) return 0;
  return actions
    .filter((a) => types.includes(a.action_type))
    .reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0);
}

// Helper to persist sync status/errors into ad_integrations.settings (merges with existing settings)
async function updateIntegrationSettings(
  supabaseAdmin: any,
  tenantId: string,
  platform: "meta" | "google",
  currentSettings: any,
  patch: Record<string, any>
) {
  const newSettings = { ...(currentSettings || {}), ...patch };
  await supabaseAdmin
    .from("ad_integrations")
    .update({ settings: newSettings, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("platform", platform);
}

// Helper to generate demonstration data for dashboard preview (2 campanhas por plataforma, últimos 7 dias)
async function generateDemoData(supabaseAdmin: any, tenantId: string, platform: "meta" | "google") {
  const today = new Date();

  const campaigns = platform === "meta"
    ? [
        { id: "demo_meta_implantes", name: "Campanha — Implantes" },
        { id: "demo_meta_clareamento", name: "Campanha — Clareamento Dental" },
      ]
    : [
        { id: "demo_google_ortodontia", name: "Pesquisa — Ortodontia" },
        { id: "demo_google_avaliacao", name: "Pesquisa — Avaliação Gratuita" },
      ];

  // Seed last 7 days of performance, per campaign
  for (let i = 7; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    for (const campaign of campaigns) {
      let spendCents, conversions, impressions, clicks, revenueCents;

      if (platform === "meta") {
        spendCents = Math.round((20 + Math.random() * 20) * 100); // R$ 20 - R$ 40 por campanha
        conversions = Math.round(1 + Math.random() * 3); // 1 - 4 conversões
        impressions = Math.round(800 + Math.random() * 1000);
        clicks = Math.round(40 + Math.random() * 60);
        revenueCents = conversions * 15000; // R$ 150 por conversão
      } else {
        spendCents = Math.round((25 + Math.random() * 25) * 100); // R$ 25 - R$ 50 por campanha
        conversions = Math.round(1 + Math.random() * 2); // 1 - 3 conversões
        impressions = Math.round(500 + Math.random() * 700);
        clicks = Math.round(25 + Math.random() * 45);
        revenueCents = conversions * 20000; // R$ 200 por conversão
      }

      await supabaseAdmin
        .from("ad_performance_daily")
        .upsert({
          tenant_id: tenantId,
          platform,
          date: dateStr,
          ad_account_id: `demo_${platform}_account`,
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          spend_cents: spendCents,
          revenue_cents: revenueCents,
          leads_count: conversions,
          conversion_count: conversions,
          impressions,
          clicks,
        }, { onConflict: "tenant_id,platform,date,campaign_id" });
    }
  }
}
