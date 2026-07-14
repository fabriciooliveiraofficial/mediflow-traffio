/**
 * copilot — Nível 0 do dial de autonomia (docs/SPEC_AGENTE_IA_CLAUDE.md, F1).
 *
 * A IA NUNCA fala com o paciente aqui. Ela trabalha para o atendente:
 *  1. Triagem + extração de ficha (Haiku): lead quente/frio + slot-filling
 *     acumulado em context.intake (alimenta a tela Hoje e o CRM).
 *  2. Rascunho de resposta (Sonnet): salvo em context.ai_draft; o Inbox exibe
 *     "Sugerido pela IA — [Usar] [Descartar]" e o humano decide.
 *
 * Isolamento: qualquer falha aqui é registrada e engolida — o fluxo de
 * mensagens (log + fila humana) jamais depende do copiloto.
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { claudeChat, claudeJson } from "./llmProvider.ts";
import { getAiModelAgent, getAiModelRouter } from "./masterConfig.ts";

interface CopilotParams {
    tenantId: string;
    sessionId: string;
    phone: string;
    clinicName: string;
    botConfig: any;
}

interface TriageResult {
    temperature: "hot" | "warm" | "cold";
    language: string;
    intake: Record<string, unknown>;
}

const MAX_HISTORY_TURNS = 12;

export async function runCopilot(supabase: SupabaseClient, params: CopilotParams): Promise<void> {
    const { tenantId, sessionId, phone, clinicName, botConfig } = params;

    try {
        // Histórico + contexto atuais (a mensagem do paciente já foi logada)
        const { data: session } = await supabase
            .from("conversation_sessions")
            .select("context, recent_messages")
            .eq("id", sessionId)
            .single();
        if (!session) return;

        const history = (session.recent_messages || [])
            .slice(-MAX_HISTORY_TURNS)
            .filter((m: any) => m.role !== "internal");
        if (history.length === 0) return;

        const transcript = history
            .map((m: any) => `${m.role === "user" ? "PACIENTE" : "CLÍNICA"}: ${m.content}`)
            .join("\n");

        const context = session.context || {};
        const knownIntake = context.intake || {};

        // ── 1+2. Triagem (Haiku) e rascunho (Sonnet) em PARALELO ───────────────
        // O rascunho não depende da triagem (o Sonnet espelha o idioma do
        // paciente sozinho) — rodar em série só somava latência.
        const [routerModel, agentModel] = await Promise.all([
            getAiModelRouter(supabase),
            getAiModelAgent(supabase),
        ]);
        const personality = botConfig?.personality || "acolhedor";
        const instructions = botConfig?.global_instructions || "";

        const [triage, draftText] = await Promise.all([
            claudeJson<TriageResult>(supabase, {
                tenantId,
                purpose: "copilot_triage",
                model: routerModel,
                maxTokens: 400,
                system: [
                    "Você classifica conversas de pacientes de uma clínica e extrai dados objetivos.",
                    "Responda APENAS com JSON válido, sem comentários, neste formato:",
                    '{"temperature":"hot|warm|cold","language":"pt|en|es","intake":{"procedure":string|null,"for_whom":string|null,"preferred_window":string|null,"doctor_pref":string|null}}',
                    "temperature: hot = quer agendar/comprar agora; warm = interessado explorando; cold = sem intenção clara.",
                    "intake: extraia SOMENTE o que o paciente disse explicitamente; use null para o que não foi dito.",
                ].join("\n"),
                messages: [{ role: "user", content: `Ficha já conhecida: ${JSON.stringify(knownIntake)}\n\nConversa:\n${transcript}` }],
            }),
            (async () => {
                try {
                    const draft = await claudeChat(supabase, {
                        tenantId,
                        purpose: "copilot_draft",
                        model: agentModel,
                        maxTokens: 500,
                        system: [
                            `Você redige SUGESTÕES de resposta para a equipe da clínica "${clinicName}" — um humano revisa antes de enviar.`,
                            `Tom: ${personality}. Responda SEMPRE no mesmo idioma da última mensagem do paciente.`,
                            instructions ? `Instruções da clínica: ${instructions}` : "",
                            "REGRAS INEGOCIÁVEIS:",
                            "- Escreva APENAS o texto da resposta sugerida, nada mais (sem aspas, sem prefixos).",
                            "- Curto: no máximo 2 parágrafos breves, adequado para WhatsApp.",
                            "- NUNCA invente preço, horário disponível, endereço ou informação clínica. Se a resposta exige um dado que você não tem, escreva a resposta pedindo um momento para verificar.",
                            "- Não prometa nada em nome da clínica além do que está nas instruções.",
                        ].filter(Boolean).join("\n"),
                        messages: [{ role: "user", content: `Conversa até agora:\n${transcript}\n\nRedija a sugestão de resposta da clínica para a última mensagem do paciente.` }],
                    });
                    return draft.text.trim();
                } catch (draftErr: any) {
                    console.warn(`[copilot] draft falhou (non-fatal): ${draftErr?.message}`);
                    return "";
                }
            })(),
        ]);

        // ── 3. Guard anti-rascunho obsoleto (cancelar-e-regenerar do copiloto) ─
        // Se o paciente mandou mensagem nova enquanto gerávamos, este rascunho já
        // nasceu velho — descarta; o próximo ciclo gera outro com o contexto novo.
        let finalDraft = draftText;
        const { count: newerPending } = await supabase
            .from("message_inbox")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("phone", phone)
            .eq("status", "pending");
        if ((newerPending ?? 0) > 0) {
            console.log(`[copilot] [${phone}] rascunho descartado — ${newerPending} msg(s) nova(s) chegaram durante a geração`);
            finalDraft = "";
        }

        // ── 4. Persistência única do contexto (ficha + temperatura + rascunho) ─
        const merged = {
            ...context,
            intake: { ...knownIntake, ...pruneNulls(triage?.intake) },
            ...(triage?.temperature ? { lead_temperature: triage.temperature } : {}),
            ...(finalDraft
                ? { ai_draft: { text: finalDraft, created_at: new Date().toISOString() } }
                : {}),
        };
        const { error } = await supabase
            .from("conversation_sessions")
            .update({ context: merged })
            .eq("id", sessionId);
        if (error) console.warn(`[copilot] context update falhou: ${error.message}`);

    } catch (err: any) {
        // O copiloto nunca derruba o processamento de mensagens
        console.error(`[copilot] [${phone}] falha isolada: ${err?.message}`);
    }
}

/** Slot-filling acumula: null/undefined do extrator nunca apaga valor já conhecido. */
function pruneNulls(obj: Record<string, unknown> | undefined | null): Record<string, unknown> {
    if (!obj) return {};
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}
