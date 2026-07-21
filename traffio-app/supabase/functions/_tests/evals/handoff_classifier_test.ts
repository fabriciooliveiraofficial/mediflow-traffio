import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveHandoffReason } from "../../_shared/copilot.ts";
import { extractZapiContent, extractCloudApiContent } from "../../_shared/inboundParser.ts";
import { isHardHandoffSession } from "../../_shared/sessionManager.ts";

Deno.test("resolveHandoffReason — cancel request maps to hard/cancel", () => {
    const res = resolveHandoffReason("queria cancelar minha consulta", { cancelRequested: true });
    assertEquals(res, { reason: "cancel", kind: "hard" });
});

Deno.test("resolveHandoffReason — jailbreak signal maps to hard/jailbreak", () => {
    const res = resolveHandoffReason(null, { jailbreakTripped: true });
    assertEquals(res, { reason: "jailbreak", kind: "hard" });
});

Deno.test("resolveHandoffReason — reconciliation maps to hard/reconciliation", () => {
    const res = resolveHandoffReason("remarcação com conflito", { reconciliationNeeded: true });
    assertEquals(res, { reason: "reconciliation", kind: "hard" });
});

Deno.test("resolveHandoffReason — emergency terms map to hard/emergency", () => {
    const res = resolveHandoffReason("paciente relata dor intensa e sangramento");
    assertEquals(res, { reason: "emergency", kind: "hard" });
});

Deno.test("resolveHandoffReason — clinical terms map to hard/clinical", () => {
    const res = resolveHandoffReason("dúvida sobre medicação e sintomas pós cirurgia");
    assertEquals(res, { reason: "clinical", kind: "hard" });
});

Deno.test("resolveHandoffReason — human request maps to hard/human_request", () => {
    const res = resolveHandoffReason("quero falar com atendente humano");
    assertEquals(res, { reason: "human_request", kind: "hard" });
});

Deno.test("resolveHandoffReason — price insistence maps to hard/price_insistence", () => {
    const res = resolveHandoffReason("quanto custa a avaliação?");
    assertEquals(res, { reason: "price_insistence", kind: "hard" });
});

Deno.test("resolveHandoffReason — complaint maps to hard/complaint", () => {
    const res = resolveHandoffReason("atendimento péssimo vou ao procon");
    assertEquals(res, { reason: "complaint", kind: "hard" });
});

Deno.test("resolveHandoffReason — knowledge gap flag maps to soft/knowledge_gap", () => {
    const res = resolveHandoffReason("não consta informação sobre convênio x no contexto", { isKnowledgeGap: true });
    assertEquals(res, { reason: "knowledge_gap", kind: "soft" });
});

Deno.test("resolveHandoffReason — tech fail flag maps to soft/tech", () => {
    const res = resolveHandoffReason(null, { isTechFail: true });
    assertEquals(res, { reason: "tech", kind: "soft" });
});

Deno.test("inboundParser — interactive fallback handles blank buttonId and title cleanly", () => {
    const zapiEmptyInteractive = extractZapiContent({
        buttonsResponseMessage: {
            buttonId: "",
            message: "",
        },
    });
    assertEquals(zapiEmptyInteractive.isInteractiveReply, true);
    assertEquals(zapiEmptyInteractive.content, "[interactive]");

    const cloudApiEmptyInteractive = extractCloudApiContent({
        type: "interactive",
        interactive: {
            type: "button_reply",
            button_reply: { id: "", title: "" },
        },
    });
    assertEquals(cloudApiEmptyInteractive.isInteractiveReply, true);
    assertEquals(cloudApiEmptyInteractive.content, "[interactive]");
});

Deno.test("isHardHandoffSession — soft handoff queued allows AI processing (returns false)", () => {
    const isHard = isHardHandoffSession({
        omnichannel_status: "queued",
        human_handoff: true,
        handoff_kind: "soft",
    });
    assertEquals(isHard, false);
});

Deno.test("isHardHandoffSession — hard handoff queued blocks AI processing (returns true)", () => {
    const isHard = isHardHandoffSession({
        omnichannel_status: "queued",
        human_handoff: true,
        handoff_kind: "hard",
    });
    assertEquals(isHard, true);
});

Deno.test("isHardHandoffSession — human_active status blocks AI processing regardless of kind (returns true)", () => {
    const isHard = isHardHandoffSession({
        omnichannel_status: "human_active",
        human_handoff: true,
        handoff_kind: "soft",
    });
    assertEquals(isHard, true);
});

Deno.test("isHardHandoffSession — legacy queued session with missing handoff_kind blocks AI processing (returns true)", () => {
    const isHard = isHardHandoffSession({
        omnichannel_status: "queued",
        human_handoff: true,
        handoff_kind: null,
    });
    assertEquals(isHard, true);
});
