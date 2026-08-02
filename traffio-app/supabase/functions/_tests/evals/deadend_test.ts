/**
 * deadend_test — E-3 (2026-07-31, teste de estresse). O paciente respondeu
 * "manhã" fechando cadastro (marcar_cadastro_confirmado) e pedindo horário
 * (ver_disponibilidade) na MESMA mensagem. O guard antigo tratava as duas
 * ferramentas de cadastro como o mesmo gatilho: confirmar o cadastro
 * bloqueava a checagem de horário NO MESMO TURNO, o agente prometeu "já vou
 * verificar... e te mostro em seguida" e a conversa morreu — só uma nova
 * mensagem do paciente dispara o próximo turno.
 *
 * Estes testes travam os dois pilares da correção:
 * 1. `shouldBlockAvailabilityCheck`/`orderRegistrationToolsFirst` — o guard
 *    passa a decidir pelo ESTADO real (registration_confirmed), não por
 *    "alguma ferramenta de cadastro rodou este turno".
 * 2. `validateAgentReply` com `toolCallFailedThisTurn` — rede de segurança
 *    genérica: qualquer promessa de verificação iminente quando uma
 *    ferramenta falhou/foi bloqueada no turno é reprovada e regenerada, em
 *    vez de deixar a conversa morrer.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
    orderRegistrationToolsFirst,
    shouldBlockAvailabilityCheck,
    validateAgentReply,
    REGISTRATION_TOOLS,
} from "../../_shared/copilot.ts";

// ── shouldBlockAvailabilityCheck: a decisão certa em cada combinação ──

Deno.test("shouldBlockAvailabilityCheck: NÃO bloqueia após marcar_cadastro_confirmado (bug real do teste de estresse)", () => {
    // marcar_cadastro_confirmado rodou → justUpdatedRegistrationThisTurn nunca
    // é ligado por ela (só atualizar_cadastro_paciente liga) — cenário exato
    // do turno "manhã": cadastro confirmado + disponibilidade no mesmo turno.
    assertEquals(shouldBlockAvailabilityCheck("ver_disponibilidade", /*justUpdated*/ false, /*confirmed*/ true), false);
});

Deno.test("shouldBlockAvailabilityCheck: BLOQUEIA quando o dado acabou de chegar e ainda não foi confirmado (regra de negócio preservada)", () => {
    // atualizar_cadastro_paciente rodou neste turno e o paciente ainda não
    // confirmou nada — não pode saltar direto para horários.
    assertEquals(shouldBlockAvailabilityCheck("ver_disponibilidade", /*justUpdated*/ true, /*confirmed*/ false), true);
});

Deno.test("shouldBlockAvailabilityCheck: NÃO bloqueia quando o dado foi atualizado E confirmado no mesmo turno", () => {
    // atualizar_cadastro_paciente seguido de marcar_cadastro_confirmado no
    // mesmo lote (ordenados primeiro) → registration_confirmed já é true
    // quando ver_disponibilidade é avaliada.
    assertEquals(shouldBlockAvailabilityCheck("ver_disponibilidade", /*justUpdated*/ true, /*confirmed*/ true), false);
});

Deno.test("shouldBlockAvailabilityCheck: nunca se aplica a outras ferramentas", () => {
    assertEquals(shouldBlockAvailabilityCheck("agendar", true, false), false);
    assertEquals(shouldBlockAvailabilityCheck("buscar_meus_agendamentos", true, false), false);
});

// ── orderRegistrationToolsFirst: cadastro sempre executa antes ──

Deno.test("orderRegistrationToolsFirst: marcar_cadastro_confirmado + ver_disponibilidade no mesmo lote — cadastro vai primeiro", () => {
    const calls = [{ name: "ver_disponibilidade" }, { name: "marcar_cadastro_confirmado" }];
    const ordered = orderRegistrationToolsFirst(calls);
    assertEquals(ordered.map(c => c.name), ["marcar_cadastro_confirmado", "ver_disponibilidade"]);
});

Deno.test("orderRegistrationToolsFirst: atualizar_cadastro_paciente + agendar — cadastro vai primeiro", () => {
    const calls = [{ name: "agendar" }, { name: "atualizar_cadastro_paciente" }];
    const ordered = orderRegistrationToolsFirst(calls);
    assertEquals(ordered.map(c => c.name), ["atualizar_cadastro_paciente", "agendar"]);
});

Deno.test("orderRegistrationToolsFirst: sem ferramenta de cadastro, ordem original preservada", () => {
    const calls = [{ name: "ver_disponibilidade" }, { name: "buscar_meus_agendamentos" }];
    assertEquals(orderRegistrationToolsFirst(calls).map(c => c.name), ["ver_disponibilidade", "buscar_meus_agendamentos"]);
});

Deno.test("REGISTRATION_TOOLS: contrato com os nomes reais das ferramentas de cadastro", () => {
    assert(REGISTRATION_TOOLS.has("atualizar_cadastro_paciente"));
    assert(REGISTRATION_TOOLS.has("marcar_cadastro_confirmado"));
    assertEquals(REGISTRATION_TOOLS.size, 2);
});

// ── validateAgentReply + toolCallFailedThisTurn: rede de segurança anti-promessa ──

Deno.test("validateAgentReply: reprova a frase REAL do teste de estresse quando uma ferramenta falhou/foi bloqueada no turno", () => {
    const text = "Perfeito, Fabricio! Seu cadastro está confirmado e completo. Já vou verificar os horários de manhã para a sua avaliação de implante e te mostro em seguida 😊";
    const violations = validateAgentReply(text, {
        language: "pt", evidence: text, policyEvidence: "", toolCallFailedThisTurn: true,
    });
    assert(
        violations.some(v => v.includes("promessa de ação sem execução")),
        `esperava violação de promessa sem execução, veio: ${violations.join(" | ")}`,
    );
});

Deno.test("validateAgentReply: NÃO reprova a mesma frase quando NENHUMA ferramenta falhou (promessa legítima, resultado virá em botões/próxima bolha)", () => {
    const text = "Já vou verificar os horários de manhã e te mostro em seguida 😊";
    const violations = validateAgentReply(text, {
        language: "pt", evidence: text, policyEvidence: "", toolCallFailedThisTurn: false,
    });
    assert(
        !violations.some(v => v.includes("promessa de ação sem execução")),
        `não deveria reprovar promessa quando nada falhou: ${violations.join(" | ")}`,
    );
});

Deno.test("validateAgentReply: ferramenta falhou, mas a mensagem pede confirmação (comportamento correto) — não reprova", () => {
    const text = "Prazer, Fabricio! Posso confirmar seu telefone e e-mail antes de eu seguir com o agendamento?";
    const violations = validateAgentReply(text, {
        language: "pt", evidence: text, policyEvidence: "", toolCallFailedThisTurn: true,
    });
    assert(
        !violations.some(v => v.includes("promessa de ação sem execução")),
        `pedir confirmação não é uma promessa de ação — não deveria reprovar: ${violations.join(" | ")}`,
    );
});

Deno.test("validateAgentReply: detecta a frase de promessa em EN e ES", () => {
    const en = validateAgentReply("Let me check the morning slots for you!", {
        language: "en", evidence: "", policyEvidence: "", toolCallFailedThisTurn: true,
    });
    assert(en.some(v => v.includes("promessa de ação sem execução")));

    const es = validateAgentReply("¡Voy a verificar los horarios de la mañana!", {
        language: "es", evidence: "", policyEvidence: "", toolCallFailedThisTurn: true,
    });
    assert(es.some(v => v.includes("promessa de ação sem execução")));
});
