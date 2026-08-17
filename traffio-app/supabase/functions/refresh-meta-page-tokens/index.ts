/**
 * refresh-meta-page-tokens — Edge Function (Cron, weekly)
 *
 * Valida os Page Access Tokens e garante a inscrição do app no webhook de
 * mensagens (Meta não avisa quando a inscrição cai). Page tokens não têm
 * data de expiração, mas ficam inválidos se o usuário remover o app.
 *
 * IMPORTANTE (incidente 17/08/2026 — canais Meta inbound mortos): esta função
 * NUNCA escreve em is_active. `is_active` é INTENÇÃO do usuário (conectar/
 * desconectar na UI), não saúde de token. A versão anterior marcava
 * is_active=false em QUALQUER erro da Graph (inclusive transitório) e nada
 * reativava — o meta-social-webhook então descartava as mensagens de
 * Instagram+Messenger silenciosamente, para sempre. Token inválido agora é
 * apenas reportado (logs + resposta JSON); a reconexão é decisão do usuário
 * via OAuth (auth-meta-messaging), que renova o token e reassina o webhook.
 *
 * Trigger: cron semanal (sugerido: toda segunda-feira às 06:00)
 * Também pode ser chamado manualmente via POST — a resposta traz o estado
 * por página (token_ok, error_code, resubscribed), útil para diagnóstico.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

interface PageCheckResult {
  page_id: string;
  page_name: string;
  is_active: boolean;
  token_ok: boolean;
  /** Código de erro da Graph API quando token_ok=false (190 = token inválido/revogado → precisa re-OAuth) */
  error_code: number | null;
  error_message: string | null;
  /** true quando a inscrição do webhook foi (re)confirmada nesta execução */
  resubscribed: boolean;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("[refresh-meta-page-tokens] Starting validation run");

  try {
    // Valida TODAS as páginas, ativas ou não: a inativa também precisa de
    // diagnóstico (é assim que sabemos se basta reativar na UI ou se o
    // cliente precisa refazer o OAuth). Só a inscrição de webhook fica
    // restrita às ativas.
    const { data: pages, error: fetchErr } = await supabase
      .from("tenant_meta_pages")
      .select("id, tenant_id, page_id, page_name, page_access_token, is_active, last_refreshed_at")
      .limit(100);

    if (fetchErr) throw fetchErr;
    if (!pages?.length) {
      console.log("[refresh-meta-page-tokens] No pages to validate");
      return new Response(JSON.stringify({ validated: 0, invalid: 0, pages: [] }), { headers: corsHeaders });
    }

    console.log(`[refresh-meta-page-tokens] Validating ${pages.length} page(s)`);

    const results: PageCheckResult[] = [];

    for (const page of pages) {
      const result: PageCheckResult = {
        page_id: page.page_id,
        page_name: page.page_name,
        is_active: page.is_active,
        token_ok: false,
        error_code: null,
        error_message: null,
        resubscribed: false,
      };

      try {
        // Verificar se o token ainda é válido — buscar nome da página
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${page.page_id}?fields=id,name&access_token=${page.page_access_token}`
        );
        const data = await res.json();

        if (data.error) {
          result.error_code = data.error.code ?? null;
          result.error_message = data.error.message ?? null;
          const definitive = data.error.code === 190; // token inválido/expirado/revogado
          console.warn(
            `[refresh-meta-page-tokens] Token check failed for page ${page.page_name} (${page.page_id}) — ` +
            `code ${data.error.code}${definitive ? " [DEFINITIVO: requer reconexão OAuth]" : " [possivelmente transitório]"}: ${data.error.message}`
          );
          // NÃO desativa a página — ver comentário no topo do arquivo.
        } else {
          result.token_ok = true;

          // Token válido — garantir que o app continua inscrito para receber
          // eventos de Messenger/Instagram (só para páginas que o usuário quer ativas).
          if (page.is_active) {
            try {
              const subRes = await fetch(
                `https://graph.facebook.com/v21.0/${page.page_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,standby&access_token=${page.page_access_token}`,
                { method: "POST" }
              );
              const subData = await subRes.json();
              if (subData.success) {
                result.resubscribed = true;
              } else {
                console.error(`[refresh-meta-page-tokens] Failed to (re)subscribe webhook for page ${page.page_name}:`, subData.error || subData);
              }
            } catch (subErr: any) {
              console.error(`[refresh-meta-page-tokens] Exception (re)subscribing webhook for page ${page.page_name}:`, subErr.message);
            }
          }

          await supabase
            .from("tenant_meta_pages")
            .update({ last_refreshed_at: new Date().toISOString() })
            .eq("id", page.id);
        }
      } catch (pageErr: any) {
        result.error_message = pageErr.message;
        console.error(`[refresh-meta-page-tokens] Error checking page ${page.page_id}:`, pageErr.message);
      }

      results.push(result);
    }

    const summary = {
      validated: results.filter((r) => r.token_ok).length,
      invalid:   results.filter((r) => !r.token_ok).length,
      pages:     results,
    };
    console.log("[refresh-meta-page-tokens] Done:", JSON.stringify({ validated: summary.validated, invalid: summary.invalid }));
    return new Response(JSON.stringify(summary), { headers: corsHeaders });

  } catch (err: any) {
    console.error("[refresh-meta-page-tokens] Fatal:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
