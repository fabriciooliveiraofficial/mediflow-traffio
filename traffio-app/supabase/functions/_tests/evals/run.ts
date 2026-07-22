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
import { buildAutonomousSystemPrompt, buildFlowStateHint, formatConsultationStatus, shouldUseAccessibleMode } from "../../_shared/copilot.ts";
import { STAGE_GUIDANCE } from "../../_shared/journeyStage.ts";
import { MOCK_SLOT_TIMES, MOCK_APPOINTMENT } from "./mockTools.ts";
import { SCENARIOS, type EvalScenario } from "./scenarios.ts";
import { runAgentTurn, type AgentTurnResult } from "./agentTurn.ts";

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

function buildScenarioKnowledgePacket(s: EvalScenario): string {
    const parts = [KNOWLEDGE_PACKET];
    if (s.globalKnowledgePacket) parts.push(s.globalKnowledgePacket);
    if (s.consultationFee) {
        const status = formatConsultationStatus(s.consultationFee);
        parts.push(`INFORMAÇÕES DA CLÍNICA:\n- [fonte:clinic_info#consultation_fee] [policies] STATUS DA CONSULTA (consultation_fee=${s.consultationFee}): ${status}`);
    }
    return parts.join("\n\n");
}

type RunResult = AgentTurnResult;

async function runScenario(s: EvalScenario): Promise<RunResult> {
    const lastPatientMessage = [...s.history].reverse().find(m => m.role === "user")?.content || "";
    const { text: system, cachePrefix: systemCachePrefix } = buildAutonomousSystemPrompt({
        clinicName: "Clínica Eval",
        personality: "acolhedor",
        instructions: "",
        knowledgePacket: buildScenarioKnowledgePacket(s),
        todayStr: "2026-07-15",
        stageGuidance: s.stage ? STAGE_GUIDANCE[s.stage] ?? null : null,
        languageHint: s.language ?? null,
        // Espelha buildPatientSnapshot de produção (fonte da verdade sobre agendamentos)
        patientSnapshot: s.withAppointment
            ? [
                "Paciente cadastrado: Fabricio Teste",
                "AGENDAMENTOS ATIVOS (estado REAL do sistema agora):",
                `- ${MOCK_APPOINTMENT.date} às ${MOCK_APPOINTMENT.start_time} — ${MOCK_APPOINTMENT.appointment_types.name} com ${MOCK_APPOINTMENT.doctors.full_name} (${MOCK_APPOINTMENT.status})`,
            ].join("\n")
            : null,
        // E-10/E-12 (Onda 3): espelha o buildFlowStateHint de produção — ficha já
        // conhecida entre turnos não deve ser perguntada de novo
        flowStateHint: s.intake ? buildFlowStateHint({}, s.intake) : null,
        // E-22 (Onda 3): mesmo gatilho de produção — só ativa quando o paciente pede
        accessibleMode: shouldUseAccessibleMode(lastPatientMessage),
    });

    const transcript = s.history
        .map(m => `${m.role === "user" ? "PACIENTE" : "CLÍNICA"}: ${m.content}`)
        .join("\n");

    return runAgentTurn({
        system, systemCachePrefix, transcript, model: MODEL,
        purpose: `eval:${s.name.split(" ")[0]}`,
        mockOptions: { availabilityFails: s.availabilityFails },
    });
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
        // Slots do mock também na forma 12h (o modelo diz "2:00 PM" para 14:00) —
        // evita falso-positivo do checker, não é horário inventado.
        const allowed = new Set<string>([...MOCK_SLOT_TIMES, "11:00"]);
        for (const t of [...MOCK_SLOT_TIMES, "11:00"]) {
            const [h, m] = t.split(":").map(Number);
            const h12 = h % 12 === 0 ? 12 : h % 12;
            allowed.add(`${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
            allowed.add(`${h12}:${String(m).padStart(2, "0")}`.padStart(5, "0"));
        }
        const invented = times.filter(t => !allowed.has(t));
        if (invented.length) failures.push(`horários inventados: ${invented.join(", ")}`);
    }

    for (const tool of e.toolsCalled || []) {
        if (!r.toolsCalled.includes(tool)) failures.push(`ferramenta obrigatória não chamada: ${tool}`);
    }
    for (const tool of e.toolsNotCalled || []) {
        if (r.toolsCalled.includes(tool)) failures.push(`ferramenta proibida chamada: ${tool}`);
    }

    if (e.agendarInputIncludes) {
        const hit = r.agendarInputs.some(inp => inp.toLowerCase().includes(e.agendarInputIncludes!.toLowerCase()));
        if (!hit) failures.push(`nenhuma chamada de agendar contém "${e.agendarInputIncludes}" no input: [${r.agendarInputs.join(" | ").substring(0, 150)}]`);
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

const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim() ?? "";
if (!apiKey) {
    console.error("❌ ANTHROPIC_API_KEY não definida no ambiente. Ex.:");
    console.error('   PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."; npx deno run -A _tests/evals/run.ts');
    Deno.exit(2);
}
// Sanidade da chave antes de gastar 11 chamadas: prefixo/tamanho + placeholder
if (!apiKey.startsWith("sk-ant-") || apiKey.includes("SUA-CHAVE") || apiKey.length < 40) {
    console.error(`❌ ANTHROPIC_API_KEY suspeita: "${apiKey.substring(0, 10)}…" (${apiKey.length} chars).`);
    console.error("   Cole a chave real (console.anthropic.com → API Keys) — a mesma que está no painel master.");
    Deno.exit(2);
}
console.log(`🔑 Chave carregada: ${apiKey.substring(0, 14)}…${apiKey.slice(-4)} (${apiKey.length} chars)`);

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
