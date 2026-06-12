/**
 * telnyx-numbers — Edge Function
 *
 * API para comprar e gerenciar números de telefone Telnyx por tenant.
 *
 * GET  /telnyx-numbers?action=search&country=BR&limit=10
 *      &type=local|toll_free|mobile|national|shared_cost   (opcional)
 *      &ndc=11           (código de área / DDD, opcional)
 *      &locality=São+Paulo   (cidade, opcional)
 *      &state=SP             (estado/província — apenas US/CA, opcional)
 * POST /telnyx-numbers  { action: "purchase", phone_number: "+5511..." }
 * POST /telnyx-numbers  { action: "release",  number_id: "..." }
 * POST /telnyx-numbers  { action: "update",   number_id: "...", friendly_name: "..." }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import {
  searchAvailableNumbers,
  purchaseNumber,
  releaseNumber,
  getPhoneNumber,
  getPhoneNumberByNumber,
} from "../_shared/telnyxClient.ts";
import { getTelnyxApiKey, getTelnyxConnectionId } from "../_shared/masterConfig.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Buscar tenant do usuário
    const { data: member } = await supabase
      .from("members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) return json({ error: "Tenant not found" }, 404);

    // Somente admin/owner pode gerenciar números
    if (!["owner", "admin"].includes(member.role)) {
      return json({ error: "Insufficient permissions" }, 403);
    }

    const tenantId = member.tenant_id;

    // Buscar API key do tenant ou usar a master
    const { data: tenant } = await supabase
      .from("tenants")
      .select("telnyx_api_key, telnyx_app_id")
      .eq("id", tenantId)
      .single();

    // Prioridade: tenant key → Supabase Secret → master_config (UI)
    const apiKey       = await getTelnyxApiKey(supabase, tenant?.telnyx_api_key);
    const connectionId = await getTelnyxConnectionId(supabase, tenant?.telnyx_app_id);

    if (!apiKey) return json({ error: "Telnyx not configured. Set TELNYX_API_KEY in /master/intelligence" }, 400);

    // ── GET: buscar números disponíveis ──────────────────────────────────────
    if (req.method === "GET") {
      const url      = new URL(req.url);
      const country  = url.searchParams.get("country") ?? "BR";
      const limit    = parseInt(url.searchParams.get("limit") ?? "10");
      const ndc      = url.searchParams.get("ndc") ?? undefined;       // DDD / código de área
      const type     = url.searchParams.get("type") ?? undefined;      // local | toll_free | mobile | national | shared_cost
      const locality = url.searchParams.get("locality") ?? undefined;  // cidade
      const state    = url.searchParams.get("state") ?? undefined;     // estado/província (US/CA)

      let numbers: any[] = [];
      try {
        numbers = await searchAvailableNumbers(apiKey, country, ["voice", "sms"], limit, ndc, type, locality, state);
      } catch (telnyxErr: any) {
        const msg = telnyxErr.message ?? "Telnyx API error";
        const lower = msg.toLowerCase();
        if (lower.includes("no coverage found") || lower.includes("no results") || lower.includes("not found in the specified country")) {
          return json({ data: [], message: `Nenhum número disponível em ${country} com voz+SMS` });
        }
        const isAuthErr = lower.includes("401") || lower.includes("unauthorized") || lower.includes("authentication") || lower.includes("not authorized");
        if (isAuthErr) {
          return json({ error: "Chave Telnyx inválida. Verifique TELNYX_API_KEY em /master/intelligence" }, 400);
        }
        return json({ error: `Telnyx: ${msg}` }, 502);
      }
      return json({ data: numbers });
    }

    // ── POST: ações ──────────────────────────────────────────────────────────
    const body = await req.json();
    const { action } = body;

    if (action === "purchase") {
      const { phone_number, friendly_name } = body;
      if (!phone_number) return json({ error: "phone_number required" }, 400);

      // Comprar na Telnyx
      const result = await purchaseNumber(apiKey, phone_number, connectionId || undefined);

      // Salvar no banco
      const { data: saved, error: saveErr } = await supabase
        .from("tenant_phone_numbers")
        .insert({
          tenant_id:        tenantId,
          phone_number:     phone_number,
          telnyx_number_id: result.id,
          friendly_name:    friendly_name ?? null,
          country_code:     phone_number.startsWith("+1") ? "US" :
                            phone_number.startsWith("+55") ? "BR" :
                            phone_number.startsWith("+44") ? "GB" :
                            phone_number.startsWith("+52") ? "MX" : "OTHER",
          is_active:        true,
          capabilities:     { voice: true, sms: true },
        })
        .select()
        .single();

      if (saveErr) throw new Error(`DB save failed: ${saveErr.message}`);

      console.log(`[telnyx-numbers] ✓ Purchased ${phone_number} for tenant ${tenantId}`);
      return json({ data: saved });
    }

    if (action === "release") {
      const { number_id } = body;
      if (!number_id) return json({ error: "number_id required" }, 400);

      // FIX C2: tenant_id obrigatório para evitar que admin de outro tenant delete números alheios
      const { data: numRow } = await supabase
        .from("tenant_phone_numbers")
        .select("telnyx_number_id, phone_number")
        .eq("id", number_id)
        .eq("tenant_id", tenantId)   // ← isolamento multi-tenant
        .single();

      if (!numRow) return json({ error: "Number not found" }, 404);

      await releaseNumber(apiKey, numRow.telnyx_number_id);

      await supabase
        .from("tenant_phone_numbers")
        .update({ is_active: false, released_at: new Date().toISOString() })
        .eq("id", number_id);

      return json({ success: true });
    }

    if (action === "update") {
      const { number_id, friendly_name } = body;
      if (!number_id) return json({ error: "number_id required" }, 400);

      await supabase
        .from("tenant_phone_numbers")
        .update({ friendly_name, updated_at: new Date().toISOString() })
        .eq("id", number_id)
        .eq("tenant_id", tenantId);

      return json({ success: true });
    }

    if (action === "sync") {
      // 1. Buscar números locais do tenant (que não foram excluídos/released)
      const { data: localNumbers, error: numErr } = await supabase
        .from("tenant_phone_numbers")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("released_at", null);

      if (numErr) throw numErr;

      // 2. Buscar pedidos de compra de número locais pendentes do tenant
      const { data: localOrders, error: ordErr } = await supabase
        .from("number_order_requests")
        .select("*")
        .eq("tenant_id", tenantId)
        .not("status", "in", '("completed","cancelled")');

      if (ordErr) throw ordErr;

      const syncedNumbers = [];
      const loopErrors = [];
      const orderSyncErrors = [];

      // Sincronizar status de cada número de telefone
      for (const num of (localNumbers ?? [])) {
        try {
          let telnyxNum: any = null;
          if (num.telnyx_number_id) {
            try {
              telnyxNum = await getPhoneNumber(apiKey, num.telnyx_number_id);
            } catch (err: any) {
              const msg = (err.message ?? "").toLowerCase();
              if (msg.includes("404") || msg.includes("not found") || msg.includes("could not be found")) {
                try {
                  telnyxNum = await getPhoneNumberByNumber(apiKey, num.phone_number);
                } catch (err2: any) {
                  console.error(`[telnyx-numbers] Fallback search failed for ${num.phone_number}:`, err2.message);
                  loopErrors.push({ phone: num.phone_number, step: "fallback", error: err2.message });
                }
              } else {
                throw err;
              }
            }
          } else {
            telnyxNum = await getPhoneNumberByNumber(apiKey, num.phone_number);
          }

          if (telnyxNum) {
            const isTelnyxActive = telnyxNum.status === "active";
            const updatePayload: any = {
              updated_at: new Date().toISOString(),
            };

            if (num.is_active !== isTelnyxActive) {
              updatePayload.is_active = isTelnyxActive;
            }
            if (telnyxNum.id && num.telnyx_number_id !== telnyxNum.id) {
              updatePayload.telnyx_number_id = telnyxNum.id;
            }

            if (Object.keys(updatePayload).length > 1) {
              await supabase
                .from("tenant_phone_numbers")
                .update(updatePayload)
                .eq("id", num.id);
            }

            syncedNumbers.push({
              phone_number: num.phone_number,
              is_active: isTelnyxActive,
              status: telnyxNum.status,
            });

            // Se o número agora está ativo na Telnyx, marcar o pedido correspondente como concluído
            if (isTelnyxActive) {
              const matchedOrder = (localOrders ?? []).find(o => o.phone_number === num.phone_number);
              if (matchedOrder) {
                await supabase
                  .from("number_order_requests")
                  .update({
                    status: "completed",
                    approved_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", matchedOrder.id);

                // Notificar via realtime
                await supabase.channel(`orders:${tenantId}`).send({
                  type: "broadcast",
                  event: "number_order_completed",
                  payload: { order_id: matchedOrder.id, phone_number: num.phone_number },
                });
              }
            } else {
              // Se não está ativo, mas tem pedido pendente, atualizar o status do pedido se houve erro
              const matchedOrder = (localOrders ?? []).find(o => o.phone_number === num.phone_number);
              if (matchedOrder) {
                let newStatus = "under_review";
                let rejectionReason = null;

                if (telnyxNum.status === "requirement-info-pending") {
                  newStatus = "rejected";
                  rejectionReason = "A Telnyx exige informações adicionais (nome, endereço ou documentos) para este número.";
                } else if (telnyxNum.status === "requirement-info-exception") {
                  newStatus = "rejected";
                  rejectionReason = "Documentação ou dados rejeitados. Por favor, revise e envie novamente.";
                }

                if (matchedOrder.status !== newStatus || matchedOrder.rejection_reason !== rejectionReason) {
                  await supabase
                    .from("number_order_requests")
                    .update({
                      status: newStatus,
                      rejection_reason: rejectionReason,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", matchedOrder.id);

                  if (newStatus === "rejected") {
                    await supabase.channel(`orders:${tenantId}`).send({
                      type: "broadcast",
                      event: "number_order_rejected",
                      payload: { order_id: matchedOrder.id, phone_number: num.phone_number, reason: rejectionReason },
                    });
                  }
                }
              }
            }
          } else {
            // Número não existe na Telnyx (excluído/liberado)
            await supabase
              .from("tenant_phone_numbers")
              .update({
                is_active: false,
                released_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", num.id);

            syncedNumbers.push({
              phone_number: num.phone_number,
              is_active: false,
              status: "released",
            });

            // Se tem pedido associado, cancelá-lo
            const matchedOrder = (localOrders ?? []).find(o => o.phone_number === num.phone_number);
            if (matchedOrder) {
              await supabase
                .from("number_order_requests")
                .update({
                  status: "cancelled",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", matchedOrder.id);
            }
          }
        } catch (err: any) {
          console.error(`[telnyx-numbers] Sync failed for number ${num.phone_number}:`, err.message);
          loopErrors.push({ phone: num.phone_number, error: err.message });
        }
      }

      // Sincronizar status de pedidos que não possuem linha em tenant_phone_numbers (raro, mas possível se falhou na criação)
      for (const order of (localOrders ?? [])) {
        const hasNumberRecord = (localNumbers ?? []).some(n => n.phone_number === order.phone_number);
        if (!hasNumberRecord && order.telnyx_order_id) {
          try {
            // Buscar detalhes da ordem na Telnyx para recuperar o número e ver se já foi ativado
            const resOrder = await fetch(`https://api.telnyx.com/v2/number_orders/${order.telnyx_order_id}`, {
              headers: { "Authorization": `Bearer ${apiKey}` }
            });
            if (resOrder.ok) {
              const orderData = await resOrder.json();
              const orderStatus = orderData.data?.status; // "pending" | "success" | "failure"
              
              if (orderStatus === "success" || orderStatus === "successful") {
                // Ativar número
                await supabase.from("tenant_phone_numbers").upsert({
                  tenant_id: tenantId,
                  phone_number: order.phone_number,
                  country_code: order.country_code,
                  is_active: true,
                  capabilities: { voice: true, sms: true },
                }, { onConflict: "tenant_id,phone_number" });

                await supabase
                  .from("number_order_requests")
                  .update({
                    status: "completed",
                    approved_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", order.id);

                await supabase.channel(`orders:${tenantId}`).send({
                  type: "broadcast",
                  event: "number_order_completed",
                  payload: { order_id: order.id, phone_number: order.phone_number },
                });
              } else if (orderStatus === "failure" || orderStatus === "failed") {
                const reason = orderData.data?.errors?.[0]?.description ?? "Rejeitado pela operadora";
                await supabase
                  .from("number_order_requests")
                  .update({
                    status: "rejected",
                    rejection_reason: reason,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", order.id);

                await supabase.channel(`orders:${tenantId}`).send({
                  type: "broadcast",
                  event: "number_order_rejected",
                  payload: { order_id: order.id, phone_number: order.phone_number, reason },
                });
              }
            } else {
              const text = await resOrder.text();
              orderSyncErrors.push({ order_id: order.id, status: resOrder.status, response: text });
            }
          } catch (err: any) {
            console.error(`[telnyx-numbers] Sync failed for order ${order.id}:`, err.message);
            orderSyncErrors.push({ order_id: order.id, error: err.message });
          }
        }
      }

      // Notificar frontend via broadcast geral de recarregamento
      await supabase.channel(`orders:${tenantId}`).send({
        type: "broadcast",
        event: "sync_completed",
        payload: { tenant_id: tenantId },
      });

      return json({
        success: true,
        numbers: syncedNumbers,
        debug: {
          tenantId,
          localNumbersCount: localNumbers?.length,
          localOrdersCount: localOrders?.length,
          numErr,
          ordErr,
          loopErrors,
          orderSyncErrors
        }
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err: any) {
    console.error("[telnyx-numbers] Error:", err.message);
    return json({ error: err.message }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
