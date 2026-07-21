import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
    RESPONDER_PACIENTE_TOOL,
    composeBubbles,
    validateAgentReply,
    isNearDuplicateReply,
} from "../../_shared/copilot.ts";
import { isHardHandoffSession } from "../../_shared/sessionManager.ts";

Deno.test("composeBubbles — 3 bolhas completas (acknowledge, answer, advance)", () => {
    const bubbles = composeBubbles({
        acknowledge: "Olá! Que ótimo falar com você.",
        answer: "Temos a avaliação odontológica completa disponível.",
        advance: "Você prefere atendimento no período da manhã ou da tarde?",
    });
    assertEquals(bubbles.length, 3);
    assertEquals(bubbles[0], "Olá! Que ótimo falar com você.");
    assertEquals(bubbles[1], "Temos a avaliação odontológica completa disponível.");
    assertEquals(bubbles[2], "Você prefere atendimento no período da manhã ou da tarde?");
});

Deno.test("composeBubbles — apenas answer (1 bolha)", () => {
    const bubbles = composeBubbles({
        answer: "A clínica funciona de segunda a sábado das 08:00 às 18:00.",
    });
    assertEquals(bubbles.length, 1);
    assertEquals(bubbles[0], "A clínica funciona de segunda a sábado das 08:00 às 18:00.");
});

Deno.test("composeBubbles — answer + advance (2 bolhas)", () => {
    const bubbles = composeBubbles({
        answer: "Realizamos limpeza e clareamento dental.",
        advance: "Qual procedimento gostaria de agendar?",
    });
    assertEquals(bubbles.length, 2);
    assertEquals(bubbles[0], "Realizamos limpeza e clareamento dental.");
    assertEquals(bubbles[1], "Qual procedimento gostaria de agendar?");
});

Deno.test("composeBubbles — fallback com string simples", () => {
    const bubbles = composeBubbles("  Olá, como posso ajudar hoje?  ");
    assertEquals(bubbles.length, 1);
    assertEquals(bubbles[0], "Olá, como posso ajudar hoje?");
});

Deno.test("composeBubbles — objeto vazio ou nulo retorna array vazio", () => {
    assertEquals(composeBubbles(null).length, 0);
    assertEquals(composeBubbles(undefined).length, 0);
    assertEquals(composeBubbles({}).length, 0);
});

Deno.test("per-bubble validation — evidência do turno valida horário de ferramenta em bolha individual", () => {
    const turnEvidence = "BASE DE CONHECIMENTO:\nAgendamento\nHORÁRIOS DISPONÍVEIS: 2026-07-25 09:00 Dra Ana";
    const bubble2 = "Temos o horário no dia 25/07 às 09:00 com a Dra Ana.";

    const violations = validateAgentReply(bubble2, {
        language: "pt",
        evidence: turnEvidence,
        policyEvidence: turnEvidence,
        patientLastMessage: "tem horário para sábado?",
        appointmentEvidence: null,
    });

    assertEquals(violations.length, 0);
});

Deno.test("turn-level loop detection — compara texto fundido do turno contra turno anterior", () => {
    const lastAssistantMessage = "Temos horários no dia 25/07. Prefere manhã ou tarde?";
    const currentTurnBubbles = [
        "Temos horários no dia 25/07.",
        "Prefere manhã ou tarde?",
    ];
    const fullTurnText = currentTurnBubbles.join("\n\n");

    const isLoop = isNearDuplicateReply(fullTurnText, lastAssistantMessage);
    assertEquals(isLoop, true);
});

Deno.test("turn-level loop detection — pergunta de avanço similar não aciona falso-positivo se o answer mudou", () => {
    const lastAssistantMessage = "A avaliação custa passar pelo profissional. Prefere manhã ou tarde?";
    const currentTurnBubbles = [
        "Com certeza! O clareamento a laser dura cerca de 60 minutos.",
        "Prefere manhã ou tarde?",
    ];
    const fullTurnText = currentTurnBubbles.join("\n\n");

    const isLoop = isNearDuplicateReply(fullTurnText, lastAssistantMessage);
    assertEquals(isLoop, false);
});

Deno.test("copilot gate — ignora rascunho de copiloto quando IA autônoma respondeu (replied)", () => {
    const session = { omnichannel_status: "bot_active", human_handoff: false };
    const isHard = isHardHandoffSession(session);
    const autonomousStatus: string | null = "replied";
    const activeAgent: string = "ai_always";

    const shouldRunCopilot = autonomousStatus !== "replied" && (activeAgent === "copilot" || (activeAgent === "ai_always" && isHard));
    assertEquals(shouldRunCopilot, false);
});

Deno.test("copilot gate — executa copiloto se IA autônoma encerrou com handoff (transferred)", () => {
    const session = { omnichannel_status: "human_active", human_handoff: true, handoff_kind: "hard" };
    const isHard = isHardHandoffSession(session);
    const autonomousStatus: string | null = "transferred";
    const activeAgent: string = "ai_always";

    const shouldRunCopilot = autonomousStatus !== "replied" && (activeAgent === "copilot" || (activeAgent === "ai_always" && isHard));
    assertEquals(shouldRunCopilot, true);
});

Deno.test("RESPONDER_PACIENTE_TOOL — schema de ferramentas tem responder_paciente com schema válido", () => {
    assertEquals(RESPONDER_PACIENTE_TOOL.name, "responder_paciente");
    assertEquals((RESPONDER_PACIENTE_TOOL.input_schema as any).required.includes("answer"), true);
});

Deno.test("emoji ceiling — 3 bolhas com 2 emojis cada (6 no turno) estoura teto do turno (reprova)", () => {
    const bubbles = [
        "Olá! Seja bem-vindo 😊 🙂",
        "Atendemos de segunda a sábado ✨ 💙",
        "Quer agendar a sua avaliação? ✅ 😊",
    ];
    const fullTurnText = bubbles.join("\n\n");
    const turnEmojiCount = (fullTurnText.match(/\p{Extended_Pictographic}/gu) || []).length;
    assertEquals(turnEmojiCount > 3, true);
});

Deno.test("emoji ceiling — 3 bolhas com 1 emoji cada (3 no turno) respeita teto do turno e per-bubble (passa)", () => {
    const bubbles = [
        "Olá! Seja bem-vindo 😊",
        "Atendemos de segunda a sábado ✨",
        "Quer agendar a sua avaliação? 💙",
    ];
    const fullTurnText = bubbles.join("\n\n");
    const turnEmojiCount = (fullTurnText.match(/\p{Extended_Pictographic}/gu) || []).length;
    assertEquals(turnEmojiCount <= 3, true);

    for (const b of bubbles) {
        const violations = validateAgentReply(b, { language: "pt", evidence: "", policyEvidence: "" });
        assertEquals(violations.length, 0);
    }
});

Deno.test("emoji ceiling — 1 bolha com 2 emojis (2 no turno) respeita teto do turno e per-bubble (passa)", () => {
    const bubble = "Olá! Seja bem-vindo 😊 Quer agendar a sua avaliação? ✨";
    const turnEmojiCount = (bubble.match(/\p{Extended_Pictographic}/gu) || []).length;
    assertEquals(turnEmojiCount <= 3, true);

    const violations = validateAgentReply(bubble, { language: "pt", evidence: "", policyEvidence: "" });
    assertEquals(violations.length, 0);
});
