import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

serve(async (req: Request) => {
  const urlObj = new URL(req.url);
  const code = urlObj.searchParams.get("code");
  const state = urlObj.searchParams.get("state"); // This stores tenant_id
  const tenantId = urlObj.searchParams.get("tenant_id");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  
  const metaClientId = Deno.env.get("META_CLIENT_ID") ?? Deno.env.get("FACEBOOK_APP_ID") ?? "INSERIR_APP_ID_AQUI";
  const metaClientSecret = Deno.env.get("META_CLIENT_SECRET") ?? Deno.env.get("FACEBOOK_APP_SECRET") ?? "INSERIR_APP_SECRET_AQUI";
  
  const redirectUri = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/auth-meta`;

  // 1. Initial request: redirect user to Facebook OAuth
  if (!code) {
    const targetTenant = tenantId ?? state;
    if (!targetTenant) {
      return new Response("Missing tenant_id parameter", { status: 400 });
    }

    const fbAuthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${metaClientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${targetTenant}&scope=ads_management,ads_read`;

    return Response.redirect(fbAuthUrl, 302);
  }

  // 2. Callback request: Meta returned authorization code
  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // A. Exchange code for short-lived access token
    const tokenExchangeUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${metaClientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&client_secret=${metaClientSecret}&code=${code}`;

    const tokenResponse = await fetch(tokenExchangeUrl);
    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error("Meta OAuth Code Exchange Error:", tokenData.error);
      return new Response(`OAuth Error: ${tokenData.error.message}`, { status: 400 });
    }

    const shortLivedToken = tokenData.access_token;

    // B. Exchange short-lived token for long-lived access token (approx. 60 days)
    const longLivedUrl = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${metaClientId}&client_secret=${metaClientSecret}&fb_exchange_token=${shortLivedToken}`;

    const longLivedResponse = await fetch(longLivedUrl);
    const longLivedData = await longLivedResponse.json();

    if (longLivedData.error) {
      console.error("Meta OAuth Long-Lived Token Exchange Error:", longLivedData.error);
      return new Response(`OAuth Exchange Error: ${longLivedData.error.message}`, { status: 400 });
    }

    const longLivedToken = longLivedData.access_token;

    // C. Upsert connection inside the database
    const { error: upsertError } = await supabaseAdmin
      .from("ad_integrations")
      .upsert(
        {
          tenant_id: state,
          platform: "meta",
          access_token: longLivedToken,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,platform" }
      );

    if (upsertError) {
      console.error("Database Upsert Error:", upsertError);
      return new Response(`Database Error: ${upsertError.message}`, { status: 500 });
    }

    // D. Return success HTML view and trigger window close
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
          <p>Sua conta do Meta Ads foi integrada com sucesso ao Traffio. Esta janela pode ser fechada.</p>
        </div>
        <script>
          setTimeout(() => { window.close(); }, 3000);
        </script>
      </body>
      </html>
    `;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
      status: 200,
    });
  } catch (err: any) {
    console.error("Meta Auth Handler Error:", err);
    return new Response(`Internal Server Error: ${err.message}`, { status: 500 });
  }
});
