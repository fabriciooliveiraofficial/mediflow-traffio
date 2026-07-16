/**
 * journeyStage — IA consciente de jornada (docs/ROADMAP_PRODUTO_2026.md, item 6).
 *
 * O agente (F1 rascunho + F3 autônomo) muda de ABORDAGEM conforme o estágio
 * do funil CRM da conversa — nunca a política de preço, que continua
 * absoluta em qualquer estágio. Fonte da verdade dos estágios:
 * src/lib/crmStages.ts (frontend) / public.crm_stages (SQL) — espelhado aqui
 * porque edge functions não importam de src/.
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

export const CRM_STAGES = [
    "new_lead", "in_contact", "scheduled", "showed_up",
    "proposal", "recovery", "recall_due", "won", "lost",
] as const;

export type CrmStageId = (typeof CRM_STAGES)[number];

/**
 * new_lead/in_contact ficam de fora de propósito: a persona padrão
 * (SALES_PERSONA) já é "vender a avaliação" — injetar texto aqui só
 * repetiria o que já existe.
 */
export const STAGE_GUIDANCE: Partial<Record<CrmStageId, string>> = {
    scheduled: "Este paciente já tem uma avaliação agendada. NÃO reabra o convite para agendar — ele já decidiu. Foque em confirmar detalhes (data, local, preparo) e tirar dúvidas finais. Só sugira remarcar se ele pedir.",
    showed_up: "Este paciente já compareceu à avaliação e está aguardando o próximo passo (orçamento ou retorno). Seja acolhedora e prestativa; não empurre uma nova venda — se ele perguntar sobre orçamento, direcione com naturalidade para a equipe.",
    proposal: "Este paciente recebeu um orçamento e ainda não decidiu. Reforce o VALOR do que foi proposto (resultado, benefício, segurança) e ajude a remover a dúvida ou objeção que está travando — sem pressa artificial nem repetir preço (a política de preço continua absoluta). Pergunte o que pode esclarecer para ele avançar.",
    recovery: "Este paciente faltou a um agendamento recente. ZERO culpa ou cobrança — nunca mencione a falta como problema dele. Acolha com leveza e ofereça remarcar agora, no tom de quem está ajudando, não cobrando.",
    recall_due: "Faz tempo que este paciente não vem à clínica. Reative o contato com cuidado genuíno (pergunte como ele está, sem tom comercial) e, se fizer sentido na conversa, convide para um retorno — sem pressão de venda.",
    won: "Este é um paciente ativo/convertido. Seu papel aqui é SERVIR, não vender: responda dúvidas, ajude com o que ele precisar. Só mencione novos procedimentos se ele perguntar primeiro.",
    lost: "Esta jornada foi marcada como perdida anteriormente, mas o paciente voltou a escrever — trate como um novo começo, sem mencionar o histórico. Siga o método padrão de acolhimento.",
};

/**
 * Busca o estágio da jornada CRM ligada a esta sessão de conversa
 * (crm_journeys.session_id — FK populada pelo trigger
 * crm_trg_conversation_sessions/crm_ensure_journey). Best-effort: sessão
 * sem jornada ainda (race rara) ou erro de query → guidance null,
 * comportamento idêntico ao agente sem esta feature (fail-safe).
 */
export async function fetchStageGuidance(
    supabase: SupabaseClient,
    sessionId: string,
): Promise<{ stage: CrmStageId | null; guidance: string | null }> {
    try {
        const { data } = await supabase
            .from("crm_journeys")
            .select("stage_id")
            .eq("session_id", sessionId)
            .maybeSingle();
        const stage = (data?.stage_id as CrmStageId) ?? null;
        return { stage, guidance: stage ? (STAGE_GUIDANCE[stage] ?? null) : null };
    } catch {
        return { stage: null, guidance: null };
    }
}
