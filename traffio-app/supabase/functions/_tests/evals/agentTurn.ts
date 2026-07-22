/**
 * agentTurn — execução de UM turno do agente autônomo contra o contrato REAL de
 * produção (RESPONDER_PACIENTE_TOOL + composeBubbles + loop de ferramentas),
 * com ferramentas mockadas.
 *
 * Extraído de run.ts (2026-07-21) depois que a suíte ficou desatualizada por
 * meses sem ninguém notar — testava um contrato de prosa livre que não existe
 * mais desde a Onda 2. Motivo da extração: run.ts (single-turn) e
 * conversation.ts (multi-turno) precisam executar EXATAMENTE a mesma lógica de
 * turno; duplicá-la nos dois arquivos é como o bug aconteceu da primeira vez.
 *
 * Espelha o loop de `runAutonomousAgent` em `_shared/copilot.ts`. Mudou o loop
 * de produção → mude aqui também.
 */
import { claudeChat, type LlmMessage } from "../../_shared/llmProvider.ts";
import { RESPONDER_PACIENTE_TOOL, TRANSFER_TOOL, composeBubbles, type StructuredReply } from "../../_shared/copilot.ts";
import { SCHEDULING_TOOLS } from "../../_shared/schedulingTools.ts";
import { mockExecuteTool, type MockOptions } from "./mockTools.ts";

export const MAX_TOOL_ROUNDS = 4;
// Espelha AGENT_MAX_TOKENS do copilot.ts (produção) — manter em sincronia
export const AGENT_TURN_MAX_TOKENS = 1500;

// Stub mínimo de supabase: claudeChat só o usa para a chave (env vence) e o
// log de uso (no-op aqui).
export const stubSupabase: any = {
    from: () => ({
        insert: async () => ({ error: null }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
};

export const AGENT_TOOLS = [RESPONDER_PACIENTE_TOOL, TRANSFER_TOOL, ...SCHEDULING_TOOLS];

export interface AgentTurnResult {
    /** Bolhas concatenadas com \n\n — o que o paciente veria como texto único */
    text: string;
    /** Bolhas individuais (contrato responder_paciente), na ordem enviada ao paciente */
    bubbles: string[];
    toolsCalled: string[];
    /** Inputs JSON de cada chamada de agendar (asserções finas, ex.: terceiro) */
    agendarInputs: string[];
    /** Inputs JSON de TODAS as chamadas de ferramenta, por nome. Para asserções
     * que não devem presumir EM QUAL ferramenta um dado caiu — ex.: o nome do
     * dono do telefone vai em atualizar_cadastro_paciente, não em agendar. */
    toolInputs: { name: string; input: string }[];
    transferred: boolean;
    transferReason: string | null;
    cancelRequested: boolean;
    rounds: number;
}

export interface AgentTurnOptions {
    system: string;
    systemCachePrefix?: string;
    /** Transcript já formatado "PACIENTE: ...\nCLÍNICA: ..." */
    transcript: string;
    model: string;
    purpose: string;
    mockOptions?: MockOptions;
}

/**
 * Roda um turno completo: modelo decide ferramenta → executamos (mock) →
 * devolvemos → até o modelo chamar `responder_paciente` sozinho, pedir
 * transferência, pedir cancelamento, ou esgotar MAX_TOOL_ROUNDS.
 */
export async function runAgentTurn(opts: AgentTurnOptions): Promise<AgentTurnResult> {
    const { system, systemCachePrefix, transcript, model, purpose, mockOptions } = opts;
    const tools = AGENT_TOOLS;
    const convo: LlmMessage[] = [
        { role: "user", content: `Conversa até agora:\n${transcript}\n\nResponda à última mensagem do paciente.` },
    ];

    const toolsCalled: string[] = [];
    const agendarInputs: string[] = [];
    const toolInputs: { name: string; input: string }[] = [];
    let transferred = false;
    let transferReason: string | null = null;
    let cancelRequested = false;
    let rounds = 0;

    let reply = await claudeChat(stubSupabase, {
        tenantId: "eval", purpose, model,
        maxTokens: AGENT_TURN_MAX_TOKENS, tools, cacheTools: true, system, cacheableSystemPrefix: systemCachePrefix, messages: convo,
    });

    while (reply.toolCalls.length > 0 && rounds < MAX_TOOL_ROUNDS) {
        rounds++;
        for (const call of reply.toolCalls) {
            toolsCalled.push(call.name);
            const inputJson = JSON.stringify(call.input || {});
            toolInputs.push({ name: call.name, input: inputJson });
            if (call.name === "agendar") agendarInputs.push(inputJson);
        }

        if (reply.toolCalls.some(t => t.name === "transfer_to_human")) {
            transferred = true;
            const call = reply.toolCalls.find(t => t.name === "transfer_to_human")!;
            transferReason = (call.input as any)?.reason || "solicitado pelo modelo";
            break;
        }
        if (reply.toolCalls.some(t => t.name === "encaminhar_cancelamento")) {
            cancelRequested = true;
            break;
        }
        // Produção (copilot.ts): responder_paciente sozinho encerra o loop de ferramentas
        if (reply.toolCalls.some(t => t.name === "responder_paciente") && !reply.toolCalls.some(t => t.name !== "responder_paciente")) break;

        convo.push({ role: "assistant", content: reply.rawContent });
        // Só ferramentas que não sejam responder_paciente geram tool_result — o
        // modelo usa responder_paciente para ESCREVER a resposta, não para agir.
        const nonResponderCalls = reply.toolCalls.filter(t => t.name !== "responder_paciente");
        convo.push({
            role: "user",
            content: nonResponderCalls.map(call => ({
                type: "tool_result",
                tool_use_id: call.id,
                content: JSON.stringify(mockExecuteTool(call, mockOptions).data),
            })),
        });

        reply = await claudeChat(stubSupabase, {
            tenantId: "eval", purpose, model,
            maxTokens: AGENT_TURN_MAX_TOKENS, tools, cacheTools: true, system, cacheableSystemPrefix: systemCachePrefix, messages: convo,
        });
    }

    const responderCall = reply.toolCalls.find(t => t.name === "responder_paciente");
    const bubbles = responderCall ? composeBubbles(responderCall.input as StructuredReply) : composeBubbles(reply.text);
    const text = bubbles.join("\n\n");
    if (!text && !transferred && !cancelRequested) transferred = true; // produção: vazio → handoff

    return { text, bubbles, toolsCalled, agendarInputs, toolInputs, transferred, transferReason, cancelRequested, rounds };
}
