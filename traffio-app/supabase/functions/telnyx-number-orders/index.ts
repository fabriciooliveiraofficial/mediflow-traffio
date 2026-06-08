/**
 * telnyx-number-orders — Edge Function
 *
 * Gerencia o ciclo de vida de pedidos de número com KYC.
 *
 * POST { action: "create_order", phone_number, country_code, holder_type, holder_info, friendly_name }
 *   → Para países sem KYC: compra imediato. Para países com KYC: cria pedido pending_docs.
 *
 * GET  ?action=get_order&order_id=...
 *   → Retorna pedido + documentos + holder_info
 *
 * GET  ?action=list_orders
 *   → Lista pedidos ativos do tenant
 *
 * POST { action: "submit_docs", order_id }
 *   → Marca como docs_submitted, cria order na Telnyx, inicia análise
 *
 * POST { action: "cancel_order", order_id }
 *   → Cancela pedido pendente
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getTelnyxApiKey, getTelnyxConnectionId } from "../_shared/masterConfig.ts";
import { purchaseNumber, createNumberOrder, releaseNumber } from "../_shared/telnyxClient.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Países que exigem KYC antes da compra
const KYC_COUNTRIES = new Set(["BR", "AR", "MX", "CO", "PT", "ES"]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({}, 200);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: member } = await supabase
      .from("members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) return json({ error: "Tenant not found" }, 404);
    if (!["owner", "admin"].includes(member.role)) return json({ error: "Insufficient permissions" }, 403);

    const tenantId = member.tenant_id;

    const { data: tenant } = await supabase
      .from("tenants")
      .select("telnyx_api_key, telnyx_app_id")
      .eq("id", tenantId)
      .maybeSingle();

    const apiKey       = await getTelnyxApiKey(supabase, tenant?.telnyx_api_key);
    const connectionId = await getTelnyxConnectionId(supabase, tenant?.telnyx_app_id);
    if (!apiKey) return json({ error: "Telnyx não configurado. Configure TELNYX_API_KEY em /master/intelligence" }, 400);

    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const url    = new URL(req.url);
      const action = url.searchParams.get("action");

      if (action === "get_order") {
        const orderId = url.searchParams.get("order_id");
        if (!orderId) return json({ error: "order_id required" }, 400);

        const { data: order } = await supabase
          .from("number_order_requests")
          .select("*, number_order_holder_info(*), number_order_documents(*)")
          .eq("id", orderId)
          .eq("tenant_id", tenantId)
          .single();

        if (!order) return json({ error: "Order not found" }, 404);
        return json({ data: order });
      }

      if (action === "list_orders") {
        const { data: orders } = await supabase
          .from("number_order_requests")
          .select("*, number_order_documents(id, document_type, status)")
          .eq("tenant_id", tenantId)
          .not("status", "in", '("completed","cancelled")')
          .order("created_at", { ascending: false });

        return json({ data: orders ?? [] });
      }

      return json({ error: "Unknown action" }, 400);
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    const body = await req.json();
    const { action } = body;

    // ── create_order ─────────────────────────────────────────────────────────
    if (action === "create_order") {
      const { phone_number, country_code, holder_type, holder_info, friendly_name } = body;
      if (!phone_number || !country_code) return json({ error: "phone_number e country_code são obrigatórios" }, 400);

      const needsKyc = KYC_COUNTRIES.has(country_code.toUpperCase());

      if (!needsKyc) {
        // Validar que o número não é um placeholder mascarado
        if (phone_number.includes("-")) {
          return json({ error: "Número inválido. Este número não está disponível para compra. Busque novamente." }, 422);
        }

        // Compra imediata — sem KYC
        let result: any;
        try {
          result = await purchaseNumber(apiKey, phone_number, connectionId || undefined);
        } catch (purchaseErr: any) {
          const msg = (purchaseErr.message ?? "").toLowerCase();
          if (msg.includes("not be found") || msg.includes("not found") || msg.includes("404")) {
            return json({ error: "Número não disponível para compra. Ele pode ter sido reservado por outro cliente. Por favor, busque um novo número." }, 422);
          }
          throw purchaseErr;
        }

        // Salvar no banco — se falhar, liberar o número para não ficar órfão na Telnyx
        const { error: insertErr } = await supabase.from("tenant_phone_numbers").insert({
          tenant_id:        tenantId,
          phone_number:     result.phoneNumber ?? phone_number,
          telnyx_number_id: result.id,
          friendly_name:    friendly_name ?? null,
          country_code:     country_code.toUpperCase(),
          is_active:        true,
          capabilities:     { voice: true, sms: true },
        });

        if (insertErr) {
          // Tentar liberar o número na Telnyx para evitar cobrança
          try {
            await releaseNumber(apiKey, result.id);
            console.error(`[telnyx-number-orders] Released ${phone_number} after DB failure: ${insertErr.message}`);
          } catch (releaseErr: any) {
            console.error(`[telnyx-number-orders] CRITICAL: number ${phone_number} (${result.id}) purchased but NOT saved. Manual release needed. DB error: ${insertErr.message}`);
          }
          throw new Error(`Erro ao salvar número no banco de dados: ${insertErr.message}`);
        }

        await logAudit(supabase, tenantId, user.id, "number_purchased_instant", phone_number);
        console.log(`[telnyx-number-orders] ✓ Instant purchase: ${phone_number} | tenant: ${tenantId}`);
        return json({ data: { instant: true, phone_number: result.phoneNumber ?? phone_number, status: "completed" } });
      }

      // KYC — criar pedido
      const { data: order, error: orderErr } = await supabase
        .from("number_order_requests")
        .insert({
          tenant_id:    tenantId,
          phone_number,
          country_code: country_code.toUpperCase(),
          status:       "pending_docs",
        })
        .select()
        .single();

      if (orderErr || !order) throw new Error(`Erro ao criar pedido: ${orderErr?.message}`);

      // Salvar dados do titular
      if (holder_info && holder_type) {
        await supabase.from("number_order_holder_info").insert({
          order_id:    order.id,
          tenant_id:   tenantId,
          holder_type,
          ...holder_info,
        });
      }

      await logAudit(supabase, tenantId, user.id, "number_order_created", phone_number, { order_id: order.id, country_code });
      console.log(`[telnyx-number-orders] ✓ Order created: ${order.id} | ${phone_number} | tenant: ${tenantId}`);
      return json({ data: { instant: false, order_id: order.id, status: "pending_docs", phone_number } }, 201);
    }

    // ── submit_docs ───────────────────────────────────────────────────────────
    if (action === "submit_docs") {
      const { order_id } = body;
      if (!order_id) return json({ error: "order_id required" }, 400);

      const { data: order } = await supabase
        .from("number_order_requests")
        .select("*")
        .eq("id", order_id)
        .eq("tenant_id", tenantId)
        .single();

      if (!order) return json({ error: "Order not found" }, 404);
      if (!["pending_docs", "rejected"].includes(order.status)) {
        return json({ error: `Pedido não pode ser submetido no status '${order.status}'` }, 400);
      }

      // Criar order formal na Telnyx
      let telnyxOrderId: string | null = null;
      try {
        const telnyxOrder = await createNumberOrder(
          apiKey,
          [order.phone_number],
          connectionId || undefined
        );
        telnyxOrderId = telnyxOrder.id;
      } catch (e: any) {
        console.warn(`[telnyx-number-orders] Telnyx order creation failed (will retry): ${e.message}`);
      }

      await supabase
        .from("number_order_requests")
        .update({
          status:          "docs_submitted",
          telnyx_order_id: telnyxOrderId,
          submitted_at:    new Date().toISOString(),
          updated_at:      new Date().toISOString(),
        })
        .eq("id", order_id);

      await logAudit(supabase, tenantId, user.id, "number_order_docs_submitted", order.phone_number, { order_id, telnyx_order_id: telnyxOrderId });
      console.log(`[telnyx-number-orders] ✓ Docs submitted: ${order_id}`);
      return json({ data: { order_id, status: "docs_submitted" } });
    }

    // ── cancel_order ─────────────────────────────────────────────────────────
    if (action === "cancel_order") {
      const { order_id } = body;
      if (!order_id) return json({ error: "order_id required" }, 400);

      const { data: order } = await supabase
        .from("number_order_requests")
        .select("status, phone_number")
        .eq("id", order_id)
        .eq("tenant_id", tenantId)
        .single();

      if (!order) return json({ error: "Order not found" }, 404);
      if (!["pending_docs", "rejected"].includes(order.status)) {
        return json({ error: "Apenas pedidos pendentes ou rejeitados podem ser cancelados" }, 400);
      }

      await supabase
        .from("number_order_requests")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", order_id);

      await logAudit(supabase, tenantId, user.id, "number_order_cancelled", order.phone_number, { order_id });
      return json({ data: { order_id, status: "cancelled" } });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err: any) {
    console.error("[telnyx-number-orders] Error:", err.message);
    return json({ error: err.message }, 500);
  }
});

async function logAudit(supabase: any, tenantId: string, userId: string, action: string, phone: string, extra?: any) {
  await supabase.from("audit_logs").insert({
    tenant_id:  tenantId,
    user_id:    userId,
    action,
    table_name: "number_order_requests",
    new_data:   { phone_number: phone, ...extra },
  }).catch(() => {});
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
