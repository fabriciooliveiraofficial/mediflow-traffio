/**
 * unit_test.ts — testes puros das peças determinísticas do F3 (sem API, sem banco).
 * Rodar (na pasta supabase/functions): npx deno test -A _tests/evals/unit_test.ts
 */
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
    parseSlotClick,
    buildSlotInteractive,
    isWithinBusinessHours,
    formatDateForPatient,
    type SlotOption,
} from "../../_shared/schedulingTools.ts";

const slot = (i: number): SlotOption => ({
    id: `slot|doc-1|loc-1|type-1|2026-07-16|0${9 + i}:00`,
    title: `16/07 · 0${9 + i}:00`,
    doctor_id: "doc-1",
    location_id: "loc-1",
    type_id: "type-1",
    date: "2026-07-16",
    time: `0${9 + i}:00`,
});

Deno.test("parseSlotClick: roundtrip do id do botão", () => {
    const parsed = parseSlotClick("slot|doc-1|loc-1|type-1|2026-07-16|09:00");
    assertEquals(parsed?.doctor_id, "doc-1");
    assertEquals(parsed?.location_id, "loc-1");
    assertEquals(parsed?.type_id, "type-1");
    assertEquals(parsed?.date, "2026-07-16");
    assertEquals(parsed?.time, "09:00");
});

Deno.test("parseSlotClick: type_id vazio vira null", () => {
    const parsed = parseSlotClick("slot|doc-1|loc-1||2026-07-16|09:00");
    assertEquals(parsed?.type_id, null);
});

Deno.test("parseSlotClick: texto comum não é clique", () => {
    assertEquals(parseSlotClick("quero agendar amanhã"), null);
    assertEquals(parseSlotClick(""), null);
    assertEquals(parseSlotClick(undefined), null);
    // Malformado (faltando campos) também não é clique
    assertEquals(parseSlotClick("slot|doc-1|loc-1"), null);
});

Deno.test("buildSlotInteractive: até 3 slots viram botões", () => {
    const payload = buildSlotInteractive([slot(0), slot(1), slot(2)]);
    assertEquals(payload.type, "button");
    assertEquals(payload.buttons.length, 3);
    assertEquals(payload.buttons[0].id, slot(0).id);
});

Deno.test("buildSlotInteractive: mais de 3 slots viram lista", () => {
    const payload = buildSlotInteractive([slot(0), slot(1), slot(2), slot(3)]);
    assertEquals(payload.type, "list");
    assertEquals(payload.sections[0].rows.length, 4);
});

Deno.test("isWithinBusinessHours: sem config = sempre expediente (conservador)", () => {
    assert(isWithinBusinessHours({}, "America/Sao_Paulo"));
    assert(isWithinBusinessHours({ business_hours: {} }, "America/Sao_Paulo"));
});

Deno.test("isWithinBusinessHours: janela 00:00–23:59 todos os dias = sempre dentro", () => {
    const bh = { business_hours: { start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] } };
    assert(isWithinBusinessHours(bh, "America/Sao_Paulo"));
});

Deno.test("isWithinBusinessHours: janela impossível 00:00–00:01 quase sempre fora", () => {
    const bh = { business_hours: { start: "00:00", end: "00:01", days: [0, 1, 2, 3, 4, 5, 6] } };
    // Só passaria se o teste rodar exatamente à meia-noite no fuso — tolerado
    const now = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date());
    if (now !== "00") assertEquals(isWithinBusinessHours(bh, "America/Sao_Paulo"), false);
});

Deno.test("isWithinBusinessHours: dia fora da lista = fora do expediente", () => {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(new Date());
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const today = map[wd];
    const otherDays = [0, 1, 2, 3, 4, 5, 6].filter(d => d !== today);
    const bh = { business_hours: { start: "00:00", end: "23:59", days: otherDays } };
    assertEquals(isWithinBusinessHours(bh, "America/Sao_Paulo"), false);
});

Deno.test("formatDateForPatient: formato por idioma", () => {
    assertEquals(formatDateForPatient("2026-07-16", "pt"), "16/07/2026");
    assertEquals(formatDateForPatient("2026-07-16", "es"), "16/07/2026");
    assertEquals(formatDateForPatient("2026-07-16", "en"), "07/16/2026");
});
