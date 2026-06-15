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
          const insightsUrl = `https://graph.facebook.com/v19.0/${adAccountId}/insights?fields=spend,impressions,clicks,conversions&date_preset=last_7d&time_increment=1&access_token=${access_token}`;

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

          // Process and upsert insights data
          const insights = resJson.data || [];
          for (const day of insights) {
            const date = day.date_start;
            const spend = Math.round(parseFloat(day.spend || "0") * 100); // dollars to cents
            const impressions = parseInt(day.impressions || "0");
            const clicks = parseInt(day.clicks || "0");

            // Look up conversions from DB by matching utm_source = 'facebook' / 'instagram' on that date
            const { count: leadsCount } = await supabaseAdmin
              .from("patients")
              .select("*", { count: "exact", head: true })
              .eq("tenant_id", tenant_id)
              .gte("created_at", `${date}T00:00:00Z`)
              .lte("created_at", `${date}T23:59:59Z`)
              .filter("metadata->>utm_source", "in", '("facebook","instagram","meta")');

            // Look up dental budgets / revenue completed
            const { data: revenueData } = await supabaseAdmin
              .from("appointments")
              .select("id")
              .eq("tenant_id", tenant_id)
              .eq("status", "completed")
              .gte("start_time", `${date}T00:00:00Z`)
              .lte("start_time", `${date}T23:59:59Z`);

            // Estimate R$ 150,00 (15000 cents) per completed appointment for conversion revenue attribution
            const revCents = (revenueData?.length ?? 0) * 15000;

            await supabaseAdmin
              .from("ad_performance_daily")
              .upsert({
                tenant_id,
                platform: "meta",
                date,
                spend_cents: spend,
                revenue_cents: revCents,
                leads_count: leadsCount || 0,
                conversion_count: revenueData?.length ?? 0,
                impressions,
                clicks,
              }, { onConflict: "tenant_id,platform,date" });
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
          developerToken = Deno.env.get("GOOGLE_DEVELOPER_TOKEN");
          if (!developerToken) {
            try {
              const { data: configData } = await supabaseAdmin
                .from("master_config")
                .select("value")
                .eq("key", "GOOGLE_DEVELOPER_TOKEN")
                .maybeSingle();
              developerToken = configData?.value ?? "";
            } catch (err) {
              console.error(`Error fetching GOOGLE_DEVELOPER_TOKEN from master_config for tenant ${tenant_id}:`, err);
            }
          }
        }

        if (!customerId || !developerToken) {
          console.warn(`Tenant ${tenant_id} has no Google customer_id/developer_token configured. Skipping sync.`);
          await updateIntegrationSettings(supabaseAdmin, tenant_id, "google", settings, {
            last_sync_error: "Customer ID ou Developer Token do Google Ads não configurados.",
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

          // Query Google Ads API
          const googleQuery = `
            SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
            FROM campaign
            WHERE segments.date DURING LAST_7_DAYS
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

            // Count leads created via google ads utm source on this day
            const { count: leadsCount } = await supabaseAdmin
              .from("patients")
              .select("*", { count: "exact", head: true })
              .eq("tenant_id", tenant_id)
              .gte("created_at", `${date}T00:00:00Z`)
              .lte("created_at", `${date}T23:59:59Z`)
              .filter("metadata->>utm_source", "eq", "google");

            // Look up completed appointments to attribute revenue
            const { data: appts } = await supabaseAdmin
              .from("appointments")
              .select("id")
              .eq("tenant_id", tenant_id)
              .eq("status", "completed")
              .gte("start_time", `${date}T00:00:00Z`)
              .lte("start_time", `${date}T23:59:59Z`);

            const revCents = (appts?.length ?? 0) * 18000; // Estimate R$ 180,00 per completed Google booking

            await supabaseAdmin
              .from("ad_performance_daily")
              .upsert({
                tenant_id,
                platform: "google",
                date,
                spend_cents: spendCents,
                revenue_cents: revCents,
                leads_count: leadsCount || 0,
                conversion_count: appts?.length ?? 0,
                impressions,
                clicks,
              }, { onConflict: "tenant_id,platform,date" });
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

// Helper to generate demonstration data for dashboard preview
async function generateDemoData(supabaseAdmin: any, tenantId: string, platform: "meta" | "google") {
  const today = new Date();
  
  // Seed last 7 days of performance
  for (let i = 7; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    // Seed randomized values
    let spendCents, leads, conversions, impressions, clicks, revenueCents;

    if (platform === "meta") {
      spendCents = Math.round((40 + Math.random() * 30) * 100); // R$ 40 - R$ 70
      leads = Math.round(3 + Math.random() * 5); // 3 - 8 leads
      conversions = Math.round(1 + Math.random() * 3);
      impressions = Math.round(1500 + Math.random() * 2000);
      clicks = Math.round(80 + Math.random() * 120);
      revenueCents = conversions * 15000; // R$ 150 per conversion
    } else {
      spendCents = Math.round((50 + Math.random() * 40) * 100); // R$ 50 - R$ 90
      leads = Math.round(2 + Math.random() * 4); // 2 - 6 leads
      conversions = Math.round(1 + Math.random() * 2);
      impressions = Math.round(1000 + Math.random() * 1200);
      clicks = Math.round(50 + Math.random() * 80);
      revenueCents = conversions * 20000; // R$ 200 per conversion
    }

    await supabaseAdmin
      .from("ad_performance_daily")
      .upsert({
        tenant_id: tenantId,
        platform,
        date: dateStr,
        spend_cents: spendCents,
        revenue_cents: revenueCents,
        leads_count: leads,
        conversion_count: conversions,
        impressions,
        clicks,
      }, { onConflict: "tenant_id,platform,date" });
  }
}
