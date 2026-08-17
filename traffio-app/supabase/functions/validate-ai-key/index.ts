/**
 * Edge Function: validate-ai-key
 *
 * Valida uma chave de API de IA (Anthropic/OpenAI) contra o provedor REAL
 * antes de o painel Master → Intelligence persistí-la em master_config.
 *
 * Motivação (incidente 17/08/2026): uma chave Anthropic inválida salva no
 * painel derrubou o agente da plataforma inteira com HTTP 401 em todas as
 * conversas (livechat + WhatsApp) — o formato estava certo (sk-ant-…), então
 * o guard de prefixo não pegou; só uma chamada real ao provedor pega chave
 * revogada/errada. Validação usa GET /models (custo zero de tokens).
 *
 * Recebe: { provider: "anthropic" | "openai", key: string } + Bearer JWT
 * Responde: { valid: true } | { valid: false, reason: string }
 * Apenas super_admin pode executar (mesmo padrão de extend-tenant-trial).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

const VALIDATION_TIMEOUT_MS = 10_000;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // ── 1. Autenticar caller via JWT + exigir super_admin ─────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Não autenticado" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: jwtErr } = await admin.auth.getUser(jwt);
    if (jwtErr || !user) return json({ error: "Token inválido" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.role !== "super_admin") {
      return json({ error: "Apenas super_admin pode validar chaves" }, 403);
    }

    // ── 2. Validar body ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const provider: string = body.provider;
    const key: string = (body.key ?? "").trim();
    if (provider !== "anthropic" && provider !== "openai") {
      return json({ error: "provider deve ser 'anthropic' ou 'openai'" }, 400);
    }
    if (!key) return json({ error: "key obrigatória" }, 400);

    // ── 3. Chamada real ao provedor (GET /models — zero custo de tokens) ─────
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
    let res: Response;
    try {
      if (provider === "anthropic") {
        res = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
          signal: controller.signal,
        });
      } else {
        res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
      }
    } catch (netErr: any) {
      // Rede/timeout NÃO prova que a chave é inválida — devolve indeterminado
      // como erro 502 pra UI decidir (nunca rejeitar chave boa por instabilidade).
      return json({ error: `Provedor inacessível: ${netErr?.message ?? "timeout"}` }, 502);
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      console.log(`[validate-ai-key] provider=${provider} valid=true by=${user.id}`);
      return json({ valid: true });
    }
    if (res.status === 401 || res.status === 403) {
      console.warn(`[validate-ai-key] provider=${provider} valid=false (HTTP ${res.status}) by=${user.id}`);
      return json({ valid: false, reason: `O provedor ${provider} rejeitou a chave (HTTP ${res.status}) — chave inválida ou revogada.` });
    }
    // 429/5xx do provedor: indeterminado, não rejeitar a chave.
    return json({ error: `Provedor respondeu HTTP ${res.status} — tente novamente.` }, 502);
  } catch (err: any) {
    console.error("[validate-ai-key] error:", err?.message);
    return json({ error: err?.message ?? "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
