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

serve(async (req: Request) => {
  const urlObj = new URL(req.url);
  const code = urlObj.searchParams.get("code");
  const state = urlObj.searchParams.get("state");
  const tenantId = urlObj.searchParams.get("tenant_id");
  const redirectBackParam = urlObj.searchParams.get("redirect_back");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Prioridade: Supabase Secret → master_config (UI /master/intelligence)
  const googleClientId     = await getGoogleCred(supabase, "GOOGLE_CLIENT_ID",     "GOOGLE_CLIENT_ID");
  const googleClientSecret = await getGoogleCred(supabase, "GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET");

  const redirectUri = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/auth-google`;

  // 1. Initial request: redirect user to Google OAuth
  if (!code) {
    const targetTenant = tenantId ?? state;
    if (!targetTenant) {
      return new Response("Missing tenant_id parameter", { status: 400 });
    }

    const statePayload = {
      tenantId: targetTenant,
      redirectBack: redirectBackParam || "",
    };
    const encodedState = btoa(JSON.stringify(statePayload));

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&state=${encodedState}&scope=${encodeURIComponent(
      "https://www.googleapis.com/auth/adwords"
    )}&access_type=offline&prompt=consent`;

    return Response.redirect(googleAuthUrl, 302);
  }

  // 2. Callback request: Google returned authorization code
  let activeTenantId = "";
  let redirectBack = "";

  if (state) {
    try {
      const decodedState = JSON.parse(atob(state));
      activeTenantId = decodedState.tenantId;
      redirectBack = decodedState.redirectBack;
    } catch {
      // Fallback for legacy calls
      activeTenantId = state;
    }
  }

  try {
    const supabaseAdmin = supabase;

    // Exchange code for access & refresh tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error("Google OAuth Code Exchange Error:", tokenData.error_description || tokenData.error);
      if (redirectBack) {
        return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=google&message=${encodeURIComponent(tokenData.error_description || tokenData.error)}`, 302);
      }
      return new Response(`OAuth Error: ${tokenData.error_description || tokenData.error}`, { status: 400 });
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token; // Received on initial consent click

    // C. Check accessible Google Ads customers using the global Developer Token
    const googleDevToken = await getGoogleCred(supabaseAdmin, "GOOGLE_DEVELOPER_TOKEN");
    let adAccounts: string[] = [];
    let customerId = "";
    let lastSyncError = null;

    if (googleDevToken) {
      try {
        const response = await fetch("https://googleads.googleapis.com/v16/customers:listAccessibleCustomers", {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "developer-token": googleDevToken,
          }
        });
        const resJson = await response.json();
        
        if (resJson.error) {
          console.error("Google Ads Accessible Customers API Error:", resJson.error);
          lastSyncError = `Erro na API do Google Ads: ${resJson.error.message}`;
        } else if (resJson.resourceNames && resJson.resourceNames.length > 0) {
          adAccounts = resJson.resourceNames.map((name: string) => name.replace("customers/", ""));
          if (adAccounts.length === 1) {
            customerId = adAccounts[0];
          }
        } else {
          lastSyncError = "Nenhuma conta do Google Ads encontrada vinculada a este login.";
        }
      } catch (err: any) {
        console.error("Failed to query accessible Google Ads customers:", err);
        lastSyncError = `Falha ao listar contas: ${err.message}`;
      }
    } else {
      console.warn("GOOGLE_DEVELOPER_TOKEN not configured. Skipping accessible customers fetch.");
    }

    // Fetch existing settings
    let currentSettings: any = {};
    try {
      const { data } = await supabaseAdmin
        .from("ad_integrations")
        .select("settings")
        .eq("tenant_id", activeTenantId)
        .eq("platform", "google")
        .maybeSingle();
      currentSettings = data?.settings || {};
    } catch (err) {
      console.error("Error fetching current settings:", err);
    }

    const settingsPatch: any = {
      ...currentSettings,
      last_sync_error: lastSyncError,
      last_sync_at: new Date().toISOString(),
    };

    if (googleDevToken) {
      settingsPatch.developer_token = googleDevToken;
    }

    if (customerId) {
      settingsPatch.customer_id = customerId;
      settingsPatch.needs_customer_selection = false;
      delete settingsPatch.available_customers;
    } else if (adAccounts.length > 1) {
      settingsPatch.available_customers = adAccounts;
      settingsPatch.needs_customer_selection = true;
    }

    // D. Upsert connection inside the database
    const upsertData: any = {
      tenant_id: activeTenantId,
      platform: "google",
      access_token: accessToken,
      status: "active",
      settings: settingsPatch,
      updated_at: new Date().toISOString(),
    };
    
    // Google only sends the refresh_token on the first prompt consent,
    // so we only upsert it if present.
    if (refreshToken) {
      upsertData.refresh_token = refreshToken;
    }

    const { error: upsertError } = await supabaseAdmin
      .from("ad_integrations")
      .upsert(upsertData, { onConflict: "tenant_id,platform" });

    if (upsertError) {
      console.error("Database Upsert Error:", upsertError);
      if (redirectBack) {
        return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=google&message=${encodeURIComponent(upsertError.message)}`, 302);
      }
      return new Response(`Database Error: ${upsertError.message}`, { status: 500 });
    }

    // E. Redirect back to frontend success page
    if (redirectBack) {
      return Response.redirect(`${redirectBack}/oauth-callback.html?status=success&platform=google`, 302);
    }

    // Legacy Fallback (HTML View)
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Autenticação Concluída - Traffio</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background-color: #f8fafc;
            color: #0f172a;
          }
          .card {
            background: white;
            padding: 2.5rem;
            border-radius: 32px;
            box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
            text-align: center;
            max-width: 400px;
            border: 1px solid #f1f5f9;
          }
          .icon {
            width: 64px;
            height: 64px;
            background-color: #e6f4ea;
            color: #137333;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
            margin: 0 auto 1.5rem auto;
          }
          h1 { color: #0f172a; font-size: 1.5rem; margin-top: 0; font-weight: 800; tracking: -0.025em; }
          p { color: #64748b; font-size: 0.95rem; line-height: 1.6; margin-bottom: 0; font-weight: 500; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✓</div>
          <h1>Conta Conectada!</h1>
          <p>Sua conta do Google Ads foi integrada com sucesso ao Traffio. Esta janela pode ser fechada.</p>
        </div>
      </body>
      </html>
    `;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
      status: 200,
    });
  } catch (err: any) {
    console.error("Google Auth Handler Error:", err);
    if (redirectBack) {
      return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=google&message=${encodeURIComponent(err.message)}`, 302);
    }
    return new Response(`Internal Server Error: ${err.message}`, { status: 500 });
  }
});
