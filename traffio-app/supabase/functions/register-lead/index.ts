/**
 * Edge Function: register-lead
 *
 * Recebe: { clinic_name, admin_name, email, phone, plan_id, billing_cycle }
 *
 * Responsabilidades:
 *   1. Grava o lead em registration_leads (service-role, RLS deny-all)
 *   2. Envia e-mail HTML para REGISTRATION_NOTIFY_EMAIL com os dados do formulário
 *   3. Marca email_sent_at em caso de sucesso no envio
 *
 * O lead é gravado mesmo que o e-mail falhe (lead é obrigatório,
 * e-mail é best-effort). Sempre responde 200 quando o lead foi gravado.
 *
 * Variáveis de ambiente necessárias (Supabase Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   REGISTRATION_NOTIFY_EMAIL
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";

type PlanId = "essencial" | "clinica" | "rede";
type BillingCycle = "monthly" | "annual";

const PLAN_NAMES: Record<string, string> = {
  essencial: "Essencial",
  clinica: "Clínica",
  rede: "Rede",
};

const CYCLE_NAMES: Record<string, string> = {
  monthly: "Mensal",
  annual: "Anual",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const notifyEmail = Deno.env.get("REGISTRATION_NOTIFY_EMAIL") ?? "";

    const body = await req.json();
    const clinicName: string = (body.clinic_name ?? "").trim();
    const adminName: string = (body.admin_name ?? "").trim();
    const email: string = (body.email ?? "").trim().toLowerCase();
    const phone: string | null = body.phone ? String(body.phone).trim() : null;
    const planId: PlanId | null = body.plan_id ?? null;
    const billingCycle: BillingCycle | null = body.billing_cycle ?? null;

    if (!clinicName || !adminName || !email) {
      return json({ error: "Campos obrigatórios: clinic_name, admin_name, email" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. Grava o lead (sempre, independente do envio de e-mail) ─────────────
    const { data: lead, error: insertError } = await supabase
      .from("registration_leads")
      .insert({
        clinic_name: clinicName,
        admin_name: adminName,
        email,
        phone,
        plan_id: planId,
        billing_cycle: billingCycle,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[register-lead] insert error:", insertError.message);
      return json({ error: "Erro ao registrar lead" }, 500);
    }

    // ── 2. Envia e-mail de notificação (best-effort) ───────────────────────────
    if (notifyEmail) {
      try {
        const planLabel = planId ? (PLAN_NAMES[planId] ?? planId) : "—";
        const cycleLabel = billingCycle ? (CYCLE_NAMES[billingCycle] ?? billingCycle) : "—";

        const html = `
          <h2>Novo cadastro iniciado na Traffio</h2>
          <table cellpadding="6" cellspacing="0" border="0">
            <tr><td><strong>Clínica:</strong></td><td>${escapeHtml(clinicName)}</td></tr>
            <tr><td><strong>Responsável:</strong></td><td>${escapeHtml(adminName)}</td></tr>
            <tr><td><strong>E-mail:</strong></td><td>${escapeHtml(email)}</td></tr>
            <tr><td><strong>Telefone:</strong></td><td>${escapeHtml(phone ?? "—")}</td></tr>
            <tr><td><strong>Plano selecionado:</strong></td><td>${escapeHtml(planLabel)}</td></tr>
            <tr><td><strong>Ciclo de cobrança:</strong></td><td>${escapeHtml(cycleLabel)}</td></tr>
          </table>
          <p style="color:#999;font-size:12px;">Lead ID: ${lead.id}</p>
        `;

        await sendEmail({
          to: notifyEmail,
          subject: `Novo cadastro: ${clinicName} (${planLabel})`,
          html,
        });

        await supabase
          .from("registration_leads")
          .update({ email_sent_at: new Date().toISOString() })
          .eq("id", lead.id);
      } catch (emailErr: any) {
        console.error("[register-lead] email error:", emailErr.message);
        // não falha a request — o lead já está gravado
      }
    }

    return json({ ok: true, lead_id: lead.id });
  } catch (err: any) {
    console.error("[register-lead] error:", err.message);
    return json({ error: err.message ?? "Erro interno" }, 500);
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
