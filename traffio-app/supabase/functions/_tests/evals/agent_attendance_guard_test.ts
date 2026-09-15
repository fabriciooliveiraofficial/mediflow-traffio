/**
 * agent_attendance_guard_test — TRAVA o caminho crítico de receita: "o AI Agent
 * atende ou não este turno". É a razão nº 1 pela qual os tenants contratam a
 * plataforma. Se um desses testes ficar vermelho, o atendimento da IA está
 * prestes a quebrar em produção — NÃO suba.
 *
 * Contexto (por que este arquivo existe): em 2026-07-22/23 o atendimento da IA
 * quebrou DUAS vezes por mudanças adjacentes (trigger de cron e roteamento),
 * deixando conversas paradas em "Aguardando" no inbox sem a IA responder. A
 * decisão de roteamento foi isolada em `isAutonomousAgentTurn` (sessionManager.ts)
 * e é travada aqui. Mudou a regra de handoff/roteamento? Atualize ESTES testes
 * conscientemente — eles são o contrato.
 *
 * REGRA: o AI Agent autônomo responde ⇔ dial === 'ai_always' E a sessão NÃO
 * está em handoff estrito (isHardHandoffSession === false).
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isAutonomousAgentTurn, isHardHandoffSession } from "../../_shared/sessionManager.ts";

// ─── O caso que quebrou em produção (2026-07-23) ─────────────────────────────
// Conversa em 'queued'/"Aguardando", NÃO assumida por humano (human_handoff=false),
// handoff_kind ausente. Isso NÃO é hard handoff → a IA TEM que atender.
Deno.test("GUARD: queued + human_handoff=false + kind=null + ai_always → IA ATENDE (o caso do incidente)", () => {
    const session = { omnichannel_status: "queued", human_handoff: false, handoff_kind: null };
    assertEquals(isHardHandoffSession(session), false, "queued sem handoff humano NÃO é hard handoff");
    assertEquals(isAutonomousAgentTurn("ai_always", session), true, "a IA DEVE atender uma conversa em fila não assumida");
});

Deno.test("GUARD: bot_active + ai_always → IA ATENDE (conversa que a IA já conduz)", () => {
    assertEquals(isAutonomousAgentTurn("ai_always", { omnichannel_status: "bot_active", human_handoff: false, handoff_kind: null }), true);
});

Deno.test("GUARD: soft handoff em fila + ai_always → IA ATENDE (soft mantém a IA operando)", () => {
    assertEquals(isAutonomousAgentTurn("ai_always", { omnichannel_status: "queued", human_handoff: true, handoff_kind: "soft" }), true);
});

Deno.test("GUARD: campos ausentes (sessão nova) + ai_always → IA ATENDE", () => {
    assertEquals(isAutonomousAgentTurn("ai_always", {}), true);
});

// ─── Casos em que a IA autônoma NÃO deve responder (humano segura, ou dial off) ─
Deno.test("GUARD: human_active + ai_always → IA NÃO atende (humano assumiu ativamente)", () => {
    assertEquals(isAutonomousAgentTurn("ai_always", { omnichannel_status: "human_active", human_handoff: true, handoff_kind: null }), false);
});

Deno.test("GUARD: hard handoff em fila + ai_always → IA NÃO atende (bloqueio até o humano encerrar)", () => {
    assertEquals(isAutonomousAgentTurn("ai_always", { omnichannel_status: "queued", human_handoff: true, handoff_kind: "hard" }), false);
});

Deno.test("GUARD: handoff legado (human_handoff=true, kind=null) + ai_always → IA NÃO atende", () => {
    assertEquals(isAutonomousAgentTurn("ai_always", { omnichannel_status: "queued", human_handoff: true, handoff_kind: null }), false);
});

// ─── Dial: só 'ai_always' aciona o agente autônomo ───────────────────────────
Deno.test("GUARD: dial 'human' nunca aciona o agente autônomo, mesmo sem handoff", () => {
    assertEquals(isAutonomousAgentTurn("human", { omnichannel_status: "queued", human_handoff: false, handoff_kind: null }), false);
});

Deno.test("GUARD: dial 'copilot' não aciona o agente autônomo (só rascunho para humano)", () => {
    assertEquals(isAutonomousAgentTurn("copilot", { omnichannel_status: "queued", human_handoff: false, handoff_kind: null }), false);
});

Deno.test("GUARD: dial nulo/indefinido nunca aciona o agente autônomo", () => {
    assertEquals(isAutonomousAgentTurn(null, { omnichannel_status: "queued", human_handoff: false }), false);
    assertEquals(isAutonomousAgentTurn(undefined, { omnichannel_status: "queued", human_handoff: false }), false);
});

// ─── Regressão do incidente 13/08/2026 ────────────────────────────────────────
// isHardHandoffSession trata handoff_kind=NULL como hard (teste da linha 50-52,
// comportamento correto e intencional da função pura). O bug real não estava
// na função — estava em process-inbox/index.ts escrevendo esse estado de
// propósito em dois pontos (`{ reason: null, kind: null }`), gravado em duas
// correções passadas (30/07 e 31/07, achado via `git log -S`). Como NULL nunca
// vira 'soft', qualquer conversa que passasse por ali travava para SEMPRE, sem
// recuperação automática — foi isso que apareceu como "o agente parou
// completamente". Nenhum chamador de triggerHumanHandoff neste arquivo pode
// voltar a passar kind=null — só 'soft' (autorrecuperável) ou 'hard' (nomeado).
Deno.test("GUARD: process-inbox nunca chama triggerHumanHandoff com kind explicitamente null", async () => {
    const src = await Deno.readTextFile(new URL("../../process-inbox/index.ts", import.meta.url));
    const offenders = src.match(/triggerHumanHandoff\([^)]*kind:\s*null[^)]*\)/g) || [];
    assertEquals(offenders, [], `chamada(s) com kind:null encontrada(s) — cria estado de handoff irrecuperável: ${offenders.join(" | ")}`);
});

// ─── Rótulo do modo humano (15/09/2026) ───────────────────────────────────────
// Com o dial em 'human' o ramo "fila humana" gravava reason='tech' só para
// garantir kind='soft', e o inbox mostrava "Falha no sistema" em TODA conversa
// de tenant em modo manual (37/39 sessões num tenant real). Não é falha: o
// motivo é 'manual'. E, sem nenhuma IA ligada, os classificadores de imagem/
// documento (Haiku, pagos) não podem rodar — ninguém consumiria o resultado.
Deno.test("GUARD: fila humana por dial grava reason='manual', nunca 'tech'", async () => {
    const src = await Deno.readTextFile(new URL("../../process-inbox/index.ts", import.meta.url));
    assertEquals(/const queueReason = aiBlocked \? "ai_budget" : "manual";/.test(src), true, "ramo humano deve usar 'manual'");
    assertEquals(/const queueReason = [^\n]*"tech"/.test(src), false, "'tech' voltou a ser o rótulo do modo humano — vira \"Falha no sistema\" no inbox");
});

Deno.test("GUARD: classificadores de mídia só rodam com algum dial de IA ligado (aiConfigured)", async () => {
    const src = await Deno.readTextFile(new URL("../../process-inbox/index.ts", import.meta.url));
    assertEquals(/msgType === "image" && aiConfigured && !aiBlocked/.test(src), true, "classifyImage sem gate de dial");
    assertEquals(/msgType === "document" && aiConfigured && !aiBlocked/.test(src), true, "classifyDocument sem gate de dial");
});
