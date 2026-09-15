/**
 * aiBudget — gate econômico da IA por tenant (docs/PLANO_MONETIZACAO_IA_2026-09.md).
 *
 * Regra de negócio: piso de 35% de margem em QUALQUER cenário. A franquia do
 * plano é um ORÇAMENTO DE CUSTO (1 conversa = AI_CONVERSATION_UNIT_BRL de custo
 * real), não uma contagem de respostas — assim o tenant nunca gasta mais do que
 * franquia × unidade, independente de cache, dólar ou modelo. O cálculo mora no
 * banco (ai_budget_status / ai_usage_debit_credits); aqui só se consulta e
 * decide, ANTES de qualquer chamada de LLM do turno.
 *
 * Fail-open deliberado: se o banco não responder, a IA segue com aviso no log.
 * Travar o caminho crítico de receita por um soluço de infra custaria mais que
 * um turno fora do orçamento — o teto diário (AI_DAILY_CAP_BRL) e o spend limit
 * da conta Anthropic são a rede de segurança para esse caso.
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { sendEmail } from "./email.ts";
import { getAiPhoneTurnsPerHour } from "./masterConfig.ts";

export type AiBudgetReason =
    | "ok"
    | "quota_exhausted"        // franquia do mês + créditos zerados
    | "daily_cap"              // teto diário de custo do tenant atingido
    | "subscription_inactive"  // suspenso/cancelado/trial vencido — ninguém pagando
    | "phone_rate_limit";      // mesmo telefone acima do limite de respostas/hora (anti-loop)

export interface AiBudgetStatus {
    allowed: boolean;
    reason: Exclude<AiBudgetReason, "phone_rate_limit">;
    included_units: number;
    used_units: number;
    credit_units: number;
    remaining_units: number;
    spent_month_brl: number;
    spent_today_brl: number;
    daily_cap_brl: number;
    unit_brl: number;
    period_start: string;
}

export interface AiGateResult {
    allowed: boolean;
    reason: AiBudgetReason;
    status: AiBudgetStatus | null;
}

const ALLOWED_FALLBACK: AiGateResult = { allowed: true, reason: "ok", status: null };

export async function getAiBudgetStatus(supabase: SupabaseClient, tenantId: string): Promise<AiBudgetStatus | null> {
    try {
        const { data, error } = await supabase.rpc("ai_budget_status", { p_tenant: tenantId });
        if (error) {
            console.warn(`[aiBudget] ai_budget_status falhou (fail-open): ${error.message}`);
            return null;
        }
        return data as AiBudgetStatus;
    } catch (err: any) {
        console.warn(`[aiBudget] ai_budget_status exceção (fail-open): ${err?.message}`);
        return null;
    }
}

/**
 * Decide se a IA pode gastar por este tenant agora. Com `phone`, aplica também
 * o rate limit por telefone (AI_PHONE_TURNS_PER_HOUR) — um robô/loop num único
 * número não pode queimar a franquia da clínica inteira.
 */
export async function checkAiAllowed(
    supabase: SupabaseClient,
    tenantId: string,
    opts: { phone?: string } = {},
): Promise<AiGateResult> {
    const status = await getAiBudgetStatus(supabase, tenantId);
    if (status && !status.allowed) {
        return { allowed: false, reason: status.reason, status };
    }

    if (opts.phone) {
        try {
            const limit = await getAiPhoneTurnsPerHour(supabase);
            if (limit > 0) {
                const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
                const { count } = await supabase
                    .from("agent_turn_events")
                    .select("id", { count: "exact", head: true })
                    .eq("tenant_id", tenantId)
                    .eq("phone", opts.phone)
                    .eq("route", "agent")
                    .gte("created_at", since);
                if ((count ?? 0) >= limit) {
                    return { allowed: false, reason: "phone_rate_limit", status };
                }
            }
        } catch (err: any) {
            console.warn(`[aiBudget] rate limit por telefone falhou (fail-open): ${err?.message}`);
        }
    }

    return status ? { allowed: true, reason: "ok", status } : ALLOWED_FALLBACK;
}

const REASON_COPY: Record<Exclude<AiBudgetReason, "ok" | "phone_rate_limit">, { subject: string; body: string }> = {
    quota_exhausted: {
        subject: "Sua IA de atendimento pausou: conversas do mês esgotadas",
        body: "As conversas de IA incluídas no seu plano (e os créditos avulsos, se havia) acabaram. " +
              "Até a virada do mês, novas mensagens de pacientes vão direto para a fila humana. " +
              "Para reativar agora, adquira um pacote de conversas em Assinatura.",
    },
    daily_cap: {
        subject: "Sua IA de atendimento pausou até amanhã: teto diário atingido",
        body: "O gasto de IA de hoje atingiu o teto diário de segurança da sua conta. " +
              "As conversas seguem para a fila humana e a IA volta sozinha amanhã. " +
              "Se esse volume é esperado, fale com o suporte para ajustar o teto.",
    },
    subscription_inactive: {
        subject: "Sua IA de atendimento está pausada: assinatura inativa",
        body: "A IA só atende para contas com assinatura ativa ou trial vigente. " +
              "Regularize sua assinatura em Assinatura para reativar o atendimento automático.",
    },
};

/**
 * Avisa o dono do tenant que a IA está pausada — no máximo 1× a cada 24h por
 * motivo (evita um e-mail por mensagem recebida). Best-effort absoluto: nunca
 * lança, nunca afeta o turno. O rate limit por telefone não avisa: é pontual
 * de um número, não da conta.
 */
export async function notifyAiPaused(
    supabase: SupabaseClient,
    tenantId: string,
    reason: AiBudgetReason,
    status: AiBudgetStatus | null,
): Promise<void> {
    if (reason === "ok" || reason === "phone_rate_limit") return;
    try {
        const { data: wallet } = await supabase
            .from("tenant_ai_wallets")
            .select("last_alert_at, last_alert_reason")
            .eq("tenant_id", tenantId)
            .maybeSingle();
        const lastAt = wallet?.last_alert_at ? Date.parse(wallet.last_alert_at) : 0;
        if (wallet?.last_alert_reason === reason && Date.now() - lastAt < 24 * 60 * 60 * 1000) return;

        await supabase
            .from("tenant_ai_wallets")
            .upsert({ tenant_id: tenantId, last_alert_at: new Date().toISOString(), last_alert_reason: reason }, { onConflict: "tenant_id" });

        const { data: owner } = await supabase
            .from("members")
            .select("user_id")
            .eq("tenant_id", tenantId)
            .eq("role", "owner")
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();
        if (!owner?.user_id) return;
        const { data: profile } = await supabase
            .from("profiles")
            .select("email, full_name")
            .eq("id", owner.user_id)
            .maybeSingle();
        if (!profile?.email) return;

        const copy = REASON_COPY[reason];
        const appUrl = Deno.env.get("APP_URL") ?? "https://app.traffio.com.br";
        const usage = status
            ? `<p style="color:#64748b;font-size:13px">Uso do mês: ${status.used_units.toFixed(1)} de ${status.included_units} conversas incluídas · créditos: ${status.credit_units.toFixed(1)} · gasto hoje: R$ ${status.spent_today_brl.toFixed(2)}</p>`
            : "";
        await sendEmail({
            to: profile.email,
            subject: copy.subject,
            html: `
              <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
                <h2 style="font-size:20px">Olá${profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}!</h2>
                <p>${copy.body}</p>
                ${usage}
                <p><a href="${appUrl}/billing" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:700">Ver assinatura e pacotes</a></p>
                <p style="color:#64748b;font-size:12px">Nenhuma mensagem de paciente se perde: enquanto a IA está pausada, tudo cai na fila humana do seu Inbox.</p>
              </div>`,
        });
        console.log(`[aiBudget] aviso "${reason}" enviado ao tenant ${tenantId}`);
    } catch (err: any) {
        console.warn(`[aiBudget] notifyAiPaused falhou (non-fatal): ${err?.message}`);
    }
}
