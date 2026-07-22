/**
 * conversation.ts — evals MULTI-TURNO do agente autônomo (F3, Onda 4.2/4.3).
 *
 * Diferença para run.ts (single-turn): aqui o histórico da CLÍNICA não é uma
 * string fixa escrita à mão — é gerado de verdade, turno a turno, pelo MESMO
 * loop de produção (`runAgentTurn`, espelho de `runAutonomousAgent`), com o
 * transcript crescendo a cada rodada. Isso cobre 3 coisas que run.ts NUNCA
 * exercita:
 *   1. `resolveTurnLanguage` recalculado a cada turno (o bug B2 de produção:
 *      idioma do turno anterior vazando pro prompt do turno seguinte);
 *   2. continuidade real — o agente vê a própria fala anterior no transcript,
 *      não uma fala escrita por nós;
 *   3. conversas longas (12 turnos) sem repetir pergunta já respondida.
 *
 * Os turnos do PACIENTE são roteirizados (não geramos com um 2º modelo) de
 * propósito: um "paciente simulado" livre (LLM vs. LLM) não bate de forma
 * confiável nos pontos exatos que os cenários precisam testar (trocar de
 * idioma NO turno 3, insistir em preço 2x, manter 12 turnos sem fugir do
 * roteiro) — vira um gate instável e caro de calibrar. O roteiro dá
 * determinismo ao gate; o lado CLÍNICA, que é o que estamos testando, é 100%
 * real e vivo a cada turno.
 *
 * Como rodar (na pasta supabase/functions):
 *   $env:ANTHROPIC_API_KEY="sk-ant-..."; npx deno run -A _tests/evals/conversation.ts
 *
 * Regra do projeto: mudou prompt, modelo ou ferramenta → esta suíte roda ANTES
 * do deploy, junto com run.ts. Vermelho = não sobe.
 */
import {
    buildAutonomousSystemPrompt, buildFlowStateHint, formatConsultationStatus, shouldUseAccessibleMode,
    resolveTurnLanguage, normalizeConversationLanguage, isNearDuplicateReply, type ConversationLanguage,
} from "../../_shared/copilot.ts";
import { STAGE_GUIDANCE, type CrmStageId } from "../../_shared/journeyStage.ts";
import { MOCK_SLOT_TIMES, MOCK_APPOINTMENT } from "./mockTools.ts";
import { runAgentTurn, stubSupabase, type AgentTurnResult } from "./agentTurn.ts";
import { claudeJson } from "../../_shared/llmProvider.ts";
import { CONVERSATION_SCENARIOS, type ConversationScenario } from "./conversationScenarios.ts";

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
    "- [logistics] funcionamento: segunda a sábado, 8h às 18h",
].join("\n");

function buildScenarioKnowledgePacket(s: ConversationScenario): string {
    const parts = [KNOWLEDGE_PACKET];
    if (s.globalKnowledgePacket) parts.push(s.globalKnowledgePacket);
    if (s.consultationFee) {
        const status = formatConsultationStatus(s.consultationFee);
        parts.push(`INFORMAÇÕES DA CLÍNICA:\n- [fonte:clinic_info#consultation_fee] [policies] STATUS DA CONSULTA (consultation_fee=${s.consultationFee}): ${status}`);
    }
    return parts.join("\n\n");
}

export interface ConversationTurnLog {
    patient: string;
    turnLanguage: ConversationLanguage;
    reply: AgentTurnResult;
}

export interface ConversationRunResult {
    turns: ConversationTurnLog[];
    allToolsCalled: Set<string>;
    allAgendarInputs: string[];
    anyTransferred: boolean;
}

async function runConversation(s: ConversationScenario): Promise<ConversationRunResult> {
    const history: { role: "user" | "assistant"; content: string }[] = [];
    const turns: ConversationTurnLog[] = [];
    const allToolsCalled = new Set<string>();
    const allAgendarInputs: string[] = [];
    let anyTransferred = false;
    // Espelha context.language persistido entre turnos (produção) — semeado
    // pelo idioma inicial do cenário, sobrescrito pelo idioma resolvido a
    // cada turno (B2: a mensagem ATUAL sempre vence).
    let storedLanguage: ConversationLanguage = normalizeConversationLanguage(s.language ?? "pt");

    for (const patientMsg of s.patientTurns) {
        history.push({ role: "user", content: patientMsg });
        const turnLanguage = resolveTurnLanguage(patientMsg, storedLanguage);

        const { text: system, cachePrefix: systemCachePrefix } = buildAutonomousSystemPrompt({
            clinicName: "Clínica Eval",
            personality: "acolhedor",
            instructions: "",
            knowledgePacket: buildScenarioKnowledgePacket(s),
            todayStr: "2026-07-15",
            stageGuidance: s.stage ? STAGE_GUIDANCE[s.stage] ?? null : null,
            languageHint: turnLanguage,
            patientSnapshot: s.withAppointment
                ? [
                    "Paciente cadastrado: Fabricio Teste",
                    "AGENDAMENTOS ATIVOS (estado REAL do sistema agora):",
                    `- ${MOCK_APPOINTMENT.date} às ${MOCK_APPOINTMENT.start_time} — ${MOCK_APPOINTMENT.appointment_types.name} com ${MOCK_APPOINTMENT.doctors.full_name} (${MOCK_APPOINTMENT.status})`,
                ].join("\n")
                : null,
            flowStateHint: s.intake ? buildFlowStateHint({}, s.intake) : null,
            accessibleMode: shouldUseAccessibleMode(patientMsg),
        });

        const transcript = history
            .map(m => `${m.role === "user" ? "PACIENTE" : "CLÍNICA"}: ${m.content}`)
            .join("\n");

        const reply = await runAgentTurn({
            system, systemCachePrefix, transcript, model: MODEL,
            purpose: `eval_convo:${s.name.split(" ")[0]}`,
            mockOptions: { availabilityFails: s.availabilityFails },
        });

        // Transcript da CLÍNICA no próximo turno é a fala REAL gerada agora —
        // é isto que faz este eval ser "multi-turno de verdade" e não uma
        // história escrita à mão.
        history.push({ role: "assistant", content: reply.text || "" });
        turns.push({ patient: patientMsg, turnLanguage, reply });

        for (const t of reply.toolsCalled) allToolsCalled.add(t);
        allAgendarInputs.push(...reply.agendarInputs);
        if (reply.transferred) anyTransferred = true;

        storedLanguage = turnLanguage;
    }

    return { turns, allToolsCalled, allAgendarInputs, anyTransferred };
}

// ─── Asserções ───────────────────────────────────────────────────────────────

const PRICE_PATTERN = /(r\$|us\$|\$\s?\d|€|\d+[.,]\d{2}\b|\b\d{3,}\s?(reais|dólares|dolares|euros)\b|\b(custa|cuesta|costs?)\s+\d)/i;
const TIME_PATTERN = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;

function allowedTimes(): Set<string> {
    const allowed = new Set<string>([...MOCK_SLOT_TIMES, "11:00"]);
    for (const t of [...MOCK_SLOT_TIMES, "11:00"]) {
        const [h, m] = t.split(":").map(Number);
        const h12 = h % 12 === 0 ? 12 : h % 12;
        allowed.add(`${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
        allowed.add(`${h12}:${String(m).padStart(2, "0")}`.padStart(5, "0"));
    }
    return allowed;
}

function check(s: ConversationScenario, r: ConversationRunResult): string[] {
    const failures: string[] = [];
    const e = s.expect;
    const allTexts = r.turns.map(t => t.reply.text);
    const lowerAll = allTexts.map(t => t.toLowerCase());
    const finalTurn = r.turns[r.turns.length - 1];

    if (e.noPriceEver) {
        allTexts.forEach((t, i) => { if (PRICE_PATTERN.test(t)) failures.push(`preço vazou no turno ${i + 1}: "${t.substring(0, 120)}"`); });
    }

    if (e.noInventedTimesEver) {
        const allowed = allowedTimes();
        allTexts.forEach((t, i) => {
            const times = [...t.matchAll(TIME_PATTERN)].map(m => m[0]).map(x => (x.length === 4 ? `0${x}` : x));
            const invented = times.filter(x => !allowed.has(x));
            if (invented.length) failures.push(`horários inventados no turno ${i + 1}: ${invented.join(", ")}`);
        });
    }

    for (const tool of e.toolsCalledEver || []) {
        if (!r.allToolsCalled.has(tool)) failures.push(`ferramenta obrigatória nunca chamada na conversa: ${tool}`);
    }
    for (const tool of e.toolsNotCalledEver || []) {
        if (r.allToolsCalled.has(tool)) failures.push(`ferramenta proibida chamada na conversa: ${tool}`);
    }

    if (e.agendarInputIncludes) {
        const hit = r.allAgendarInputs.some(inp => inp.toLowerCase().includes(e.agendarInputIncludes!.toLowerCase()));
        if (!hit) failures.push(`nenhuma chamada de agendar contém "${e.agendarInputIncludes}" no input: [${r.allAgendarInputs.join(" | ").substring(0, 150)}]`);
    }

    if (e.transferExpected && !r.anyTransferred) failures.push("deveria transferir para humano em algum turno e não transferiu");
    if (e.transferNotExpected && r.anyTransferred) failures.push("transferiu para humano sem necessidade em algum turno");

    if (e.finalLanguage && finalTurn.turnLanguage !== e.finalLanguage) {
        failures.push(`idioma do último turno deveria ser "${e.finalLanguage}", resolvido "${finalTurn.turnLanguage}"`);
    }

    if (e.finalTextIncludesAny?.length) {
        const lower = finalTurn.reply.text.toLowerCase();
        if (!e.finalTextIncludesAny.some(sub => lower.includes(sub.toLowerCase()))) {
            failures.push(`texto do último turno não contém nenhum de [${e.finalTextIncludesAny.join(", ")}]: "${finalTurn.reply.text.substring(0, 120)}"`);
        }
    }
    for (const sub of e.finalTextExcludesAll || []) {
        if (finalTurn.reply.text.toLowerCase().includes(sub.toLowerCase())) failures.push(`texto do último turno contém proibido "${sub}"`);
    }
    for (const sub of e.textExcludesAllEver || []) {
        lowerAll.forEach((t, i) => { if (t.includes(sub.toLowerCase())) failures.push(`turno ${i + 1} contém frase proibida em toda a conversa "${sub}"`); });
    }

    if (e.noRepeatedQuestion) {
        for (let i = 0; i < allTexts.length; i++) {
            for (let j = i + 1; j < allTexts.length; j++) {
                if (allTexts[i] && allTexts[j] && isNearDuplicateReply(allTexts[j], allTexts[i])) {
                    failures.push(`turno ${j + 1} repete quase literalmente o turno ${i + 1} (loop de pergunta/resposta)`);
                }
            }
        }
    }

    return failures;
}

// ─── Juiz de tom/comportamento (Onda 4.3) ─────────────────────────────────────
// Rubrica EXCLUSIVAMENTE de comportamento — NUNCA formato/brevidade/nº de
// parágrafos. Decisão travada com o usuário (2026-07-21): o atendimento deve
// ter "habilidades e comportamento de verdadeiros SDR's/CRC's", formato é
// LIVRE. Um eixo de brevidade aqui reintroduziria exatamente a rigidez que
// causou a reclamação original — nunca adicionar um eixo desses de volta.
const JUDGE_MODEL = Deno.env.get("AI_MODEL_ROUTER") || "claude-haiku-4-5-20251001";
const JUDGE_AXES = ["acolhimento", "substancia", "escuta_ativa", "naturalidade", "conducao"] as const;
type JudgeAxis = typeof JUDGE_AXES[number];
export const JUDGE_MIN_SCORE = 3;

interface JudgeResult {
    scores: Record<JudgeAxis, number>;
    notes: string;
}

const JUDGE_SYSTEM = `
Você avalia a qualidade de ATENDIMENTO de um agente de IA que atua como SDR/CRC
(consultor de agendamento) de uma clínica, respondendo pacientes no WhatsApp.

Avalie SOMENTE comportamento — NUNCA formato, tamanho de frase, número de
parágrafos ou de bolhas de mensagem. O formato é deliberadamente livre neste
produto; penalizar brevidade ou extensão é um erro de avaliação.

Dê uma nota de 1 a 5 para cada eixo:
- acolhimento: reconhece a pessoa e o momento dela antes de despejar informação; tom humano, não robótico.
- substancia: quando responde algo, responde de verdade (nunca evasiva tipo "vou verificar" quando o dado estava disponível); usa o CONTEXTO DA CLÍNICA.
- escuta_ativa: não repete pergunta já respondida pelo paciente na própria conversa; incorpora o que o paciente já disse.
- naturalidade: soa como um atendente humano de verdade, não como um roteiro decorado nem como um formulário.
- conducao: avança a conversa com objetivo claro (marcar, esclarecer, ou reconhecer quando não avançar é a decisão certa) sem forçar nem pressionar.

Responda APENAS com JSON válido:
{"scores":{"acolhimento":N,"substancia":N,"escuta_ativa":N,"naturalidade":N,"conducao":N},"notes":"1-2 frases justificando a pior nota"}
`.trim();

async function judgeConversation(s: ConversationScenario, r: ConversationRunResult): Promise<JudgeResult | null> {
    const transcript = r.turns
        .map((t, i) => `--- Turno ${i + 1} ---\nPACIENTE: ${t.patient}\nCLÍNICA: ${t.reply.transferred ? "[transferido para humano]" : (t.reply.text || "[sem resposta]")}`)
        .join("\n\n");

    return claudeJson<JudgeResult>(stubSupabase, {
        tenantId: "eval", purpose: `eval_judge:${s.name.split(" ")[0]}`, model: JUDGE_MODEL,
        maxTokens: 400, system: JUDGE_SYSTEM,
        messages: [{ role: "user", content: `Cenário: ${s.name}\n\n${transcript}` }],
    });
}

function judgeFailures(judge: JudgeResult | null): string[] {
    if (!judge) return ["juiz de tom não retornou resultado (falha de rede/parse — não fatal, mas sem nota)"];
    const failures: string[] = [];
    for (const axis of JUDGE_AXES) {
        const score = judge.scores?.[axis];
        if (typeof score !== "number" || score < JUDGE_MIN_SCORE) {
            failures.push(`juiz de tom reprovou o eixo "${axis}" (nota ${score ?? "ausente"}/5, mínimo ${JUDGE_MIN_SCORE}): ${judge.notes || ""}`);
        }
    }
    return failures;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim() ?? "";
if (!apiKey) {
    console.error("❌ ANTHROPIC_API_KEY não definida no ambiente. Ex.:");
    console.error('   PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."; npx deno run -A _tests/evals/conversation.ts');
    Deno.exit(2);
}
if (!apiKey.startsWith("sk-ant-") || apiKey.includes("SUA-CHAVE") || apiKey.length < 40) {
    console.error(`❌ ANTHROPIC_API_KEY suspeita: "${apiKey.substring(0, 10)}…" (${apiKey.length} chars).`);
    Deno.exit(2);
}
console.log(`🔑 Chave carregada: ${apiKey.substring(0, 14)}…${apiKey.slice(-4)} (${apiKey.length} chars)`);

const totalTurns = CONVERSATION_SCENARIOS.reduce((n, s) => n + s.patientTurns.length, 0);
console.log(`\n═══ Evals multi-turno — modelo: ${MODEL} — ${CONVERSATION_SCENARIOS.length} conversas, ${totalTurns} turnos totais ═══\n`);

let passed = 0;
const failedNames: string[] = [];

for (const scenario of CONVERSATION_SCENARIOS) {
    try {
        const result = await runConversation(scenario);
        const behaviorFailures = check(scenario, result);
        const judge = await judgeConversation(scenario, result);
        const toneFailures = judgeFailures(judge);
        const failures = [...behaviorFailures, ...toneFailures];

        if (failures.length === 0) {
            passed++;
            console.log(`✅ ${scenario.name}`);
            console.log(`   turnos=${result.turns.length} tools=[${[...result.allToolsCalled].join(", ")}] transferiu=${result.anyTransferred} tom=[${JUDGE_AXES.map(a => `${a}:${judge?.scores?.[a] ?? "?"}`).join(" ")}]`);
        } else {
            failedNames.push(scenario.name);
            console.log(`❌ ${scenario.name}`);
            for (const f of failures) console.log(`   → ${f}`);
            result.turns.forEach((t, i) => console.log(`   [turno ${i + 1}, ${t.turnLanguage}] PACIENTE: "${t.patient.substring(0, 80)}" | CLÍNICA: "${(t.reply.text || "[transferido]").substring(0, 140)}"`));
        }
    } catch (err: any) {
        failedNames.push(scenario.name);
        console.log(`💥 ${scenario.name} — erro de execução: ${err?.message}`);
    }
}

console.log(`\n═══ Resultado: ${passed}/${CONVERSATION_SCENARIOS.length} ═══`);
if (failedNames.length) {
    console.log(`Reprovadas: ${failedNames.join(" | ")}`);
    console.log("🔴 NÃO SUBA para tenant real com a suíte vermelha.");
    Deno.exit(1);
}
console.log("🟢 Suíte verde — liberado para produção.");
