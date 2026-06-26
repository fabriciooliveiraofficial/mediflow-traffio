/**
 * auth-meta-messaging — Edge Function
 *
 * OAuth flow para conectar Páginas do Facebook e contas Instagram Business
 * com o objetivo de enviar/receber mensagens diretas (DM).
 *
 * DIFERENTE de auth-meta (que é para Meta Ads).
 * Usa os mesmos META_CLIENT_ID / META_CLIENT_SECRET, mas scopes diferentes.
 *
 * Scopes: pages_messaging, instagram_manage_messages,
 *         pages_read_engagement, pages_manage_metadata,
 *         pages_show_list, instagram_basic, business_management
 *
 * Após autorização, salva cada página em tenant_meta_pages com:
 *   - page_id, page_name, page_access_token
 *   - instagram_account_id, instagram_username (se vinculado)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getMetaClientId, getMetaClientSecret } from "../_shared/masterConfig.ts";

serve(async (req: Request) => {
  const url        = new URL(req.url);
  const code       = url.searchParams.get("code");
  const state      = url.searchParams.get("state");      // tenant_id (passado no redirect)
  const tenantId   = url.searchParams.get("tenant_id");  // tenant_id (chamada inicial)
  const redirectBackParam = url.searchParams.get("redirect_back");
  const error      = url.searchParams.get("error");
  const errorDesc  = url.searchParams.get("error_description");

  const supabaseUrl  = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const redirectUri  = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/auth-meta-messaging`;

  // Criar supabase para leitura de master_config
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Prioridade: Supabase Secret → master_config (UI /master/intelligence)
  const clientId     = await getMetaClientId(supabaseAdmin)
    || Deno.env.get("FACEBOOK_APP_ID") || "";
  const clientSecret = await getMetaClientSecret(supabaseAdmin)
    || Deno.env.get("FACEBOOK_APP_SECRET") || "";

  // ── Usuário negou permissão ──────────────────────────────────────────────
  if (error) {
    console.error("[auth-meta-messaging] User denied:", error, errorDesc);
    let redirectBack = "";
    if (state) {
      try {
        const decodedState = JSON.parse(atob(state));
        redirectBack = decodedState.redirectBack;
      } catch {}
    }
    if (redirectBack) {
      return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=meta-messaging&message=${encodeURIComponent(errorDesc ?? error)}`, 302);
    }
    return errorPage(`Permissão negada: ${errorDesc ?? error}`);
  }

  // ── Requisição inicial: redirecionar para Facebook OAuth ─────────────────
  if (!code) {
    const target = tenantId ?? state;
    if (!target) {
      return new Response("Parâmetro tenant_id ausente", { status: 400 });
    }

    const scopes = [
      "pages_show_list",
      "pages_messaging",
      "instagram_manage_messages",
      "pages_read_engagement",
      "pages_manage_metadata",
      "instagram_basic",
      "business_management",
    ].join(",");

    const statePayload = {
      tenantId: target,
      redirectBack: redirectBackParam || "",
    };
    const encodedState = btoa(JSON.stringify(statePayload));

    const authUrl =
      `https://www.facebook.com/v21.0/dialog/oauth` +
      `?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodedState}` +
      `&scope=${encodeURIComponent(scopes)}`;

    return Response.redirect(authUrl, 302);
  }

  // ── Callback: processar autorização ─────────────────────────────────────
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

  if (!activeTenantId) {
    if (redirectBack) {
      return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=meta-messaging&message=${encodeURIComponent("state (tenant_id) ausente no callback")}`, 302);
    }
    return new Response("state (tenant_id) ausente no callback", { status: 400 });
  }

  try {
    const supabase = supabaseAdmin; // reutiliza o client já criado

    // 1. Trocar code por token de curta duração
    const shortRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token` +
      `?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${clientSecret}` +
      `&code=${code}`
    );
    const shortData = await shortRes.json();
    if (shortData.error) throw new Error(shortData.error.message);

    // 2. Trocar por token de longa duração (~60 dias)
    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${clientId}` +
      `&client_secret=${clientSecret}` +
      `&fb_exchange_token=${shortData.access_token}`
    );
    const longData = await longRes.json();
    if (longData.error) throw new Error(longData.error.message);

    const userToken = longData.access_token;

    // 3. Buscar páginas com tokens + conta Instagram vinculada
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts` +
      `?fields=id,name,access_token,category,instagram_business_account{id,username,name}` +
      `&limit=50` +
      `&access_token=${userToken}`
    );
    const pagesData = await pagesRes.json();
    if (pagesData.error) throw new Error(pagesData.error.message);

    const pages: any[] = pagesData.data ?? [];
    console.log(`[auth-meta-messaging] Found ${pages.length} pages for tenant ${activeTenantId}`);

    // 4. Upsert cada página em tenant_meta_pages
    let savedCount = 0;

    for (const page of pages) {
      const ig = page.instagram_business_account ?? null;

      const { error: upsertErr } = await supabase
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
            token_type:           "page",
            expires_at:           null,          // Page tokens não expiram
            last_refreshed_at:    new Date().toISOString(),
            is_active:            true,
            scope_granted:        [
              "pages_messaging",
              "instagram_manage_messages",
              "pages_read_engagement",
            ],
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,page_id" }
        );

      if (upsertErr) {
        console.error(`[auth-meta-messaging] Failed to save page ${page.id}:`, upsertErr);
      } else {
        savedCount++;
        console.log(`[auth-meta-messaging] ✓ Saved page "${page.name}"${ig ? ` + IG @${ig.username}` : ""}`);
        
        // 🚀 NOVO: Inscrever a página no Webhook do App para receber mensagens
        try {
          const subRes = await fetch(
            `https://graph.facebook.com/v21.0/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,standby&access_token=${page.access_token}`,
            { method: 'POST' }
          );
          const subData = await subRes.json();
          if (subData.success) {
            console.log(`[auth-meta-messaging] ✓ Webhook subscribed for page "${page.name}"`);
          } else {
            console.error(`[auth-meta-messaging] Failed to subscribe webhook for page "${page.name}":`, subData.error || subData);
          }
        } catch (subErr: any) {
          console.error(`[auth-meta-messaging] Exception subscribing webhook for page "${page.name}":`, subErr.message);
        }
      }
    }

    // 5. Retornar HTML de sucesso e fechar popup (ou redirecionar)
    if (redirectBack) {
      const successUrl = `${redirectBack}/oauth-callback.html?status=success&platform=meta-messaging&count=${savedCount}`;
      return Response.redirect(successUrl, 302);
    }
    return successPage(savedCount, pages);

  } catch (err: any) {
    console.error("[auth-meta-messaging] Error:", err.message);
    if (redirectBack) {
      return Response.redirect(`${redirectBack}/oauth-callback.html?status=error&platform=meta-messaging&message=${encodeURIComponent(err.message)}`, 302);
    }
    return errorPage(err.message);
  }
});

// ─── Helpers de HTML ────────────────────────────────────────────────────────

function successPage(count: number, pages: any[]): Response {
  const pageList = pages
    .map((p) => {
      const ig = p.instagram_business_account;
      return `<li>${p.name}${ig ? ` <span style="color:#E1306C">+ @${ig.username}</span>` : ""}</li>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Páginas Conectadas - Traffio</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; }
    .card { background: white; padding: 2.5rem; border-radius: 32px; box-shadow: 0 20px 25px -5px rgb(0 0 0/0.1); text-align: center; max-width: 420px; width: 100%; }
    .icon { width: 64px; height: 64px; background: #e6f4ea; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 1.5rem; }
    h1 { color: #0f172a; font-size: 1.4rem; font-weight: 800; margin: 0 0 0.5rem; }
    p { color: #64748b; font-size: 0.9rem; margin: 0 0 1rem; }
    ul { text-align: left; list-style: none; padding: 0.75rem 1rem; margin: 0; background: #f8fafc; border-radius: 12px; font-size: 0.875rem; color: #374151; }
    li { padding: 0.25rem 0; }
    li::before { content: "✓ "; color: #16a34a; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>${count} ${count === 1 ? "Página Conectada" : "Páginas Conectadas"}!</h1>
    <p>Pronto para enviar mensagens via Instagram DM e Facebook Messenger.</p>
    ${pageList ? `<ul>${pageList}</ul>` : ""}
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'META_MESSAGING_CONNECTED', count: ${count} }, '*');
    }
    setTimeout(() => { window.close(); }, 3000);
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
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
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'META_MESSAGING_ERROR', message: '${message.replace(/'/g, "\\'")}' }, '*');
    }
    setTimeout(() => { window.close(); }, 4000);
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 400 });
}
