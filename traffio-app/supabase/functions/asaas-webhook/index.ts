import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * asaas-webhook — Edge Function
 *
 * Listener seguro para notificações da API Asaas.
 * Processa eventos de pagamento e atualiza billing_records / billing_installments.
 *
 * Eventos tratados:
 *   PAYMENT_RECEIVED   — cobrança paga (PIX/boleto)
 *   PAYMENT_CONFIRMED  — cartão confirmado
 *   PAYMENT_OVERDUE    — cobrança vencida
 *   PAYMENT_REFUNDED   — reembolso
 *
 * Segurança:
 *   Valida o header `asaas-auth-token` contra a service role key (primeiros 32 chars)
 *   configurado ao criar o webhook na subconta.
 */

const STATUS_MAP: Record<string, string> = {
  PAYMENT_RECEIVED:  "RECEIVED",
  PAYMENT_CONFIRMED: "CONFIRMED",
  PAYMENT_OVERDUE:   "OVERDUE",
  PAYMENT_REFUNDED:  "REFUNDED",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // ── Webhook token validation ───────────────────────────
    const receivedToken = req.headers.get("asaas-auth-token") ?? "";
    const expectedToken = supabaseServiceKey.slice(0, 32);
    if (receivedToken && receivedToken !== expectedToken) {
      console.warn("[asaas-webhook] Invalid auth token.");
      return new Response("Forbidden", { status: 403 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body     = await req.json();

    const event   = body.event as string;
    const payment = body.payment;

    console.log(`[asaas-webhook] event=${event} paymentId=${payment?.id} installment=${payment?.installment ?? "none"}`);

    const newStatus = STATUS_MAP[event];
    if (!newStatus) {
      return new Response(JSON.stringify({ status: "ignored_event", event }), { status: 200 });
    }

    // ── 1. Update billing_record by asaas_billing_id ──────
    const { data: billing, error: billingError } = await supabase
      .from("billing_records")
      .select(`
        id, tenant_id, status, billing_type, installment_count,
        appointment_id,
        patients ( full_name, phone ),
        appointments ( date, start_time ),
        tenants ( name )
      `)
      .eq("asaas_billing_id", payment.id)
      .maybeSingle();

    // ── 2. Fallback: cobrança de parcela individual ────────
    // Se não encontrou pelo payment.id, pode ser uma parcela de cartão.
    // Tenta achar pelo asaas_payment_id em billing_installments.
    let billingViaInstallment: any = null;
    if (!billing && payment.installment) {
      const { data: installment } = await supabase
        .from("billing_installments")
        .select("billing_record_id, id")
        .eq("asaas_payment_id", payment.id)
        .maybeSingle();

      if (installment) {
        // Atualiza a parcela individual
        await supabase
          .from("billing_installments")
          .update({
            status:  newStatus,
            paid_at: newStatus === "RECEIVED" || newStatus === "CONFIRMED"
              ? new Date().toISOString() : null,
          })
          .eq("id", installment.id);

        // Busca o billing_record pai para checar se todas parcelas foram pagas
        const { data: parentBilling } = await supabase
          .from("billing_records")
          .select(`
            id, tenant_id, status, installment_count,
            appointment_id,
            patients ( full_name, phone ),
            appointments ( date, start_time ),
            tenants ( name )
          `)
          .eq("id", installment.billing_record_id)
          .single();

        billingViaInstallment = parentBilling;

        // Conta quantas parcelas foram pagas
        const { count: paidCount } = await supabase
          .from("billing_installments")
          .select("id", { count: "exact", head: true })
          .eq("billing_record_id", installment.billing_record_id)
          .in("status", ["RECEIVED", "CONFIRMED"]);

        // Se todas parcelas pagas, marca o billing_record como CONFIRMED
        if (paidCount === parentBilling?.installment_count) {
          await supabase
            .from("billing_records")
            .update({ status: "CONFIRMED", paid_at: new Date().toISOString() })
            .eq("id", installment.billing_record_id);
        }
      }
    }

    const activeBilling = billing ?? billingViaInstallment;

    if (!activeBilling) {
      console.warn("[asaas-webhook] billing_record not found for payment:", payment.id);
      // Retorna 200 para o Asaas não ficar retentando (pode ser de outro sistema)
      return new Response(JSON.stringify({ status: "not_found", payment_id: payment.id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Update billing_record status (se não foi via parcela) ──
    if (billing) {
      if (billing.status === newStatus) {
        return new Response(JSON.stringify({ status: "already_processed" }), { status: 200 });
      }

      await supabase
        .from("billing_records")
        .update({
          status:  newStatus,
          paid_at: newStatus === "RECEIVED" || newStatus === "CONFIRMED"
            ? new Date().toISOString() : null,
        })
        .eq("id", billing.id);
    }

    // ── 4. Atualiza consulta vinculada ─────────────────────
    let appointmentInfo = "";
    const isPaid = newStatus === "RECEIVED" || newStatus === "CONFIRMED";

    if (activeBilling.appointment_id && isPaid) {
      await supabase
        .from("appointments")
        .update({ status: "confirmed" })
        .eq("id", activeBilling.appointment_id);

      const appt = (activeBilling as any).appointments;
      if (appt) {
        const dateStr = new Date(appt.date).toLocaleDateString("pt-BR");
        appointmentInfo = ` para sua consulta no dia ${dateStr} às ${String(appt.start_time).substring(0, 5)}`;
      }
    }

    // ── 5. Notifica paciente via WhatsApp ──────────────────
    const patient    = (activeBilling as any).patients;
    const tenantName = (activeBilling as any).tenants?.name ?? "Clínica";

    if (patient?.phone) {
      const outbox = new OutboxDispatcher(supabase);

      let message = "";
      if (isPaid) {
        const methodLabel =
          activeBilling.billing_type === "PIX"         ? "PIX"                       :
          activeBilling.billing_type === "CREDIT_CARD" ? "cartão de crédito"         :
          activeBilling.billing_type === "BOLETO"      ? "boleto"                    : "pagamento";

        message = `✅ Olá ${patient.full_name}! Recebemos seu ${methodLabel}${appointmentInfo}. Seu agendamento está confirmado. Obrigado pela confiança! 😊`;
      } else if (newStatus === "OVERDUE") {
        message = `⚠️ Olá ${patient.full_name}, seu boleto venceu. Acesse o link para gerar a segunda via ou entre em contato com ${tenantName}.`;
      }

      if (message) {
        await outbox.enqueue(activeBilling.tenant_id, patient.phone, { text: message });
      }
    }

    return new Response(
      JSON.stringify({ status: "processed", event, new_status: newStatus }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[asaas-webhook] Error:", err.message);
    return new Response(err.message, { status: 500 });
  }
});
