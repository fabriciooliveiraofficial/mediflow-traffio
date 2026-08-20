import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getMetaClientId, getMetaClientSecret } from "../_shared/masterConfig.ts";

serve(async (req: Request) => {
  const urlObj = new URL(req.url);
  const code = urlObj.searchParams.get("code");
  const state = urlObj.searchParams.get("state");
  const tenantId = urlObj.searchParams.get("tenant_id");
  const redirectBackParam = urlObj.searchParams.get("redirect_back");
  const error = urlObj.searchParams.get("error");
  const errorDesc = urlObj.searchParams.get("error_description");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Prioridade: Supabase Secret → master_config (UI /master/intelligence)
  const metaClientId     = await getMetaClientId(supabase)     || Deno.env.get("FACEBOOK_APP_ID")     || "";
  const metaClientSecret = await getMetaClientSecret(supabase) || Deno.env.get("FACEBOOK_APP_SECRET") || "";

  const redirectUri = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/auth-meta`;

  // ── Usuário negou permissão ──────────────────────────────────────────────
  if (error) {
    console.error("[auth-meta] User denied:", error, errorDesc);
    let redirectBack = "";
    if (state) {
      try {
        const decodedState = JSON.parse(atob(state));
        redirectBack = decodedState.redirectBack;
      } catch {}
    }
    if (redirectBack) {
      return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=meta&message=${encodeURIComponent(errorDesc ?? error)}`, 302);
    }
    return errorPage(`Permissão negada: ${errorDesc ?? error}`);
  }

  // 1. Initial request: redirect user to Facebook OAuth
  if (!code) {
    const targetTenant = tenantId ?? state;
    if (!targetTenant) {
      return new Response("Missing tenant_id parameter", { status: 400 });
    }

    const selectedFeatures = urlObj.searchParams.get("features") || "ads,messaging";

    const statePayload = {
      tenantId: targetTenant,
      redirectBack: redirectBackParam || "",
      features: selectedFeatures,
    };
    const encodedState = btoa(JSON.stringify(statePayload));

    // Combine scopes dynamically based on selected features
    const scopes: string[] = [];
    if (selectedFeatures.includes("ads")) {
      scopes.push("ads_management", "ads_read", "pages_manage_ads");
    }
    if (selectedFeatures.includes("messaging")) {
      scopes.push(
        "pages_show_list",
        "pages_messaging",
        "instagram_manage_messages",
        "pages_read_engagement",
        "pages_manage_metadata",
        "instagram_basic",
        "business_management",
        "instagram_manage_comments",
        "public_profile"
      );
    }

    const fbAuthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${metaClientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${encodedState}&scope=${encodeURIComponent(scopes.join(","))}&auth_type=rerequest`;

    return Response.redirect(fbAuthUrl, 302);
  }

  // 2. Callback request: Meta returned authorization code
  let activeTenantId = "";
  let redirectBack = "";
  let features = "ads,messaging";

  if (state) {
    try {
      const decodedState = JSON.parse(atob(state));
      activeTenantId = decodedState.tenantId;
      redirectBack = decodedState.redirectBack;
      features = decodedState.features || "ads,messaging";
    } catch {
      // Fallback for legacy calls
      activeTenantId = state;
    }
  }

  if (!activeTenantId) {
    if (redirectBack) {
      return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=meta&message=${encodeURIComponent("state (tenant_id) ausente no callback")}`, 302);
    }
    return new Response("state (tenant_id) ausente no callback", { status: 400 });
  }

  try {
    const supabaseAdmin = supabase;

    // A. Exchange code for short-lived access token
    const tokenExchangeUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${metaClientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&client_secret=${metaClientSecret}&code=${code}`;

    const tokenResponse = await fetch(tokenExchangeUrl);
    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error("Meta OAuth Code Exchange Error:", tokenData.error);
      if (redirectBack) {
        return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=meta&message=${encodeURIComponent(tokenData.error.message)}`, 302);
      }
      return new Response(`OAuth Error: ${tokenData.error.message}`, { status: 400 });
    }

    const shortLivedToken = tokenData.access_token;

    // B. Exchange short-lived token for long-lived access token (approx. 60 days)
    const longLivedUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${metaClientId}&client_secret=${metaClientSecret}&fb_exchange_token=${shortLivedToken}`;

    const longLivedResponse = await fetch(longLivedUrl);
    const longLivedData = await longLivedResponse.json();

    if (longLivedData.error) {
      console.error("Meta OAuth Long-Lived Token Exchange Error:", longLivedData.error);
      if (redirectBack) {
        return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=meta&message=${encodeURIComponent(longLivedData.error.message)}`, 302);
      }
      return new Response(`OAuth Exchange Error: ${longLivedData.error.message}`, { status: 400 });
    }

    const longLivedToken = longLivedData.access_token;

    // C. Fetch the Facebook Ad Accounts available to this user (if ads feature requested)
    let adAccountSettings: Record<string, any> = {
      ad_account_id: null,
      available_ad_accounts: [],
      needs_account_selection: false,
      last_sync_error: null,
    };

    if (features.includes("ads")) {
      try {
        const adAccountsUrl = `https://graph.facebook.com/v21.0/me/adaccounts?fields=account_id,name&access_token=${longLivedToken}`;
        const adAccountsRes = await fetch(adAccountsUrl);
        const adAccountsData = await adAccountsRes.json();

        if (adAccountsData.error) {
          console.error("Meta Ad Accounts Fetch Error:", adAccountsData.error);
          adAccountSettings.last_sync_error = `Não foi possível listar as contas de anúncios: ${adAccountsData.error.message}`;
        } else {
          const accounts = (adAccountsData.data || []).map((a: any) => ({
            id: a.id, // already in "act_<id>" format
            account_id: a.account_id,
            name: a.name,
          }));

          if (accounts.length === 0) {
            adAccountSettings.last_sync_error = "Nenhuma conta de anúncios do Meta foi encontrada para este usuário.";
          } else {
            adAccountSettings.ad_account_id = accounts[0].id;
            adAccountSettings.available_ad_accounts = accounts;
            adAccountSettings.needs_account_selection = accounts.length > 1;
          }
        }
      } catch (adAccErr: any) {
        console.error("Meta Ad Accounts Fetch Exception:", adAccErr);
        adAccountSettings.last_sync_error = `Erro ao buscar contas de anúncios: ${adAccErr.message}`;
      }
    }

    // D. Fetch Facebook Pages and Instagram accounts (if messaging feature requested)
    let savedPagesCount = 0;
    if (features.includes("messaging")) {
      try {
        const pagesRes = await fetch(
          `https://graph.facebook.com/v21.0/me/accounts` +
          `?fields=id,name,access_token,category,instagram_business_account{id,username,name,profile_picture_url}` +
          `&limit=50` +
          `&access_token=${longLivedToken}`
        );
        const pagesData = await pagesRes.json();
        if (pagesData.error) {
          console.error("Meta Pages Fetch Error:", pagesData.error);
        } else {
          const pages: any[] = pagesData.data ?? [];
          console.log(`[auth-meta] Found ${pages.length} pages for tenant ${activeTenantId}`);

          for (const page of pages) {
            const ig = page.instagram_business_account ?? null;

            const { error: upsertErr } = await supabaseAdmin
              .from("tenant_meta_pages")
              .upsert(
                {
                  tenant_id:            activeTenantId,
                  page_id:              page.id,
                  page_name:            page.name,
                  page_access_token:    page.access_token,
                  page_category:        page.category ?? null,
                  instagram_account_id: ig?.id ?? null,
                  instagram_username:   ig?.username ?? null,
                  instagram_profile_picture_url: ig?.profile_picture_url ?? null,
                  token_type:           "page",
                  expires_at:           null,
                  last_refreshed_at:    new Date().toISOString(),
                  is_active:            true,
                  scope_granted:        [
                    "pages_messaging",
                    "instagram_manage_messages",
                    "pages_read_engagement",
                    "instagram_manage_comments",
                    "public_profile"
                  ],
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "tenant_id,page_id" }
              );

            if (upsertErr) {
              console.error(`[auth-meta] Failed to save page ${page.id}:`, upsertErr);
            } else {
              savedPagesCount++;
              console.log(`[auth-meta] ✓ Saved page "${page.name}"${ig ? ` + IG @${ig.username}` : ""}`);
              
              // 🚀 NOVO: Inscrever a página no Webhook do App para receber mensagens
              // NOTA (2026-08-20): "comments" NÃO é um valor aceito neste endpoint
              // (/{page-id}/subscribed_apps) — a API rejeita com erro #100 (param
              // subscribed_fields inválido, "comments" não está na lista). Tentar
              // assinar via /{ig-account-id}/subscribed_apps?subscribed_fields=comments
              // também falha, com erro #3 "Application does not have the capability
              // to make this API call" — investigar junto ao suporte da Meta antes
              // de tentar de novo.
              try {
                const subRes = await fetch(
                  `https://graph.facebook.com/v21.0/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,standby&access_token=${page.access_token}`,
                  { method: 'POST' }
                );
                const subData = await subRes.json();
                if (subData.success) {
                  console.log(`[auth-meta] ✓ Webhook subscribed for page "${page.name}"`);
                } else {
                  console.error(`[auth-meta] Failed to subscribe webhook for page "${page.name}":`, subData.error || subData);
                }
              } catch (subErr: any) {
                console.error(`[auth-meta] Exception subscribing webhook for page "${page.name}":`, subErr.message);
              }
            }
          }
        }
      } catch (pagesErr: any) {
        console.error("Meta Pages Fetch Exception:", pagesErr);
      }
    }

    // E. Upsert connection inside the database
    const { error: upsertError } = await supabaseAdmin
      .from("ad_integrations")
      .upsert(
        {
          tenant_id: activeTenantId,
          platform: "meta",
          access_token: longLivedToken,
          status: features.includes("ads") ? "active" : "inactive",
          settings: adAccountSettings,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,platform" }
      );

    if (upsertError) {
      console.error("Database Upsert Error:", upsertError);
      if (redirectBack) {
        return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=meta&message=${encodeURIComponent(upsertError.message)}`, 302);
      }
      return new Response(`Database Error: ${upsertError.message}`, { status: 500 });
    }

    // F. Redirect back to frontend success page
    if (redirectBack) {
      return Response.redirect(`${redirectBack}/oauth-callback.html?status=success&platform=meta&count=${savedPagesCount}`, 302);
    }

    // Legacy Fallback (HTML View)
    return successPage(savedPagesCount);
  } catch (err: any) {
    console.error("Meta Auth Handler Error:", err);
    if (redirectBack) {
      return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=meta&message=${encodeURIComponent(err.message)}`, 302);
    }
    return new Response(`Internal Server Error: ${err.message}`, { status: 500 });
  }
});

function successPage(count: number): Response {
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
        <p>Sua conta do Meta (Ads e Páginas) foi integrada com sucesso ao Traffio. Esta janela pode ser fechada.</p>
      </div>
    </body>
    </html>
  `;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 200 });
}

function errorPage(message: string): Response {
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Erro - Traffio</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fef2f2; }
    .card { background: white; padding: 2.5rem; border-radius: 32px; box-shadow: 0 20px 25px -5px rgb(0 0 0/0.1); text-align: center; max-width: 400px; }
    .icon { width: 64px; height: 64px; background: #fee2e2; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 1.5rem; }
    h1 { color: #991b1b; font-size: 1.3rem; font-weight: 800; }
    p { color: #64748b; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✕</div>
    <h1>Erro na Conexão</h1>
    <p>${message}</p>
    <p style="margin-top:1rem;font-size:0.8rem">Esta janela pode ser fechada.</p>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 400 });
}
