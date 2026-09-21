/**
 * Incidente 2026-09-22 (tenant em Pacific/Auckland): paciente e agendamento
 * excluídos no painel, e o agente respondeu "you're already booked with him
 * tomorrow, 09/22/2026 at 08:30" — o agendamento não existia mais e 22/09 era
 * HOJE no fuso da clínica. Cobertura das quatro defesas.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
    buildClinicClockBlock, buildDatedTranscript, hasWrongRelativeDay,
    buildAutonomousSystemPrompt, validateAgentReply,
} from "../../_shared/copilot.ts";

Deno.test("buildClinicClockBlock: tabela hoje/amanhã/ontem com dia da semana, hora e fuso — inclusive virada de mês e de ano", () => {
    const block = buildClinicClockBlock("2026-09-22", "05:47", "Pacific/Auckland");
    assert(block.includes("fuso Pacific/Auckland"));
    assert(block.includes("AGORA: terça-feira, 2026-09-22, 05:47"));
    assert(block.includes("HOJE = 2026-09-22 (terça-feira)"));
    assert(block.includes("AMANHÃ = 2026-09-23 (quarta-feira)"));
    assert(block.includes("ontem = 2026-09-21 (segunda-feira)"));
    assert(buildClinicClockBlock("2026-12-31").includes("AMANHÃ = 2027-01-01 (sexta-feira)"));
    assert(buildClinicClockBlock("2026-03-01").includes("ontem = 2026-02-28 (sábado)"));
});

Deno.test("hasWrongRelativeDay: o caso real — 'tomorrow, 09/22/2026' quando 22/09 é HOJE na clínica", () => {
    const real = "Good news — you're already booked with him tomorrow, 09/22/2026 at 08:30 am, for exactly this.";
    assert(hasWrongRelativeDay(real, "2026-09-22"));
    // A mesma frase no dia anterior estava certa.
    assertEquals(hasWrongRelativeDay(real, "2026-09-21"), null);
});

Deno.test("hasWrongRelativeDay: rótulos corretos passam em pt/en/es, nos formatos dd/mm, mm/dd e ISO", () => {
    const today = "2026-09-22";
    for (const ok of [
        "Tenho horário hoje, 22/09, às 14:00.",
        "today 📅 09/22/2026",
        "tomorrow 📅 09/23/2026",
        "Amanhã (23/09) de manhã fica bom?",
        "Sua consulta foi ontem, 2026-09-21.",
        "Hoy 22/09 tenemos lugar; mañana 23/09 también.",
        "Tenemos turnos por la mañana el 25/09.",       // "mañana" = manhã, não amanhã
        "Hoje não consigo. Dia 25/09 tem vaga às 9h.",   // outra frase: data não pertence ao "hoje"
        "Posso ver amanhã cedo pra você?",               // sem data por perto
    ]) assertEquals(hasWrongRelativeDay(ok, today), null, ok);
});

Deno.test("hasWrongRelativeDay: rótulos errados são pegos nos três idiomas", () => {
    const today = "2026-09-22";
    for (const bad of [
        "Sua consulta é amanhã, 22/09, às 08:30.",
        "We have a slot today, 09/24/2026.",
        "Te espero mañana 25/09 a las 10.",
        "Você esteve aqui ontem (19/09).",
    ]) assert(hasWrongRelativeDay(bad, today), bad);
});

Deno.test("validateAgentReply: rótulo relativo errado reprova a resposta (gera regeneração corretiva)", () => {
    const base = { language: "en", evidence: "08:30", policyEvidence: "" };
    const text = "You're booked tomorrow, 09/22/2026 at 08:30.";
    assert(validateAgentReply(text, { ...base, todayStr: "2026-09-22" }).some(v => v.includes("rótulo relativo errado")));
    assertEquals(validateAgentReply(text, { ...base, todayStr: "2026-09-21" }).filter(v => v.includes("rótulo relativo")).length, 0);
});

Deno.test("buildDatedTranscript: conversa antiga e conversa atual ficam separadas por marcador de tempo", () => {
    const now = new Date("2026-09-21T17:42:00Z");
    const t = buildDatedTranscript([
        { role: "assistant", content: "Your appointment has been successfully booked! Date: 09/22/2026", timestamp: "2026-09-19T15:21:50Z" },
        { role: "user", content: "hi, just saw your ad", timestamp: "2026-09-21T17:41:28Z" },
    ], now);
    const lines = t.split("\n");
    assert(lines[0].startsWith("[— conversa anterior, de 2 dias atrás"), lines[0]);
    assert(lines[2].includes("CONVERSA ATUAL"), lines[2]);
    // Sem timestamp (formato antigo) continua funcionando, sem marcadores.
    assertEquals(buildDatedTranscript([{ role: "user", content: "oi" }], now), "PACIENTE: oi");
    // Conversa contínua não ganha ruído.
    assertEquals(buildDatedTranscript([
        { role: "user", content: "oi", timestamp: "2026-09-21T17:40:00Z" },
        { role: "assistant", content: "olá!", timestamp: "2026-09-21T17:40:10Z" },
    ], now).includes("[—"), false);
});

Deno.test("buildAutonomousSystemPrompt: SEM ficha no banco o agente recebe a verdade explícita — nada do histórico vale", () => {
    const base = { clinicName: "Clínica X", personality: "acolhedor", instructions: "", knowledgePacket: "", todayStr: "2026-09-22", nowHHMM: "05:47", timezone: "Pacific/Auckland" };
    const without = buildAutonomousSystemPrompt({ ...base, patientSnapshot: null } as any).text;
    assert(without.includes("NENHUM cadastro e NENHUM agendamento existem"));
    assert(without.includes("RELÓGIO DA CLÍNICA (fuso Pacific/Auckland)"));
    const withRecord = buildAutonomousSystemPrompt({ ...base, patientSnapshot: "Paciente cadastrado: Ana Souza\nAGENDAMENTOS ATIVOS: nenhum agendamento futuro no sistema." } as any);
    assert(!withRecord.text.includes("NENHUM cadastro e NENHUM agendamento existem"));
    assert(withRecord.text.includes("ele não existe mais (cancelado/removido)"));
    // Contrato de cache: relógio e bloco do paciente mudam por turno — NUNCA no prefixo cacheado.
    assert(!withRecord.cachePrefix.includes("RELÓGIO DA CLÍNICA"));
    assert(!withRecord.cachePrefix.includes("fonte da VERDADE"));
});
