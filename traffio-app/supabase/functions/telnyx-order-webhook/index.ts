/**
 * telnyx-order-webhook — Edge Function (--no-verify-jwt)
 *
 * Recebe callbacks da Telnyx quando o status de um pedido de número muda.
 * Payload: { data: { event_type: "number_order.updated", payload: { id, status, ... } } }
 *
 * Fluxo:
 *   status=success  → ativa número em tenant_phone_numbers + marca order completed
 *   status=failure  → marca order rejected + salva motivo
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const eventType = body?.data?.event_type ?? "";
    const payload   = body?.data?.payload ?? body?.data?.object ?? {};

    console.log(`[telnyx-order-webhook] Event: ${eventType}`);

    if (!["number_order.updated", "number_order.created"].includes(eventType)) {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    const telnyxOrderId = payload.id;
    const status        = payload.status; // "pending" | "success" | "failure"

    if (!telnyxOrderId || !status) {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // Buscar pedido interno pelo telnyx_order_id
    const { data: order } = await supabase
      .from("number_order_requests")
      .select("id, tenant_id, phone_number, country_code")
      .eq("telnyx_order_id", telnyxOrderId)
      .maybeSingle();

    if (!order) {
      console.warn(`[telnyx-order-webhook] No order found for telnyx_order_id: ${telnyxOrderId}`);
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    if (status === "success" || status === "successful") {
      const phoneNumbers: string[] = (payload.phone_numbers ?? []).map((n: any) => n.phone_number ?? n);
      const phoneNumber = phoneNumbers[0] ?? order.phone_number;

      // Ativar número no banco
      await supabase.from("tenant_phone_numbers").upsert({
        tenant_id:    order.tenant_id,
        phone_number: phoneNumber,
        country_code: order.country_code,
        is_active:    true,
        capabilities: { voice: true, sms: true },
      }, { onConflict: "tenant_id,phone_number" });

      // Marcar pedido como completed
      await supabase
        .from("number_order_requests")
        .update({
          status:      "completed",
          approved_at: new Date().toISOString(),
          updated_at:  new Date().toISOString(),
        })
        .eq("id", order.id);

      // Notificação via Supabase Realtime
      await supabase.channel(`orders:${order.tenant_id}`).send({
        type:    "broadcast",
        event:   "number_order_completed",
        payload: { order_id: order.id, phone_number: phoneNumber },
      });

      console.log(`[telnyx-order-webhook] ✓ Order completed: ${order.id} → ${phoneNumber}`);

    } else if (status === "failure" || status === "failed") {
      const reason = payload.errors?.[0]?.description
        ?? payload.errors?.[0]?.title
        ?? "Pedido rejeitado pela operadora";

      await supabase
        .from("number_order_requests")
        .update({
          status:           "rejected",
          rejection_reason: reason,
          updated_at:       new Date().toISOString(),
        })
        .eq("id", order.id);

      // Notificação de rejeição
      await supabase.channel(`orders:${order.tenant_id}`).send({
        type:    "broadcast",
        event:   "number_order_rejected",
        payload: { order_id: order.id, phone_number: order.phone_number, reason },
      });

      console.log(`[telnyx-order-webhook] ✗ Order rejected: ${order.id} — ${reason}`);
    }

    return new Response("ok", { status: 200, headers: corsHeaders });

  } catch (err: any) {
    console.error("[telnyx-order-webhook] Error:", err.message);
    return new Response("error", { status: 500, headers: corsHeaders });
  }
});
