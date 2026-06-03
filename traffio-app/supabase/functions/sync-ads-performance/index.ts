import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

serve(async (req: Request) => {
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
      return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
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

        try {
          const adAccountId = settings?.ad_account_id ?? "act_default";
          const insightsUrl = `https://graph.facebook.com/v19.0/${adAccountId}/insights?fields=spend,impressions,clicks,conversions&date_preset=last_7d&access_token=${access_token}`;
          
          const response = await fetch(insightsUrl);
          const resJson = await response.json();

          if (resJson.error) {
            console.error(`Meta API Error for tenant ${tenant_id}:`, resJson.error);
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
        } catch (apiErr) {
          console.error(`Meta Sync failed for tenant ${tenant_id}:`, apiErr);
        }
      }

      // Case B: Google Ads
      if (platform === "google") {
        if (isGooglePlaceholder) {
          console.warn(`Google Client ID is placeholder. Generating demo data for tenant: ${tenant_id}`);
          await generateDemoData(supabaseAdmin, tenant_id, "google");
          continue;
        }

        try {
          // Exchange refresh_token for access_token
          const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
          const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
          
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
            continue;
          }

          const freshAccessToken = tokenData.access_token;
          const customerId = settings?.customer_id ?? "1234567890"; // default customer id

          // Query Google Ads API
          const googleQuery = `
            SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
            FROM campaign 
            WHERE segments.date DURING LAST_7_DAYS
          `;

          const adsRes = await fetch(`https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:search`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${freshAccessToken}`,
              "Content-Type": "application/json",
              "developer-token": settings?.developer_token ?? "",
            },
            body: JSON.stringify({ query: googleQuery }),
          });

          const adsData = await adsRes.json();
          if (adsData.error) {
            console.error(`Google Ads API error for tenant ${tenant_id}:`, adsData.error);
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
        } catch (apiErr) {
          console.error(`Google Sync failed for tenant ${tenant_id}:`, apiErr);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, message: "Sync process completed." }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    console.error("General Sync Handler Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

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
