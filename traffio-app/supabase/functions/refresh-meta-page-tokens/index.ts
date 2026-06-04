/**
 * refresh-meta-page-tokens — Edge Function (Cron, weekly)
 *
 * Valida e marca como inativo qualquer Page Access Token que tenha sido
 * revogado pelo usuário. Page tokens não têm data de expiração, mas
 * ficam inválidos se o usuário remover o app.
 *
 * Trigger: cron semanal (sugerido: toda segunda-feira às 06:00)
 * Também pode ser chamado manualmente via POST.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("[refresh-meta-page-tokens] Starting validation run");

  try {
    // Buscar todas as páginas ativas (última verificação há mais de 7 dias ou nunca verificada)
    const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: pages, error: fetchErr } = await supabase
      .from("tenant_meta_pages")
      .select("id, tenant_id, page_id, page_name, page_access_token, last_refreshed_at")
      .eq("is_active", true)
      .or(`last_refreshed_at.is.null,last_refreshed_at.lt.${threshold}`)
      .limit(100);

    if (fetchErr) throw fetchErr;
    if (!pages?.length) {
      console.log("[refresh-meta-page-tokens] No pages to validate");
      return new Response(JSON.stringify({ validated: 0, revoked: 0 }), { headers: corsHeaders });
    }

    console.log(`[refresh-meta-page-tokens] Validating ${pages.length} pages`);

    let validated = 0;
    let revoked   = 0;

    for (const page of pages) {
      try {
        // Verificar se o token ainda é válido — buscar nome da página
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${page.page_id}?fields=id,name&access_token=${page.page_access_token}`
        );
        const data = await res.json();

        if (data.error) {
          // Token inválido ou revogado
          console.warn(`[refresh-meta-page-tokens] Token revoked for page ${page.page_name} (${page.page_id})`);

          await supabase
            .from("tenant_meta_pages")
            .update({
              is_active:  false,
              updated_at: new Date().toISOString(),
            })
            .eq("id", page.id);

          revoked++;
        } else {
          // Token válido — atualizar last_refreshed_at
          await supabase
            .from("tenant_meta_pages")
            .update({ last_refreshed_at: new Date().toISOString() })
            .eq("id", page.id);

          validated++;
        }
      } catch (pageErr: any) {
        console.error(`[refresh-meta-page-tokens] Error checking page ${page.page_id}:`, pageErr.message);
      }
    }

    const result = { validated, revoked };
    console.log("[refresh-meta-page-tokens] Done:", result);
    return new Response(JSON.stringify(result), { headers: corsHeaders });

  } catch (err: any) {
    console.error("[refresh-meta-page-tokens] Fatal:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
