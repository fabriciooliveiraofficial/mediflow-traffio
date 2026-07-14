/**
 * run.ts — runner da suíte de evals do agente autônomo (F3).
 *
 * Usa o MODELO REAL com o PROMPT DE PRODUÇÃO (buildAutonomousSystemPrompt) e
 * ferramentas MOCKADAS — nenhuma mensagem é enviada, nenhum banco é tocado.
 *
 * Como rodar (na pasta supabase/functions):
 *   ANTHROPIC_API_KEY=sk-ant-... npx deno run -A _tests/evals/run.ts
 *   (Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."; npx deno run -A _tests/evals/run.ts)
 *
 * Regra do projeto: mudou prompt, modelo ou ferramenta → esta suíte roda ANTES
 * do deploy. Vermelho = não sobe.
 */
import { claudeChat, type LlmMessage } from "../../_shared/llmProvider.ts";
import { buildAutonomousSystemPrompt, TRANSFER_TOOL } from "../../_shared/copilot.ts";
import { SCHEDULING_TOOLS } from "../../_shared/schedulingTools.ts";
import { mockExecuteTool, MOCK_SLOT_TIMES } from "./mockTools.ts";
import { SCENARIOS, type EvalScenario } from "./scenarios.ts";

const MAX_TOOL_ROUNDS = 4;

// Stub mínimo de supabase: claudeChat só o usa para a chave (env vence) e o
// log de uso (no-op aqui).
const stubSupabase: any = {
    from: () => ({
        insert: async () => ({ error: null }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
};

const MODEL = Deno.env.get("AI_MODEL_AGENT") || "claude-sonnet-5";

const KNOWLEDGE_PACKET = [
    "SERVIÇOS OFERECIDOS (nome | duração):",
    "- Limpeza dental | 45min",
    "- Clareamento dental | 60min",
    "- Avaliação inicial | 30min",
    "",
    "INFORMAÇÕES DA CLÍNICA:",
    "- [logistics] endereço: Av. Central, 100 — Centro",
    "- [logistics] estacionamento: Gratuito no local",
].join("\n");

interface RunResult {
    text: string;
    toolsCalled: string[];
    transferred: boolean;
    rounds: number;
}

async function runScenario(s: EvalScenario): Promise<RunResult> {
    const system = buildAutonomousSystemPrompt({
        clinicName: "Clínica Eval",
        personality: "acolhedor",
        instructions: "",
        knowledgePacket: KNOWLEDGE_PACKET,
        todayStr: "2026-07-15",
    });

    const transcript = s.history
        .map(m => `${m.role === "user" ? "PACIENTE" : "CLÍNICA"}: ${m.content}`)
        .join("\n");

    const tools = [TRANSFER_TOOL, ...SCHEDULING_TOOLS];
    const convo: LlmMessage[] = [
        { role: "user", content: `Conversa até agora:\n${transcript}\n\nResponda à última mensagem do paciente.` },
    ];

    const toolsCalled: string[] = [];
    let transferred = false;
    let rounds = 0;

    let reply = await claudeChat(stubSupabase, {
        tenantId: "eval", purpose: `eval:${s.name.split(" ")[0]}`, model: MODEL,
        maxTokens: 600, tools, system, messages: convo,
    });

    while (reply.toolCalls.length > 0 && rounds < MAX_TOOL_ROUNDS) {
        rounds++;
        for (const call of reply.toolCalls) toolsCalled.push(call.name);

        if (reply.toolCalls.some(t => t.name === "transfer_to_human")) { transferred = true; break; }
        if (reply.toolCalls.some(t => t.name === "encaminhar_cancelamento")) break;

        convo.push({ role: "assistant", content: reply.rawContent });
        convo.push({
            role: "user",
            content: reply.toolCalls.map(call => ({
                type: "tool_result",
                tool_use_id: call.id,
                content: JSON.stringify(mockExecuteTool(call, { availabilityFails: s.availabilityFails }).data),
            })),
        });

        reply = await claudeChat(stubSupabase, {
            tenantId: "eval", purpose: `eval:${s.name.split(" ")[0]}`, model: MODEL,
            maxTokens: 600, tools, system, messages: convo,
        });
    }

    const text = reply.text.trim();
    if (!text && !transferred && !toolsCalled.includes("encaminhar_cancelamento")) transferred = true; // produção: vazio → handoff
    return { text, toolsCalled, transferred, rounds };
}

// ─── Asserções ───────────────────────────────────────────────────────────────

const PRICE_PATTERN = /(r\$|us\$|\$\s?\d|€|\d+[.,]\d{2}\b|\b\d{3,}\s?(reais|dólares|dolares|euros)\b|\b(custa|cuesta|costs?)\s+\d)/i;
const TIME_PATTERN = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;

function check(s: EvalScenario, r: RunResult): string[] {
    const failures: string[] = [];
    const lower = r.text.toLowerCase();
    const e = s.expect;

    if (e.noPrice && PRICE_PATTERN.test(r.text)) failures.push(`preço vazou no texto: "${r.text.substring(0, 120)}"`);

    if (e.noInventedTimes) {
        const times = [...r.text.matchAll(TIME_PATTERN)].map(m => m[0]).map(t => (t.length === 4 ? `0${t}` : t));
        const allowed = new Set([...MOCK_SLOT_TIMES, "11:00"]); // 11:00 = consulta existente do mock
        const invented = times.filter(t => !allowed.has(t));
        if (invented.length) failures.push(`horários inventados: ${invented.join(", ")}`);
    }

    for (const tool of e.toolsCalled || []) {
        if (!r.toolsCalled.includes(tool)) failures.push(`ferramenta obrigatória não chamada: ${tool}`);
    }
    for (const tool of e.toolsNotCalled || []) {
        if (r.toolsCalled.includes(tool)) failures.push(`ferramenta proibida chamada: ${tool}`);
    }

    if (e.transfer === true && !r.transferred) failures.push("deveria transferir para humano e não transferiu");
    if (e.transfer === false && r.transferred && !e.transferOk) failures.push("transferiu sem necessidade");

    if (e.textIncludesAny?.length && !r.transferred) {
        if (!e.textIncludesAny.some(sub => lower.includes(sub.toLowerCase()))) {
            failures.push(`texto não contém nenhum de [${e.textIncludesAny.join(", ")}]: "${r.text.substring(0, 120)}"`);
        }
    }
    for (const sub of e.textExcludesAll || []) {
        if (lower.includes(sub.toLowerCase())) failures.push(`texto contém proibido "${sub}"`);
    }

    return failures;
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    console.error("❌ ANTHROPIC_API_KEY não definida no ambiente. Ex.:");
    console.error('   PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."; npx deno run -A _tests/evals/run.ts');
    Deno.exit(2);
}

console.log(`\n═══ Evals do agente autônomo — modelo: ${MODEL} — ${SCENARIOS.length} cenários ═══\n`);

let passed = 0;
const failedNames: string[] = [];

for (const scenario of SCENARIOS) {
    try {
        const result = await runScenario(scenario);
        const failures = check(scenario, result);
        if (failures.length === 0) {
            passed++;
            console.log(`✅ ${scenario.name}`);
            console.log(`   tools=[${result.toolsCalled.join(", ")}] transfer=${result.transferred} rounds=${result.rounds}`);
        } else {
            failedNames.push(scenario.name);
            console.log(`❌ ${scenario.name}`);
            for (const f of failures) console.log(`   → ${f}`);
            console.log(`   texto: "${result.text.substring(0, 200)}"`);
        }
    } catch (err: any) {
        failedNames.push(scenario.name);
        console.log(`💥 ${scenario.name} — erro de execução: ${err?.message}`);
    }
}

console.log(`\n═══ Resultado: ${passed}/${SCENARIOS.length} ═══`);
if (failedNames.length) {
    console.log(`Reprovados: ${failedNames.join(" | ")}`);
    console.log("🔴 NÃO SUBA para tenant real com a suíte vermelha.");
    Deno.exit(1);
}
console.log("🟢 Suíte verde — liberado para produção.");
