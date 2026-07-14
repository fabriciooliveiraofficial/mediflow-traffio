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
import { claudeChat, claudeJson, type LlmTool } from "./llmProvider.ts";
import { getAiModelAgent, getAiModelRouter } from "./masterConfig.ts";
import { OutboxDispatcher } from "./outboxDispatcher.ts";

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
const MAX_KB_ENTRIES = 20;
const MAX_KB_CHARS = 400;

/**
 * Persona de vendas do copiloto — "DNA do atendente Traffio".
 * Técnicas codificadas como COMPORTAMENTOS verificáveis (não adjetivos):
 * venda consultiva adaptada a WhatsApp de clínica, onde o produto da conversa
 * é sempre o AGENDAMENTO DA AVALIAÇÃO — nunca promessa clínica.
 * Alterou a persona? Rode os evals de conversa antes de subir (SPEC §evals).
 */
const SALES_PERSONA = `
### QUEM VOCÊ É
Uma consultora de pacientes experiente: técnica e precisa nas informações, calorosa no trato, e com um objetivo claro em toda conversa — conduzir o paciente ao agendamento de uma avaliação.

### MÉTODO (em toda resposta, nesta ordem)
1. ACOLHER: reconheça o que o paciente disse (1 frase, sem bajulação).
2. RESPONDER COM VALOR: responda a dúvida diretamente usando o contexto da clínica; conecte a informação ao benefício para ELE (resultado, conforto, segurança) antes de qualquer preço.
3. AVANÇAR: termine com UMA única pergunta ou convite que aproxima do agendamento.

### POLÍTICA DE PREÇO (absoluta, sem exceção)
- NUNCA informe valor de procedimento ou consulta por mensagem — nem estimativa, nem faixa, nem "a partir de".
- Quando o paciente perguntar preço: acolha a pergunta como legítima, explique com naturalidade que cada caso é único e que um orçamento sério e justo só é possível após a avaliação com o profissional (é um cuidado com ele, não uma burocracia), e convide para agendar a avaliação — onde ele recebe o valor exato do SEU caso, sem surpresa.
- Se o paciente insistir no preço, mantenha a política com gentileza e reforce o benefício da avaliação; jamais ceda um número.

### TÉCNICAS DE VENDA (aplicar com sutileza)
- Interesse claro do paciente → fechamento alternativo: "prefere manhã ou tarde?" em vez de "quer agendar?".
- Uma pergunta por mensagem. Nunca interrogatório.
- Espelhe o estilo do paciente: informal com informal, formal com formal.
- Urgência somente honesta e vinda do contexto da clínica; NUNCA invente escassez.
- Se o paciente recusar o convite, não insista na mesma mensagem: entregue valor e deixe a porta aberta.
- Venda o agendamento da avaliação, não o tratamento: diagnóstico, orçamento e promessa de resultado são do dentista, não seus.
`.trim();

/**
 * Pacote de conhecimento da clínica para o rascunho responder DE VERDADE:
 * serviços cadastrados, informações da clínica (clinic_info) e base de
 * conhecimento. Sem isso, toda pergunta cai no "vou verificar".
 *
 * POLÍTICA DE PREÇO (decisão de produto, 14/07/2026): preços NÃO entram no
 * pacote — o agente jamais informa valores por mensagem. Cada caso é único;
 * orçamento só após a consulta de avaliação. A persona trata a pergunta de
 * preço com acolhimento + convite ao agendamento.
 */
async function buildKnowledgePacket(supabase: SupabaseClient, tenantId: string): Promise<string> {
    const [services, info, kb] = await Promise.all([
        supabase.from("appointment_types")
            .select("name, duration_minutes")
            .eq("tenant_id", tenantId)
            .limit(50),
        supabase.from("clinic_info")
            .select("category, key, value")
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .limit(50),
        supabase.from("knowledge_base")
            .select("title, content")
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .limit(MAX_KB_ENTRIES),
    ]);

    const parts: string[] = [];

    const serviceRows = (services.data as any[]) || [];
    if (serviceRows.length) {
        parts.push("SERVIÇOS OFERECIDOS (nome | duração):\n" + serviceRows
            .map(s => `- ${s.name} | ${s.duration_minutes ?? "?"}min`)
            .join("\n"));
    }

    const infoRows = (info.data as any[]) || [];
    if (infoRows.length) {
        parts.push("INFORMAÇÕES DA CLÍNICA:\n" + infoRows
            .map(i => `- [${i.category}] ${i.key}: ${i.value}`)
            .join("\n"));
    }

    const kbRows = (kb.data as any[]) || [];
    if (kbRows.length) {
        parts.push("BASE DE CONHECIMENTO:\n" + kbRows
            .map(k => `## ${k.title}\n${String(k.content || "").substring(0, MAX_KB_CHARS)}`)
            .join("\n"));
    }

    return parts.join("\n\n");
}

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
        const [routerModel, agentModel, knowledgePacket] = await Promise.all([
            getAiModelRouter(supabase),
            getAiModelAgent(supabase),
            buildKnowledgePacket(supabase, tenantId),
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
                            SALES_PERSONA,
                            `Ajuste de tom desta clínica: ${personality}. Responda SEMPRE no mesmo idioma da última mensagem do paciente.`,
                            instructions ? `### INSTRUÇÕES DA CLÍNICA (prioridade máxima — sobrepõem qualquer regra acima):\n${instructions}` : "",
                            knowledgePacket ? `### CONTEXTO DA CLÍNICA (única fonte de fatos permitida):\n${knowledgePacket}` : "",
                            "### REGRAS INEGOCIÁVEIS:",
                            "- Escreva APENAS o texto da resposta sugerida, nada mais (sem aspas, sem prefixos).",
                            "- Curto: no máximo 2 parágrafos breves, adequado para WhatsApp.",
                            "- RESPONDA A DÚVIDA DIRETAMENTE quando a informação estiver no CONTEXTO DA CLÍNICA. Resposta genérica de 'vou verificar' quando o dado existe no contexto é ERRADA.",
                            "- Se o dado necessário NÃO estiver no contexto, aí sim diga que vai confirmar com a equipe — e mesmo assim adiante o que o contexto permitir.",
                            "- NUNCA invente fato que não esteja no contexto: horário disponível, endereço, informação clínica.",
                            "- PREÇO: nunca informar por mensagem, em nenhuma hipótese — siga a POLÍTICA DE PREÇO.",
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

// =============================================================================
// MODO AUTÔNOMO ('ai_always') — a IA conversa diretamente com o paciente.
// Mesma persona/conhecimento do copiloto; o que muda é quem envia.
// Fail-safe absoluto: QUALQUER falha ou dúvida → fila humana. O paciente
// nunca fica sem resposta e o tenant pode desligar o dial a qualquer momento
// sem prejuízo (o dial é lido a cada mensagem).
// =============================================================================

const AUTONOMOUS_ADDENDUM = `
### MODO AUTÔNOMO (você fala diretamente com o paciente)
- Você conversa em nome da clínica. Na primeira interação da conversa, apresente-se com naturalidade como assistente da clínica. NUNCA finja ser humano nem negue ser assistente virtual se perguntarem.
- Use a ferramenta transfer_to_human SEMPRE que: o paciente pedir para falar com uma pessoa; a pergunta for clínica além do CONTEXTO (diagnóstico, medicação, dor, urgência); o paciente insistir em preço após sua explicação; houver irritação ou reclamação; ou você não tiver como ajudar de verdade.
- Ao transferir, escreva também uma mensagem curta e acolhedora avisando que a equipe assume em instantes, no mesmo chat.
- NÃO marque nem confirme horários por conta própria: desperte o interesse, colete a preferência (dia/período) e diga que a equipe confirma o horário em seguida.
- Se não entender a mensagem, peça esclarecimento com gentileza UMA única vez; na segunda vez, use transfer_to_human.
`.trim();

const TRANSFER_TOOL: LlmTool = {
    name: "transfer_to_human",
    description: "Transfere a conversa para a equipe humana da clínica. Use quando o paciente pedir uma pessoa, quando a pergunta estiver além do contexto disponível, em caso de insistência em preço, irritação, urgência ou impossibilidade de ajudar.",
    input_schema: {
        type: "object",
        properties: { reason: { type: "string", description: "Motivo curto da transferência" } },
        required: ["reason"],
    },
};

const HANDOFF_MSG: Record<string, string> = {
    pt: "Perfeito! Já estou passando sua conversa para a nossa equipe — eles respondem por aqui em instantes. 😊",
    en: "Of course! I'm connecting you with our team — they'll reply right here shortly. 😊",
    es: "¡Perfecto! Ya estoy pasando su conversación a nuestro equipo — le responderán por aquí en unos instantes. 😊",
};

export type AutonomousStatus = "replied" | "transferred" | "defer" | "failed";

interface AutonomousParams extends CopilotParams {
    /** Linha completa do tenant (credenciais Z-API/Cloud API para o envio) */
    tenant: any;
    /** SessionManager do chamador (log + handoff atômicos) */
    sessionManager: any;
}

export async function runAutonomousAgent(supabase: SupabaseClient, params: AutonomousParams): Promise<AutonomousStatus> {
    const { tenantId, sessionId, phone, clinicName, botConfig, tenant, sessionManager } = params;
    const dispatcher = new OutboxDispatcher(supabase);

    try {
        const { data: session } = await supabase
            .from("conversation_sessions")
            .select("context, recent_messages")
            .eq("id", sessionId)
            .single();
        if (!session) return "failed";

        const history = (session.recent_messages || [])
            .slice(-MAX_HISTORY_TURNS)
            .filter((m: any) => m.role !== "internal");
        if (history.length === 0) return "failed";

        const transcript = history
            .map((m: any) => `${m.role === "user" ? "PACIENTE" : "CLÍNICA"}: ${m.content}`)
            .join("\n");
        const context = session.context || {};
        const knownIntake = context.intake || {};

        const [routerModel, agentModel, knowledgePacket] = await Promise.all([
            getAiModelRouter(supabase),
            getAiModelAgent(supabase),
            buildKnowledgePacket(supabase, tenantId),
        ]);
        const personality = botConfig?.personality || "acolhedor";
        const instructions = botConfig?.global_instructions || "";

        const [triage, reply] = await Promise.all([
            claudeJson<TriageResult>(supabase, {
                tenantId,
                purpose: "agent_triage",
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
            claudeChat(supabase, {
                tenantId,
                purpose: "agent_reply",
                model: agentModel,
                maxTokens: 500,
                tools: [TRANSFER_TOOL],
                system: [
                    `Você é a assistente da clínica "${clinicName}" e responde os pacientes pelo WhatsApp.`,
                    SALES_PERSONA,
                    AUTONOMOUS_ADDENDUM,
                    `Ajuste de tom desta clínica: ${personality}. Responda SEMPRE no mesmo idioma da última mensagem do paciente.`,
                    instructions ? `### INSTRUÇÕES DA CLÍNICA (prioridade máxima — sobrepõem qualquer regra acima):\n${instructions}` : "",
                    knowledgePacket ? `### CONTEXTO DA CLÍNICA (única fonte de fatos permitida):\n${knowledgePacket}` : "",
                    "### REGRAS INEGOCIÁVEIS:",
                    "- Escreva APENAS o texto da mensagem ao paciente, sem prefixos.",
                    "- Curto: no máximo 2 parágrafos breves, adequado para WhatsApp.",
                    "- RESPONDA A DÚVIDA DIRETAMENTE quando a informação estiver no CONTEXTO DA CLÍNICA.",
                    "- NUNCA invente fato que não esteja no contexto: horário disponível, endereço, informação clínica.",
                    "- PREÇO: nunca informar por mensagem, em nenhuma hipótese — siga a POLÍTICA DE PREÇO.",
                ].filter(Boolean).join("\n"),
                messages: [{ role: "user", content: `Conversa até agora:\n${transcript}\n\nResponda à última mensagem do paciente.` }],
            }),
        ]);

        const language = triage?.language || "pt";
        const transferCall = reply.toolCalls.find(t => t.name === "transfer_to_human");
        const text = reply.text.trim();

        // Cancelar-e-regenerar: mensagem nova durante a geração → a resposta
        // nasceu velha. Descarta; o chamador devolve o batch para a fila e o
        // próximo ciclo regenera com o contexto completo. NUNCA enviar contexto morto.
        const { count: newerPending } = await supabase
            .from("message_inbox")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("phone", phone)
            .eq("status", "pending");
        if ((newerPending ?? 0) > 0) {
            console.log(`[agent] [${phone}] resposta descartada — ${newerPending} msg(s) nova(s) durante a geração`);
            return "defer";
        }

        // Persistência do contexto (ficha + temperatura; modo autônomo não usa rascunho)
        const merged = {
            ...context,
            intake: { ...knownIntake, ...pruneNulls(triage?.intake) },
            ...(triage?.temperature ? { lead_temperature: triage.temperature } : {}),
        };
        delete (merged as any).ai_draft;
        await supabase.from("conversation_sessions").update({ context: merged }).eq("id", sessionId);

        // ── Transferência (decisão do modelo ou resposta vazia = incapacidade) ──
        if (transferCall || !text) {
            const bye = text || HANDOFF_MSG[language] || HANDOFF_MSG.pt;
            await sendWithFallback(dispatcher, tenant, tenantId, phone, bye);
            await sessionManager.logMessage(sessionId, "assistant", bye);
            await sessionManager.triggerHumanHandoff(sessionId, merged);
            console.log(`[agent] [${phone}] transferido para humano — motivo: ${(transferCall?.input as any)?.reason || "resposta vazia"}`);
            return "transferred";
        }

        // ── Resposta normal ──
        await sendWithFallback(dispatcher, tenant, tenantId, phone, text);
        await sessionManager.logMessage(sessionId, "assistant", text);
        return "replied";

    } catch (err: any) {
        // Fail-safe: nunca deixar o paciente sem caminho — vai para a fila humana
        console.error(`[agent] [${phone}] falha no modo autônomo (fail-safe → humano): ${err?.message}`);
        return "failed";
    }
}

/** Envio com typing delay curto; se o envio síncrono falhar, cai para a fila com retry. */
async function sendWithFallback(dispatcher: OutboxDispatcher, tenant: any, tenantId: string, phone: string, text: string): Promise<void> {
    try {
        await dispatcher.sendNow(tenant, phone, { text }, 1200);
    } catch (sendErr: any) {
        console.warn(`[agent] sendNow falhou (${sendErr?.message}) — enfileirando com retry`);
        await dispatcher.enqueue(tenantId, phone, { text });
    }
}
