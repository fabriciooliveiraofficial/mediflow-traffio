/**
 * Auditoria de fuso por tenant (2026-09-22): o agente precisa do "agora" REAL
 * de cada clínica — data, hora, dia da semana — em todo ponto que fala ou age
 * sobre tempo. Estes testes fixam o mesmo INSTANTE e conferem que três clínicas
 * (Auckland, São Paulo, Los Angeles) enxergam dias/horas diferentes e corretos.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { slotBookability, todayInTz, nowInTz } from "../../_shared/schedulingTools.ts";
import { buildClinicClockBlock } from "../../_shared/copilot.ts";

/** Roda `fn` com o relógio do processo congelado em `iso` (UTC). */
function atInstant<T>(iso: string, fn: () => T): T {
    const RealDate = Date;
    const fixed = new RealDate(iso).getTime();
    // deno-lint-ignore no-explicit-any
    (globalThis as any).Date = class extends RealDate {
        // deno-lint-ignore no-explicit-any
        constructor(...args: any[]) { if (args.length) { super(...(args as [any])); } else { super(fixed); } }
        static override now() { return fixed; }
    };
    try { return fn(); } finally { (globalThis as any).Date = RealDate; }
}

Deno.test("mesmo instante, três clínicas: cada uma vê o SEU dia e a SUA hora (caso real 21/09 17:42 UTC)", () => {
    atInstant("2026-09-21T17:42:00Z", () => {
        assertEquals(todayInTz("Pacific/Auckland"), "2026-09-22");   // já é terça de manhã
        assertEquals(nowInTz("Pacific/Auckland"), "05:42");
        assertEquals(todayInTz("America/Sao_Paulo"), "2026-09-21");  // ainda é segunda à tarde
        assertEquals(nowInTz("America/Sao_Paulo"), "14:42");
        assertEquals(todayInTz("America/Los_Angeles"), "2026-09-21");
        assertEquals(nowInTz("America/Los_Angeles"), "10:42");
    });
});

Deno.test("virada do dia e horário de verão: Auckland em NZDT (UTC+13) e Los Angeles na véspera", () => {
    atInstant("2026-12-31T11:30:00Z", () => {
        assertEquals(todayInTz("Pacific/Auckland"), "2027-01-01");   // já é ano novo
        assertEquals(nowInTz("Pacific/Auckland"), "00:30");
        assertEquals(todayInTz("America/Los_Angeles"), "2026-12-31");
        assertEquals(nowInTz("America/Los_Angeles"), "03:30");
        const block = buildClinicClockBlock(todayInTz("Pacific/Auckland"), nowInTz("Pacific/Auckland"), "Pacific/Auckland");
        assert(block.includes("AGORA: sexta-feira, 2027-01-01, 00:30"));
        assert(block.includes("ontem = 2026-12-31 (quinta-feira)"));
    });
});

Deno.test("slotBookability: decide 'já passou' pelo relógio do TENANT, com antecedência mínima", () => {
    const auckland = { today: "2026-09-22", nowHHMM: "05:42", bufferMinutes: 30 };
    assertEquals(slotBookability("2026-09-21", "18:00", auckland), "past_date");  // ontem lá (ainda "hoje" no Brasil)
    assertEquals(slotBookability("2026-09-22", "05:00", auckland), "past_time");
    assertEquals(slotBookability("2026-09-22", "05:42", auckland), "past_time");
    assertEquals(slotBookability("2026-09-22", "06:00", auckland), "too_soon");   // dentro dos 30 min
    assertEquals(slotBookability("2026-09-22", "06:12", auckland), "ok");
    assertEquals(slotBookability("2026-09-22", "08:30:00", auckland), "ok");      // TIME do banco vem com segundos
    assertEquals(slotBookability("2026-09-23", "00:05", auckland), "ok");
    assertEquals(slotBookability(null, "08:30", auckland), "invalid");
    assertEquals(slotBookability("22/09/2026", "08:30", auckland), "invalid");
});

Deno.test("slotBookability: o MESMO horário é agendável numa clínica e já passou em outra", () => {
    atInstant("2026-09-21T17:42:00Z", () => {
        const clock = (tz: string) => ({ today: todayInTz(tz), nowHHMM: nowInTz(tz), bufferMinutes: 30 });
        // 21/09 às 16:00: futuro em São Paulo (14:42 agora), ontem em Auckland.
        assertEquals(slotBookability("2026-09-21", "16:00", clock("America/Sao_Paulo")), "ok");
        assertEquals(slotBookability("2026-09-21", "16:00", clock("Pacific/Auckland")), "past_date");
        // 21/09 às 10:00: já passou em São Paulo, ainda está em cima da hora em Los Angeles (10:42).
        assertEquals(slotBookability("2026-09-21", "10:00", clock("America/Sao_Paulo")), "past_time");
        assertEquals(slotBookability("2026-09-21", "11:00", clock("America/Los_Angeles")), "too_soon");
    });
});
