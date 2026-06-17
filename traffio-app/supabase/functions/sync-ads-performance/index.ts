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

function getLocalDateStr(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
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

    // 1. Fetch active integrations with timezone from tenants
    const { data: integrations, error: fetchError } = await supabaseAdmin
      .from("ad_integrations")
      .select("*, tenants!inner(timezone)")
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
      const tenantData = (integration as any).tenants;
      const timezone = (Array.isArray(tenantData) ? tenantData[0]?.timezone : tenantData?.timezone) || "America/Sao_Paulo";

      const todayDate = new Date();
      const todayStr = getLocalDateStr(todayDate, timezone);
      const thirtyDaysAgoDate = new Date();
      thirtyDaysAgoDate.setDate(todayDate.getDate() - 30);
      const thirtyDaysAgoStr = getLocalDateStr(thirtyDaysAgoDate, timezone);

      // Case A: Meta Ads
      if (platform === "meta") {
        if (isMetaPlaceholder) {
          console.warn(`Meta App ID is placeholder. Generating demo data for tenant: ${tenant_id}`);
          await generateDemoData(supabaseAdmin, tenant_id, "meta", timezone);
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
          // Fetch the official timezone of the Meta Ad Account
          let metaTimezone = timezone;
          try {
            const accountUrl = `https://graph.facebook.com/v19.0/${adAccountId}?fields=timezone_name&access_token=${access_token}`;
            const accountRes = await fetch(accountUrl);
            const accountJson = await accountRes.json();
            if (accountJson.timezone_name) {
              metaTimezone = accountJson.timezone_name;
              console.log(`[Meta Sync] Using Ad Account timezone: ${metaTimezone} (Tenant timezone: ${timezone})`);
            } else if (accountJson.error) {
              console.warn(`[Meta Sync] Failed to fetch Ad Account timezone, falling back to tenant timezone. Error:`, accountJson.error);
            }
          } catch (tzErr) {
            console.warn(`[Meta Sync] Mismatch or error fetching Ad Account timezone. Using tenant timezone.`, tzErr);
          }

          const metaTodayStr = getLocalDateStr(todayDate, metaTimezone);
          const metaThirtyDaysAgoDate = new Date();
          metaThirtyDaysAgoDate.setDate(todayDate.getDate() - 30);
          const metaThirtyDaysAgoStr = getLocalDateStr(metaThirtyDaysAgoDate, metaTimezone);

          console.log(`[Meta Sync] Syncing dates since: ${metaThirtyDaysAgoStr} until: ${metaTodayStr}`);

          const timeRangeParam = encodeURIComponent(JSON.stringify({ since: metaThirtyDaysAgoStr, until: metaTodayStr }));
          const insightsUrl = `https://graph.facebook.com/v19.0/${adAccountId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,actions&time_increment=1&time_range=${timeRangeParam}&access_token=${access_token}`;
          const accountInsightsUrl = `https://graph.facebook.com/v19.0/${adAccountId}/insights?level=account&fields=spend&time_increment=1&time_range=${timeRangeParam}&access_token=${access_token}`;

          const [campaignRes, accountRes] = await Promise.all([
            fetch(insightsUrl),
            fetch(accountInsightsUrl)
          ]);
          
          const resJson = await campaignRes.json();
          let accountJson: any = {};
          try {
            accountJson = await accountRes.json();
          } catch (e) {
            console.error(`Failed to parse account-level insights for tenant ${tenant_id}`, e);
          }

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
          const dailyCampaignSpend: Record<string, number> = {};

          for (const row of insights) {
            const date = row.date_start;
            const spend = Math.round(parseFloat(row.spend || "0") * 100); // dollars to cents
            const impressions = parseInt(row.impressions || "0");
            const clicks = parseInt(row.clicks || "0");
            const conversions = Math.round(sumMetaActions(row.actions, META_LEAD_ACTION_TYPES));

            dailyCampaignSpend[date] = (dailyCampaignSpend[date] || 0) + spend;

            console.log(`[Meta Sync debug] Campanha: "${row.campaign_name}" (${row.campaign_id}) | Data: ${date} | Raw Spend: "${row.spend}" | Parsed Cents: ${spend}`);

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

          // Reconciliation: Compare Account total with Campaign sum per day
          const accountInsights = accountJson.data || [];
          for (const accRow of accountInsights) {
            const date = accRow.date_start;
            const accSpend = Math.round(parseFloat(accRow.spend || "0") * 100);
            const campSpend = dailyCampaignSpend[date] || 0;
            
            // We only upsert the reconciliation row if there's a positive difference.
            // If the difference is zero, we should also upsert 0 to clear any previous delay value.
            const diffCents = Math.max(0, accSpend - campSpend);
            
            if (diffCents > 0 || campSpend > 0 || accSpend > 0) {
              console.log(`[Meta Sync debug] Conciliação Data ${date} | Account Spend: ${accSpend} | Campaigns Sum: ${campSpend} | Delta: ${diffCents}`);
              
              await supabaseAdmin
                .from("ad_performance_daily")
                .upsert({
                  tenant_id,
                  platform: "meta",
                  date,
                  ad_account_id: adAccountId,
                  campaign_id: "meta_account_adjustment",
                  campaign_name: "Ajustes / Delay API (Meta)",
                  spend_cents: diffCents,
                  revenue_cents: 0,
                  leads_count: 0,
                  conversion_count: 0,
                  impressions: 0,
                  clicks: 0,
                }, { onConflict: "tenant_id,platform,date,campaign_id" });
            }
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
          await generateDemoData(supabaseAdmin, tenant_id, "google", timezone);
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
            WHERE segments.date >= '${thirtyDaysAgoStr}' AND segments.date <= '${todayStr}'
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

// Helper to generate demonstration data for dashboard preview (2 campanhas por plataforma, últimos 7 dias + hoje)
async function generateDemoData(supabaseAdmin: any, tenantId: string, platform: "meta" | "google", timezone: string) {
  const campaigns = platform === "meta"
    ? [
        { id: "demo_meta_implantes", name: "Campanha — Implantes" },
        { id: "demo_meta_clareamento", name: "Campanha — Clareamento Dental" },
      ]
    : [
        { id: "demo_google_ortodontia", name: "Pesquisa — Ortodontia" },
        { id: "demo_google_avaliacao", name: "Pesquisa — Avaliação Gratuita" },
      ];

  // Seed last 7 days + today of performance, per campaign
  for (let i = 7; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = getLocalDateStr(d, timezone);

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
